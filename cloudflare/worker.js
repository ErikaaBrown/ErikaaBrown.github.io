/**
 * PsicoLab — API de contas, sincronização e partilha profissional (Cloudflare Worker)
 *
 * Requisitos configurados no dashboard:
 * - Binding D1 com o nome "DB" (base de dados criada com schema.sql)
 * - Variável secreta "SESSION_SECRET" (string longa e aleatória)
 *
 * Privacidade: o servidor só guarda blobs cifrados no browser (AES-GCM).
 * A palavra-passe nunca chega aqui — o cliente envia uma chave de
 * autenticação derivada (PBKDF2), distinta da chave de cifra.
 *
 * Recuperação de conta: os dados são cifrados com uma chave aleatória (DEK)
 * gerada no browser. Essa DEK fica guardada aqui duas vezes, cifrada por
 * chaves diferentes: uma derivada da palavra-passe, outra derivada do
 * código de recuperação.
 *
 * Partilha com profissionais: cada conta tem também um par de chaves ECDH
 * (P-256). A chave pública é guardada em claro (não é secreta); a privada
 * segue exactamente o mesmo esquema de protecção da DEK. Quando um
 * paciente liga a um profissional, ambos os browsers derivam a MESMA
 * chave partilhada por ECDH (Diffie-Hellman) — o servidor nunca a vê e
 * nunca vê os dados partilhados em claro. As flags de "profissional" só
 * podem ser atribuídas por uma conta com role = 'admin'.
 */

const ALLOWED_ORIGINS = [
  "https://erikaabrown.github.io",
  "http://localhost:8765",
  "http://127.0.0.1:8765"
];

const TOOLS = ["mood", "thoughts", "gratitude", "habits", "sleep", "worries", "scores", "test_results"];
const SHARE_CATEGORIES = ["test_results", "mood", "thoughts", "gratitude", "habits", "sleep", "worries"];
const CODE_ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ"; // Crockford base32, sem I/L/O/U
const MAX_BLOB = 300 * 1024; // 300 KB por ferramenta/partilha
const MAX_WRAP = 2 * 1024; // wrapped DEK/chave privada: bem menor que um blob de dados
const MAX_PUB = 200; // chave pública ECDH exportada (raw, base64)
const MAX_DISPLAY_NAME = 60;
const MAX_BIO = 500;
const MAX_AVATAR = 60 * 1024; // base64 de uma miniatura JPEG ~200x200, folga generosa
const FULL_TTL_S = 60 * 60 * 24 * 30; // 30 dias
const RECOVERY_TTL_S = 60 * 15; // 15 minutos — janela curta para trocar a password

/* ---------- protecção contra abuso: bloqueio progressivo + armadilhas para scanners ---------- */

const LOCKOUT_THRESHOLD = 5; // tentativas falhadas antes de começar a bloquear a conta
const LOCKOUT_BASE_S = 30;
const LOCKOUT_MAX_S = 60 * 60; // 1 hora, no máximo
const DUMMY_HASH_SALT = "0000000000000000"; // usado só para igualar o tempo de resposta, nunca comparado
const IP_BLOCK_S = 60 * 60; // 1 hora bloqueado depois de cair numa armadilha
const CONN_GUESS_THRESHOLD = 8; // tentativas erradas de código profissional antes de bloquear o IP
const IP_FLAG_RESET_S = 60 * 60 * 24; // sem novas ocorrências neste intervalo, o contador reinicia do zero
const REGISTER_THRESHOLD = 10; // registos a partir do mesmo IP, num dia, antes de bloquear

// caminhos que esta API nunca serve a sério - só existem para apanhar scanners automáticos
const DECOY_PATHS = [
  "/wp-login.php", "/wp-admin", "/wp-admin/", "/xmlrpc.php", "/.env", "/.env.local",
  "/.git/config", "/.git/HEAD", "/phpmyadmin", "/phpMyAdmin", "/admin.php", "/administrator",
  "/config.json", "/config.php", "/.aws/credentials", "/server-status", "/actuator/health",
  "/.ssh/id_rsa", "/console", "/wp-config.php", "/wp-config.php.bak", "/.DS_Store",
  "/backup.sql", "/db.sql", "/.htaccess", "/vendor/phpunit/phpunit/src/Util/PHP/eval-stdin.php"
];
const DECOY_PATTERN = /\.(php|env|bak|sql)$/i;

function looksLikeScan(path) {
  return DECOY_PATHS.includes(path) || DECOY_PATTERN.test(path) || path.indexOf("/.git/") === 0;
}

function sleep(ms) {
  return new Promise(function (resolve) { setTimeout(resolve, ms); });
}

function lockoutSeconds(failedCount) {
  if (failedCount < LOCKOUT_THRESHOLD) return 0;
  const extra = failedCount - LOCKOUT_THRESHOLD;
  return Math.min(LOCKOUT_BASE_S * Math.pow(2, extra), LOCKOUT_MAX_S);
}

async function isIpBlocked(env, ip) {
  const row = await env.DB.prepare("SELECT blocked_until FROM blocked_ips WHERE ip = ?").bind(ip).first();
  return !!row && row.blocked_until > Math.floor(Date.now() / 1000);
}

// regista uma ocorrência suspeita deste IP; só bloqueia de facto ao atingir o limiar
// (1 para armadilhas óbvias - qualquer acesso já é malicioso; mais alto para adivinhar códigos,
// onde um erro isolado pode ser só um engano de digitação)
async function flagIp(env, ip, reason, threshold) {
  const now = Math.floor(Date.now() / 1000);
  const row = await env.DB.prepare("SELECT hit_count, last_hit_at FROM blocked_ips WHERE ip = ?").bind(ip).first();
  const stale = !row || (now - row.last_hit_at) > IP_FLAG_RESET_S;
  const count = stale ? 1 : row.hit_count + 1;
  const until = count >= threshold ? now + IP_BLOCK_S : (stale ? 0 : row.blocked_until);
  await env.DB.prepare(
    "INSERT INTO blocked_ips (ip, reason, hit_count, blocked_until, last_hit_at) VALUES (?, ?, ?, ?, ?) " +
    "ON CONFLICT(ip) DO UPDATE SET hit_count = ?, blocked_until = ?, reason = ?, last_hit_at = ?"
  ).bind(ip, reason, count, until, now, count, until, reason, now).run();
}

/* ---------- utilidades ---------- */

function corsHeaders(origin) {
  const ok = ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];
  return {
    "Access-Control-Allow-Origin": ok,
    "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Access-Control-Max-Age": "86400",
    "Vary": "Origin"
  };
}

function json(data, status, origin) {
  return new Response(JSON.stringify(data), {
    status: status || 200,
    headers: Object.assign({ "Content-Type": "application/json" }, corsHeaders(origin))
  });
}

function hex(buf) {
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function sha256hex(s) {
  return hex(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s)));
}

async function hmacHex(secret, msg) {
  const key = await crypto.subtle.importKey(
    "raw", new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" }, false, ["sign"]
  );
  return hex(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(msg)));
}

async function makeToken(env, uid, scope) {
  scope = scope || "full";
  const ttl = scope === "recovery" ? RECOVERY_TTL_S : FULL_TTL_S;
  const exp = Math.floor(Date.now() / 1000) + ttl;
  const sig = await hmacHex(env.SESSION_SECRET, uid + "." + exp + "." + scope);
  return uid + "." + exp + "." + scope + "." + sig;
}

async function checkToken(env, req) {
  const auth = req.headers.get("Authorization") || "";
  const m = auth.match(/^Bearer (\d+)\.(\d+)\.(full|recovery)\.([0-9a-f]+)$/);
  if (!m) return null;
  const [, uid, exp, scope, sig] = m;
  if (parseInt(exp, 10) < Math.floor(Date.now() / 1000)) return null;
  const good = await hmacHex(env.SESSION_SECRET, uid + "." + exp + "." + scope);
  if (sig.length !== good.length) return null;
  let diff = 0;
  for (let i = 0; i < sig.length; i++) diff |= sig.charCodeAt(i) ^ good.charCodeAt(i);
  return diff === 0 ? { uid: parseInt(uid, 10), scope: scope } : null;
}

function validEmail(e) {
  return typeof e === "string" && e.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(e);
}
function validAuthKey(k) {
  return typeof k === "string" && /^[0-9a-f]{64}$/.test(k);
}
function validWrap(s) {
  return typeof s === "string" && s.length > 0 && s.length <= MAX_WRAP;
}
function validPub(s) {
  return typeof s === "string" && s.length > 0 && s.length <= MAX_PUB;
}
function validCode(s) {
  return typeof s === "string" && /^[0-9A-Z]{4}-[0-9A-Z]{4}$/.test(s);
}
function validDisplayName(s) {
  return typeof s === "string" && s.length <= MAX_DISPLAY_NAME;
}
function validBio(s) {
  return typeof s === "string" && s.length <= MAX_BIO;
}
function validAvatar(s) {
  return typeof s === "string" && s.length <= MAX_AVATAR && (s === "" || /^[A-Za-z0-9+/]+=*$/.test(s));
}

function genCode() {
  const bytes = crypto.getRandomValues(new Uint8Array(5)); // 40 bits, 8 símbolos base32
  let bits = "";
  for (let i = 0; i < bytes.length; i++) bits += bytes[i].toString(2).padStart(8, "0");
  let out = "";
  for (let j = 0; j < bits.length; j += 5) out += CODE_ALPHABET[parseInt(bits.substr(j, 5), 2)];
  return out.slice(0, 4) + "-" + out.slice(4, 8);
}

async function requireRole(env, uid, role) {
  const row = await env.DB.prepare("SELECT role FROM users WHERE id = ?").bind(uid).first();
  return !!row && row.role === role;
}

/* ---------- auth: registo, login, recuperação ---------- */

async function register(env, body, origin, ip) {
  if (body.hp) {
    // campo-armadilha do formulário: só um robô o preenche. Finge sucesso sem criar nada,
    // para não lhe dar nenhuma pista de que foi apanhado
    return json({ token: "0.0.full.0", email: (body.email || "").toLowerCase().trim(), role: "user" }, 200, origin);
  }
  // conta cada tentativa de registo por IP, para um script não conseguir criar contas sem limite
  await flagIp(env, ip, "register_attempt", REGISTER_THRESHOLD);
  if (!validEmail(body.email) || !validAuthKey(body.authKey) ||
      !validWrap(body.dekPassIv) || !validWrap(body.dekPassCt) ||
      !validAuthKey(body.recoveryAuthKey) ||
      !validWrap(body.dekRecoveryIv) || !validWrap(body.dekRecoveryCt) ||
      !validPub(body.ecdhPub) ||
      !validWrap(body.ecdhPrivPassIv) || !validWrap(body.ecdhPrivPassCt) ||
      !validWrap(body.ecdhPrivRecoveryIv) || !validWrap(body.ecdhPrivRecoveryCt)) {
    return json({ error: "invalid_input" }, 400, origin);
  }
  const email = body.email.toLowerCase().trim();
  const salt = hex(crypto.getRandomValues(new Uint8Array(16)));
  const hash = await sha256hex(salt + "|" + body.authKey);
  const rSalt = hex(crypto.getRandomValues(new Uint8Array(16)));
  const rHash = await sha256hex(rSalt + "|" + body.recoveryAuthKey);
  try {
    const r = await env.DB.prepare(
      "INSERT INTO users (email, auth_salt, auth_hash, recovery_salt, recovery_hash, " +
      "dek_pass_iv, dek_pass_ct, dek_recovery_iv, dek_recovery_ct, " +
      "ecdh_pub, ecdh_priv_pass_iv, ecdh_priv_pass_ct, ecdh_priv_recovery_iv, ecdh_priv_recovery_ct) " +
      "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
    ).bind(email, salt, hash, rSalt, rHash, body.dekPassIv, body.dekPassCt, body.dekRecoveryIv, body.dekRecoveryCt,
      body.ecdhPub, body.ecdhPrivPassIv, body.ecdhPrivPassCt, body.ecdhPrivRecoveryIv, body.ecdhPrivRecoveryCt
    ).run();
    const uid = r.meta.last_row_id;
    return json({ token: await makeToken(env, uid, "full"), email, role: "user" }, 200, origin);
  } catch (e) {
    return json({ error: "email_taken" }, 409, origin);
  }
}

async function login(env, body, origin) {
  if (!validEmail(body.email) || !validAuthKey(body.authKey)) {
    return json({ error: "invalid_input" }, 400, origin);
  }
  const email = body.email.toLowerCase().trim();
  const row = await env.DB.prepare(
    "SELECT id, auth_salt, auth_hash, role, professional_code, dek_pass_iv, dek_pass_ct, " +
    "ecdh_pub, ecdh_priv_pass_iv, ecdh_priv_pass_ct, display_name, avatar, bio, failed_logins, locked_until FROM users WHERE email = ?"
  ).bind(email).first();
  if (!row) {
    // faz o mesmo trabalho de hash de qualquer forma, para o tempo de resposta não denunciar
    // que este email não existe (o resultado nunca é comparado com nada)
    await sha256hex(DUMMY_HASH_SALT + "|" + body.authKey);
    return json({ error: "bad_credentials" }, 401, origin);
  }
  const now = Math.floor(Date.now() / 1000);
  if (row.locked_until > now) {
    // demasiadas tentativas falhadas recentemente - rejeita sem revelar que é por causa disto
    return json({ error: "bad_credentials" }, 401, origin);
  }
  const hash = await sha256hex(row.auth_salt + "|" + body.authKey);
  if (hash !== row.auth_hash) {
    const failed = row.failed_logins + 1;
    const lockSecs = lockoutSeconds(failed);
    await env.DB.prepare("UPDATE users SET failed_logins = ?, locked_until = ? WHERE id = ?")
      .bind(failed, lockSecs ? now + lockSecs : 0, row.id).run();
    return json({ error: "bad_credentials" }, 401, origin);
  }
  if (row.failed_logins > 0) {
    await env.DB.prepare("UPDATE users SET failed_logins = 0, locked_until = 0 WHERE id = ?").bind(row.id).run();
  }
  return json({
    token: await makeToken(env, row.id, "full"),
    email: email,
    role: row.role,
    professionalCode: row.professional_code || "",
    dekPassIv: row.dek_pass_iv || "",
    dekPassCt: row.dek_pass_ct || "",
    ecdhPub: row.ecdh_pub || "",
    ecdhPrivPassIv: row.ecdh_priv_pass_iv || "",
    ecdhPrivPassCt: row.ecdh_priv_pass_ct || "",
    displayName: row.display_name || "",
    avatar: row.avatar || "",
    bio: row.bio || ""
  }, 200, origin);
}

async function recoverStart(env, body, origin) {
  if (!validEmail(body.email) || !validAuthKey(body.recoveryAuthKey)) {
    return json({ error: "invalid_input" }, 400, origin);
  }
  const email = body.email.toLowerCase().trim();
  const row = await env.DB.prepare(
    "SELECT id, recovery_salt, recovery_hash, dek_recovery_iv, dek_recovery_ct, ecdh_priv_recovery_iv, ecdh_priv_recovery_ct " +
    "FROM users WHERE email = ?"
  ).bind(email).first();
  if (!row || !row.recovery_hash) {
    await sha256hex(DUMMY_HASH_SALT + "|" + body.recoveryAuthKey);
    return json({ error: "bad_recovery" }, 401, origin);
  }
  const hash = await sha256hex(row.recovery_salt + "|" + body.recoveryAuthKey);
  if (hash !== row.recovery_hash) return json({ error: "bad_recovery" }, 401, origin);
  return json({
    token: await makeToken(env, row.id, "recovery"),
    dekRecoveryIv: row.dek_recovery_iv,
    dekRecoveryCt: row.dek_recovery_ct,
    ecdhPrivRecoveryIv: row.ecdh_priv_recovery_iv,
    ecdhPrivRecoveryCt: row.ecdh_priv_recovery_ct
  }, 200, origin);
}

async function recoverReset(env, uid, body, origin) {
  if (!validAuthKey(body.newAuthKey) || !validWrap(body.dekPassIv) || !validWrap(body.dekPassCt) ||
      !validWrap(body.ecdhPrivPassIv) || !validWrap(body.ecdhPrivPassCt)) {
    return json({ error: "invalid_input" }, 400, origin);
  }
  const salt = hex(crypto.getRandomValues(new Uint8Array(16)));
  const hash = await sha256hex(salt + "|" + body.newAuthKey);
  await env.DB.prepare(
    "UPDATE users SET auth_salt = ?, auth_hash = ?, dek_pass_iv = ?, dek_pass_ct = ?, " +
    "ecdh_priv_pass_iv = ?, ecdh_priv_pass_ct = ? WHERE id = ?"
  ).bind(salt, hash, body.dekPassIv, body.dekPassCt, body.ecdhPrivPassIv, body.ecdhPrivPassCt, uid).run();
  const row = await env.DB.prepare(
    "SELECT email, role, professional_code, display_name, avatar, bio FROM users WHERE id = ?"
  ).bind(uid).first();
  return json({
    token: await makeToken(env, uid, "full"),
    email: row.email, role: row.role, professionalCode: row.professional_code || "",
    displayName: row.display_name || "", avatar: row.avatar || "", bio: row.bio || ""
  }, 200, origin);
}

async function upgradeKeys(env, uid, body, origin) {
  if (!validWrap(body.dekPassIv) || !validWrap(body.dekPassCt) ||
      !validAuthKey(body.recoveryAuthKey) ||
      !validWrap(body.dekRecoveryIv) || !validWrap(body.dekRecoveryCt) ||
      !validPub(body.ecdhPub) ||
      !validWrap(body.ecdhPrivPassIv) || !validWrap(body.ecdhPrivPassCt) ||
      !validWrap(body.ecdhPrivRecoveryIv) || !validWrap(body.ecdhPrivRecoveryCt)) {
    return json({ error: "invalid_input" }, 400, origin);
  }
  const rSalt = hex(crypto.getRandomValues(new Uint8Array(16)));
  const rHash = await sha256hex(rSalt + "|" + body.recoveryAuthKey);
  await env.DB.prepare(
    "UPDATE users SET dek_pass_iv = ?, dek_pass_ct = ?, recovery_salt = ?, recovery_hash = ?, " +
    "dek_recovery_iv = ?, dek_recovery_ct = ?, ecdh_pub = ?, ecdh_priv_pass_iv = ?, ecdh_priv_pass_ct = ?, " +
    "ecdh_priv_recovery_iv = ?, ecdh_priv_recovery_ct = ? WHERE id = ?"
  ).bind(body.dekPassIv, body.dekPassCt, rSalt, rHash, body.dekRecoveryIv, body.dekRecoveryCt,
    body.ecdhPub, body.ecdhPrivPassIv, body.ecdhPrivPassCt, body.ecdhPrivRecoveryIv, body.ecdhPrivRecoveryCt, uid
  ).run();
  return json({ ok: true }, 200, origin);
}

/* ---------- perfil opcional (nome, foto, biografia — em claro, não cifrado) ---------- */

async function updateProfile(env, uid, body, origin) {
  const displayName = typeof body.displayName === "string" ? body.displayName.trim() : "";
  const bio = typeof body.bio === "string" ? body.bio.trim() : "";
  const avatar = typeof body.avatar === "string" ? body.avatar : "";
  if (!validDisplayName(displayName) || !validBio(bio) || !validAvatar(avatar)) {
    return json({ error: "invalid_input" }, 400, origin);
  }
  await env.DB.prepare(
    "UPDATE users SET display_name = ?, bio = ?, avatar = ? WHERE id = ?"
  ).bind(displayName, bio, avatar, uid).run();
  return json({ ok: true }, 200, origin);
}

/* ---------- dados das ferramentas ---------- */

async function getData(env, uid, origin) {
  const rows = await env.DB.prepare(
    "SELECT tool, iv, ct, updated FROM blobs WHERE user_id = ?"
  ).bind(uid).all();
  return json({ blobs: rows.results || [] }, 200, origin);
}

async function putData(env, uid, tool, body, origin) {
  if (!TOOLS.includes(tool)) return json({ error: "unknown_tool" }, 400, origin);
  if (typeof body.iv !== "string" || typeof body.ct !== "string" ||
      typeof body.updated !== "number" || body.ct.length > MAX_BLOB) {
    return json({ error: "invalid_input" }, 400, origin);
  }
  const existing = await env.DB.prepare(
    "SELECT updated FROM blobs WHERE user_id = ? AND tool = ?"
  ).bind(uid, tool).first();
  if (existing && existing.updated > body.updated) {
    return json({ error: "stale", updated: existing.updated }, 409, origin);
  }
  await env.DB.prepare(
    "INSERT INTO blobs (user_id, tool, iv, ct, updated) VALUES (?, ?, ?, ?, ?) " +
    "ON CONFLICT(user_id, tool) DO UPDATE SET iv = ?, ct = ?, updated = ?"
  ).bind(uid, tool, body.iv, body.ct, body.updated, body.iv, body.ct, body.updated).run();
  return json({ ok: true }, 200, origin);
}

async function deleteAccount(env, uid, origin) {
  await env.DB.prepare("DELETE FROM shares WHERE connection_id IN " +
    "(SELECT id FROM connections WHERE patient_id = ? OR professional_id = ?)").bind(uid, uid).run();
  await env.DB.prepare("DELETE FROM connections WHERE patient_id = ? OR professional_id = ?").bind(uid, uid).run();
  await env.DB.prepare("DELETE FROM blobs WHERE user_id = ?").bind(uid).run();
  await env.DB.prepare("DELETE FROM users WHERE id = ?").bind(uid).run();
  return json({ ok: true }, 200, origin);
}

/* ---------- ligações paciente ↔ profissional ---------- */

async function createConnection(env, uid, body, origin, ip) {
  if (!validCode(body.professionalCode)) return json({ error: "invalid_input" }, 400, origin);
  const pro = await env.DB.prepare(
    "SELECT id, email, ecdh_pub FROM users WHERE professional_code = ? AND role = 'professional'"
  ).bind(body.professionalCode.toUpperCase()).first();
  if (!pro) {
    // uma adivinha errada isolada é normal (engano de digitação); só bloqueia ao fim de várias
    await flagIp(env, ip, "professional_code_guess", CONN_GUESS_THRESHOLD);
    return json({ error: "code_not_found" }, 404, origin);
  }
  if (pro.id === uid) return json({ error: "cannot_connect_self" }, 400, origin);
  await env.DB.prepare(
    "INSERT INTO connections (patient_id, professional_id) VALUES (?, ?) " +
    "ON CONFLICT(patient_id, professional_id) DO NOTHING"
  ).bind(uid, pro.id).run();
  const conn = await env.DB.prepare(
    "SELECT id FROM connections WHERE patient_id = ? AND professional_id = ?"
  ).bind(uid, pro.id).first();
  return json({
    connectionId: conn.id,
    professional: { id: pro.id, email: pro.email, ecdhPub: pro.ecdh_pub }
  }, 200, origin);
}

async function listConnections(env, uid, origin) {
  const asPatient = await env.DB.prepare(
    "SELECT c.id, c.professional_id AS other_id, u.email AS other_email, u.ecdh_pub AS other_pub, " +
    "u.display_name AS other_name, u.avatar AS other_avatar, u.bio AS other_bio, c.created_at " +
    "FROM connections c JOIN users u ON u.id = c.professional_id WHERE c.patient_id = ?"
  ).bind(uid).all();
  const asProfessional = await env.DB.prepare(
    "SELECT c.id, c.patient_id AS other_id, u.email AS other_email, u.ecdh_pub AS other_pub, " +
    "u.display_name AS other_name, u.avatar AS other_avatar, u.bio AS other_bio, c.created_at " +
    "FROM connections c JOIN users u ON u.id = c.patient_id WHERE c.professional_id = ?"
  ).bind(uid).all();
  const shape = (r) => ({
    connectionId: r.id, otherId: r.other_id, otherEmail: r.other_email, otherPub: r.other_pub,
    otherDisplayName: r.other_name || "", otherAvatar: r.other_avatar || "", otherBio: r.other_bio || "",
    since: r.created_at
  });
  return json({
    asPatient: (asPatient.results || []).map(shape),
    asProfessional: (asProfessional.results || []).map(shape)
  }, 200, origin);
}

async function deleteConnection(env, uid, connId, origin) {
  const conn = await env.DB.prepare(
    "SELECT id FROM connections WHERE id = ? AND (patient_id = ? OR professional_id = ?)"
  ).bind(connId, uid, uid).first();
  if (!conn) return json({ error: "not_found" }, 404, origin);
  await env.DB.prepare("DELETE FROM shares WHERE connection_id = ?").bind(connId).run();
  await env.DB.prepare("DELETE FROM connections WHERE id = ?").bind(connId).run();
  return json({ ok: true }, 200, origin);
}

/* ---------- partilha selectiva de categorias ---------- */

async function connectionRoleOf(env, uid, connId) {
  const conn = await env.DB.prepare(
    "SELECT patient_id, professional_id FROM connections WHERE id = ?"
  ).bind(connId).first();
  if (!conn) return null;
  if (conn.patient_id === uid) return "patient";
  if (conn.professional_id === uid) return "professional";
  return null;
}

async function getShares(env, uid, connId, origin) {
  const role = await connectionRoleOf(env, uid, connId);
  if (!role) return json({ error: "not_found" }, 404, origin);
  const rows = await env.DB.prepare(
    "SELECT category, iv, ct, updated FROM shares WHERE connection_id = ?"
  ).bind(connId).all();
  return json({ shares: rows.results || [] }, 200, origin);
}

async function putShare(env, uid, connId, category, body, origin) {
  if (!SHARE_CATEGORIES.includes(category)) return json({ error: "unknown_category" }, 400, origin);
  const role = await connectionRoleOf(env, uid, connId);
  if (role !== "patient") return json({ error: "not_found" }, 404, origin);
  if (typeof body.iv !== "string" || typeof body.ct !== "string" ||
      typeof body.updated !== "number" || body.ct.length > MAX_BLOB) {
    return json({ error: "invalid_input" }, 400, origin);
  }
  await env.DB.prepare(
    "INSERT INTO shares (connection_id, category, iv, ct, updated) VALUES (?, ?, ?, ?, ?) " +
    "ON CONFLICT(connection_id, category) DO UPDATE SET iv = ?, ct = ?, updated = ?"
  ).bind(connId, category, body.iv, body.ct, body.updated, body.iv, body.ct, body.updated).run();
  return json({ ok: true }, 200, origin);
}

async function deleteShare(env, uid, connId, category, origin) {
  const role = await connectionRoleOf(env, uid, connId);
  if (role !== "patient") return json({ error: "not_found" }, 404, origin);
  await env.DB.prepare("DELETE FROM shares WHERE connection_id = ? AND category = ?").bind(connId, category).run();
  return json({ ok: true }, 200, origin);
}

/* ---------- administração (flag de profissional) ---------- */

async function adminSearchUsers(env, uid, query, origin) {
  if (!(await requireRole(env, uid, "admin"))) return json({ error: "forbidden" }, 403, origin);
  const q = "%" + (query || "").toLowerCase().trim().slice(0, 100) + "%";
  const rows = await env.DB.prepare(
    "SELECT id, email, role, professional_code, display_name, created_at FROM users WHERE lower(email) LIKE ? ORDER BY created_at DESC LIMIT 25"
  ).bind(q).all();
  return json({ users: rows.results || [] }, 200, origin);
}

async function adminSetRole(env, uid, targetId, body, origin) {
  if (!(await requireRole(env, uid, "admin"))) return json({ error: "forbidden" }, 403, origin);
  if (!["user", "professional", "admin"].includes(body.role)) return json({ error: "invalid_input" }, 400, origin);
  if (body.role === "professional") {
    const row = await env.DB.prepare("SELECT professional_code FROM users WHERE id = ?").bind(targetId).first();
    if (!row) return json({ error: "not_found" }, 404, origin);
    let code = row.professional_code;
    if (!code) {
      for (let i = 0; i < 5; i++) {
        const candidate = genCode();
        const clash = await env.DB.prepare("SELECT id FROM users WHERE professional_code = ?").bind(candidate).first();
        if (!clash) { code = candidate; break; }
      }
      if (!code) return json({ error: "server_error" }, 500, origin);
    }
    await env.DB.prepare("UPDATE users SET role = 'professional', professional_code = ? WHERE id = ?").bind(code, targetId).run();
    return json({ ok: true, professionalCode: code }, 200, origin);
  }
  await env.DB.prepare("UPDATE users SET role = ? WHERE id = ?").bind(body.role, targetId).run();
  return json({ ok: true }, 200, origin);
}

/* ---------- router ---------- */

export default {
  async fetch(req, env) {
    const origin = req.headers.get("Origin") || "";
    const url = new URL(req.url);
    const path = url.pathname.replace(/\/+$/, "");
    const ip = req.headers.get("CF-Connecting-IP") || "unknown";

    if (req.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders(origin) });
    }

    try {
      if (looksLikeScan(path)) {
        // esta API nunca serve estes caminhos a sério - só um scanner automático os visita.
        // regista o IP (bloqueia-o de imediato) e responde devagar com um 404 comum, sem
        // denunciar que caiu numa armadilha
        await flagIp(env, ip, "decoy_path:" + path, 1);
        await sleep(2000 + Math.floor(Math.random() * 3000));
        return json({ error: "not_found" }, 404, origin);
      }
      if (await isIpBlocked(env, ip)) {
        return json({ error: "not_found" }, 404, origin);
      }

      if (req.method === "POST" && (path === "/auth/register" || path === "/auth/login" || path === "/auth/recover/start")) {
        let body;
        try { body = await req.json(); } catch (e) { return json({ error: "invalid_json" }, 400, origin); }
        if (path === "/auth/register") return register(env, body, origin, ip);
        if (path === "/auth/login") return login(env, body, origin);
        return recoverStart(env, body, origin);
      }

      const auth = await checkToken(env, req);
      if (!auth) return json({ error: "unauthorized" }, 401, origin);

      if (req.method === "POST" && path === "/auth/recover/reset") {
        if (auth.scope !== "recovery" && auth.scope !== "full") return json({ error: "unauthorized" }, 401, origin);
        let body;
        try { body = await req.json(); } catch (e) { return json({ error: "invalid_json" }, 400, origin); }
        return recoverReset(env, auth.uid, body, origin);
      }

      // a partir daqui, só o token "full" (sessão normal) tem acesso
      if (auth.scope !== "full") return json({ error: "unauthorized" }, 401, origin);
      const uid = auth.uid;

      if (req.method === "PUT" && path === "/account/keys") {
        let body;
        try { body = await req.json(); } catch (e) { return json({ error: "invalid_json" }, 400, origin); }
        return upgradeKeys(env, uid, body, origin);
      }

      if (req.method === "PUT" && path === "/account/profile") {
        let body;
        try { body = await req.json(); } catch (e) { return json({ error: "invalid_json" }, 400, origin); }
        return updateProfile(env, uid, body, origin);
      }

      if (req.method === "GET" && path === "/data") return getData(env, uid, origin);

      const putMatch = path.match(/^\/data\/([a-z_]+)$/);
      if (req.method === "PUT" && putMatch) {
        let body;
        try { body = await req.json(); } catch (e) { return json({ error: "invalid_json" }, 400, origin); }
        return putData(env, uid, putMatch[1], body, origin);
      }

      if (req.method === "DELETE" && path === "/account") return deleteAccount(env, uid, origin);

      if (req.method === "POST" && path === "/connections") {
        let body;
        try { body = await req.json(); } catch (e) { return json({ error: "invalid_json" }, 400, origin); }
        return createConnection(env, uid, body, origin, ip);
      }
      if (req.method === "GET" && path === "/connections") return listConnections(env, uid, origin);
      const delConnMatch = path.match(/^\/connections\/(\d+)$/);
      if (req.method === "DELETE" && delConnMatch) return deleteConnection(env, uid, parseInt(delConnMatch[1], 10), origin);

      const sharesGetMatch = path.match(/^\/shares\/(\d+)$/);
      if (req.method === "GET" && sharesGetMatch) return getShares(env, uid, parseInt(sharesGetMatch[1], 10), origin);

      const sharesPutMatch = path.match(/^\/shares\/(\d+)\/([a-z_]+)$/);
      if (sharesPutMatch) {
        const connId = parseInt(sharesPutMatch[1], 10), category = sharesPutMatch[2];
        if (req.method === "PUT") {
          let body;
          try { body = await req.json(); } catch (e) { return json({ error: "invalid_json" }, 400, origin); }
          return putShare(env, uid, connId, category, body, origin);
        }
        if (req.method === "DELETE") return deleteShare(env, uid, connId, category, origin);
      }

      if (req.method === "GET" && path === "/admin/users") {
        return adminSearchUsers(env, uid, url.searchParams.get("q"), origin);
      }
      const adminRoleMatch = path.match(/^\/admin\/users\/(\d+)\/role$/);
      if (req.method === "PUT" && adminRoleMatch) {
        let body;
        try { body = await req.json(); } catch (e) { return json({ error: "invalid_json" }, 400, origin); }
        return adminSetRole(env, uid, parseInt(adminRoleMatch[1], 10), body, origin);
      }

      return json({ error: "not_found" }, 404, origin);
    } catch (e) {
      return json({ error: "server_error" }, 500, origin);
    }
  }
};
