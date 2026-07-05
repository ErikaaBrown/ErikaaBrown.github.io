/**
 * PsicoLab — API de contas e sincronização (Cloudflare Worker, ficheiro único)
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
 * código de recuperação. Nenhuma das duas chaves originais (password ou
 * código) chega ao servidor — só as suas derivações de autenticação.
 */

const ALLOWED_ORIGINS = [
  "https://erikaabrown.github.io",
  "http://localhost:8765",
  "http://127.0.0.1:8765"
];

const TOOLS = ["mood", "thoughts", "gratitude", "habits", "sleep", "worries", "scores"];
const MAX_BLOB = 300 * 1024; // 300 KB por ferramenta
const MAX_WRAP = 2 * 1024; // wrapped DEK: bem menor que um blob de dados
const FULL_TTL_S = 60 * 60 * 24 * 30; // 30 dias
const RECOVERY_TTL_S = 60 * 15; // 15 minutos — janela curta para trocar a password

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

/* ---------- handlers ---------- */

async function register(env, body, origin) {
  if (!validEmail(body.email) || !validAuthKey(body.authKey) ||
      !validWrap(body.dekPassIv) || !validWrap(body.dekPassCt) ||
      !validAuthKey(body.recoveryAuthKey) ||
      !validWrap(body.dekRecoveryIv) || !validWrap(body.dekRecoveryCt)) {
    return json({ error: "invalid_input" }, 400, origin);
  }
  const email = body.email.toLowerCase().trim();
  const salt = hex(crypto.getRandomValues(new Uint8Array(16)));
  const hash = await sha256hex(salt + "|" + body.authKey);
  const rSalt = hex(crypto.getRandomValues(new Uint8Array(16)));
  const rHash = await sha256hex(rSalt + "|" + body.recoveryAuthKey);
  try {
    const r = await env.DB.prepare(
      "INSERT INTO users (email, auth_salt, auth_hash, recovery_salt, recovery_hash, dek_pass_iv, dek_pass_ct, dek_recovery_iv, dek_recovery_ct) " +
      "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)"
    ).bind(email, salt, hash, rSalt, rHash, body.dekPassIv, body.dekPassCt, body.dekRecoveryIv, body.dekRecoveryCt).run();
    const uid = r.meta.last_row_id;
    return json({ token: await makeToken(env, uid, "full"), email }, 200, origin);
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
    "SELECT id, auth_salt, auth_hash, dek_pass_iv, dek_pass_ct FROM users WHERE email = ?"
  ).bind(email).first();
  if (!row) return json({ error: "bad_credentials" }, 401, origin);
  const hash = await sha256hex(row.auth_salt + "|" + body.authKey);
  if (hash !== row.auth_hash) return json({ error: "bad_credentials" }, 401, origin);
  return json({
    token: await makeToken(env, row.id, "full"),
    email: email,
    dekPassIv: row.dek_pass_iv || "",
    dekPassCt: row.dek_pass_ct || ""
  }, 200, origin);
}

async function recoverStart(env, body, origin) {
  if (!validEmail(body.email) || !validAuthKey(body.recoveryAuthKey)) {
    return json({ error: "invalid_input" }, 400, origin);
  }
  const email = body.email.toLowerCase().trim();
  const row = await env.DB.prepare(
    "SELECT id, recovery_salt, recovery_hash, dek_recovery_iv, dek_recovery_ct FROM users WHERE email = ?"
  ).bind(email).first();
  if (!row || !row.recovery_hash) return json({ error: "bad_recovery" }, 401, origin);
  const hash = await sha256hex(row.recovery_salt + "|" + body.recoveryAuthKey);
  if (hash !== row.recovery_hash) return json({ error: "bad_recovery" }, 401, origin);
  return json({
    token: await makeToken(env, row.id, "recovery"),
    dekRecoveryIv: row.dek_recovery_iv,
    dekRecoveryCt: row.dek_recovery_ct
  }, 200, origin);
}

async function recoverReset(env, uid, body, origin) {
  if (!validAuthKey(body.newAuthKey) || !validWrap(body.dekPassIv) || !validWrap(body.dekPassCt)) {
    return json({ error: "invalid_input" }, 400, origin);
  }
  const salt = hex(crypto.getRandomValues(new Uint8Array(16)));
  const hash = await sha256hex(salt + "|" + body.newAuthKey);
  await env.DB.prepare(
    "UPDATE users SET auth_salt = ?, auth_hash = ?, dek_pass_iv = ?, dek_pass_ct = ? WHERE id = ?"
  ).bind(salt, hash, body.dekPassIv, body.dekPassCt, uid).run();
  return json({ token: await makeToken(env, uid, "full") }, 200, origin);
}

async function upgradeKeys(env, uid, body, origin) {
  if (!validWrap(body.dekPassIv) || !validWrap(body.dekPassCt) ||
      !validAuthKey(body.recoveryAuthKey) ||
      !validWrap(body.dekRecoveryIv) || !validWrap(body.dekRecoveryCt)) {
    return json({ error: "invalid_input" }, 400, origin);
  }
  const rSalt = hex(crypto.getRandomValues(new Uint8Array(16)));
  const rHash = await sha256hex(rSalt + "|" + body.recoveryAuthKey);
  await env.DB.prepare(
    "UPDATE users SET dek_pass_iv = ?, dek_pass_ct = ?, recovery_salt = ?, recovery_hash = ?, dek_recovery_iv = ?, dek_recovery_ct = ? WHERE id = ?"
  ).bind(body.dekPassIv, body.dekPassCt, rSalt, rHash, body.dekRecoveryIv, body.dekRecoveryCt, uid).run();
  return json({ ok: true }, 200, origin);
}

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
  await env.DB.prepare("DELETE FROM blobs WHERE user_id = ?").bind(uid).run();
  await env.DB.prepare("DELETE FROM users WHERE id = ?").bind(uid).run();
  return json({ ok: true }, 200, origin);
}

/* ---------- router ---------- */

export default {
  async fetch(req, env) {
    const origin = req.headers.get("Origin") || "";
    const url = new URL(req.url);
    const path = url.pathname.replace(/\/+$/, "");

    if (req.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders(origin) });
    }

    try {
      if (req.method === "POST" && (path === "/auth/register" || path === "/auth/login" || path === "/auth/recover/start")) {
        let body;
        try { body = await req.json(); } catch (e) { return json({ error: "invalid_json" }, 400, origin); }
        if (path === "/auth/register") return register(env, body, origin);
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

      if (req.method === "PUT" && path === "/account/keys") {
        let body;
        try { body = await req.json(); } catch (e) { return json({ error: "invalid_json" }, 400, origin); }
        return upgradeKeys(env, auth.uid, body, origin);
      }

      if (req.method === "GET" && path === "/data") return getData(env, auth.uid, origin);

      const putMatch = path.match(/^\/data\/([a-z]+)$/);
      if (req.method === "PUT" && putMatch) {
        let body;
        try { body = await req.json(); } catch (e) { return json({ error: "invalid_json" }, 400, origin); }
        return putData(env, auth.uid, putMatch[1], body, origin);
      }

      if (req.method === "DELETE" && path === "/account") return deleteAccount(env, auth.uid, origin);

      return json({ error: "not_found" }, 404, origin);
    } catch (e) {
      return json({ error: "server_error" }, 500, origin);
    }
  }
};
