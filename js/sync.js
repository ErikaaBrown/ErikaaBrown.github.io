/* PsicoLab — sincronização opcional com cifragem ponta-a-ponta.
   Configuração: substituir API_BASE pelo URL do teu Worker (ver cloudflare/README.md). */
var API_BASE = "COLA_AQUI_O_URL_DO_WORKER"; // ex.: "https://psicolab-api.exemplo.workers.dev"

(function () {
  var SYNC_TOOLS = ["mood", "thoughts", "gratitude", "habits"];
  var ITERATIONS = 310000;

  function configured() {
    return /^https:\/\//.test(API_BASE);
  }

  function loadAcct() {
    try { return JSON.parse(localStorage.getItem("pl_account")) || null; } catch (e) { return null; }
  }
  function saveAcct(a) {
    if (a) localStorage.setItem("pl_account", JSON.stringify(a));
    else localStorage.removeItem("pl_account");
  }
  function loadMeta() {
    try { return JSON.parse(localStorage.getItem("pl_sync_meta")) || {}; } catch (e) { return {}; }
  }
  function saveMeta(m) { localStorage.setItem("pl_sync_meta", JSON.stringify(m)); }

  var acct = loadAcct();
  var encKey = null; // CryptoKey em memória (importada do jwk guardado)

  /* ---------- criptografia (WebCrypto) ---------- */

  function b64(buf) {
    var bytes = new Uint8Array(buf), s = "";
    for (var i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
    return btoa(s);
  }
  function unb64(s) {
    var bin = atob(s), bytes = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return bytes.buffer;
  }
  function hexOf(buf) {
    return Array.prototype.map.call(new Uint8Array(buf), function (b) {
      return b.toString(16).padStart(2, "0");
    }).join("");
  }

  function deriveKeys(email, password) {
    var enc = new TextEncoder();
    return crypto.subtle.importKey("raw", enc.encode(password), "PBKDF2", false, ["deriveBits", "deriveKey"])
      .then(function (base) {
        var authP = crypto.subtle.deriveBits(
          { name: "PBKDF2", salt: enc.encode("psicolab-auth|" + email), iterations: ITERATIONS, hash: "SHA-256" },
          base, 256
        );
        var encP = crypto.subtle.deriveKey(
          { name: "PBKDF2", salt: enc.encode("psicolab-enc|" + email), iterations: ITERATIONS, hash: "SHA-256" },
          base, { name: "AES-GCM", length: 256 }, true, ["encrypt", "decrypt"]
        );
        return Promise.all([authP, encP]);
      })
      .then(function (r) {
        return { authKey: hexOf(r[0]), encKey: r[1] };
      });
  }

  function ensureKey() {
    if (encKey) return Promise.resolve(encKey);
    if (!acct || !acct.jwk) return Promise.reject(new Error("no-key"));
    return crypto.subtle.importKey("jwk", acct.jwk, { name: "AES-GCM" }, true, ["encrypt", "decrypt"])
      .then(function (k) { encKey = k; return k; });
  }

  function encryptJSON(obj) {
    return ensureKey().then(function (key) {
      var iv = crypto.getRandomValues(new Uint8Array(12));
      var data = new TextEncoder().encode(JSON.stringify(obj));
      return crypto.subtle.encrypt({ name: "AES-GCM", iv: iv }, key, data).then(function (ct) {
        return { iv: b64(iv), ct: b64(ct) };
      });
    });
  }

  function decryptJSON(ivB64, ctB64) {
    return ensureKey().then(function (key) {
      return crypto.subtle.decrypt({ name: "AES-GCM", iv: new Uint8Array(unb64(ivB64)) }, key, unb64(ctB64));
    }).then(function (plain) {
      return JSON.parse(new TextDecoder().decode(plain));
    });
  }

  /* ---------- API ---------- */

  function api(path, method, body) {
    var headers = { "Content-Type": "application/json" };
    if (acct && acct.token) headers["Authorization"] = "Bearer " + acct.token;
    return fetch(API_BASE + path, {
      method: method || "GET",
      headers: headers,
      body: body ? JSON.stringify(body) : undefined
    }).then(function (res) {
      return res.json().catch(function () { return {}; }).then(function (data) {
        if (!res.ok) {
          var err = new Error(data.error || "http_" + res.status);
          err.code = data.error || "http_" + res.status;
          throw err;
        }
        return data;
      });
    });
  }

  /* ---------- sincronização ---------- */

  function pushTool(tool) {
    var raw = localStorage.getItem("pl_" + tool);
    if (raw === null || !acct) return Promise.resolve();
    var meta = loadMeta();
    var updated = meta[tool] || Date.now();
    var value;
    try { value = JSON.parse(raw); } catch (e) { return Promise.resolve(); }
    return encryptJSON(value).then(function (encd) {
      return api("/data/" + tool, "PUT", { iv: encd.iv, ct: encd.ct, updated: updated });
    }).catch(function (e) {
      if (e.code === "stale") return pullAll();
      console.debug("[PsicoLab sync] push falhou:", e.code || e.message);
    });
  }

  function pushAll() {
    return SYNC_TOOLS.reduce(function (p, t) {
      return p.then(function () { return pushTool(t); });
    }, Promise.resolve());
  }

  function pullAll() {
    if (!acct) return Promise.resolve(0);
    return api("/data").then(function (data) {
      var meta = loadMeta();
      var chain = Promise.resolve(0);
      (data.blobs || []).forEach(function (blob) {
        if (SYNC_TOOLS.indexOf(blob.tool) < 0) return;
        if (blob.updated <= (meta[blob.tool] || 0)) return;
        chain = chain.then(function (n) {
          return decryptJSON(blob.iv, blob.ct).then(function (value) {
            localStorage.setItem("pl_" + blob.tool, JSON.stringify(value));
            meta[blob.tool] = blob.updated;
            saveMeta(meta);
            return n + 1;
          }).catch(function () {
            console.debug("[PsicoLab sync] não foi possível decifrar", blob.tool);
            return n;
          });
        });
      });
      return chain;
    });
  }

  /* ---------- gancho no PL.store ---------- */

  var pushTimers = {};
  function hookStore() {
    if (!window.PL) return;
    var orig = PL.store;
    PL.store = function (key, val) {
      orig(key, val);
      if (SYNC_TOOLS.indexOf(key) >= 0 && acct && configured()) {
        var meta = loadMeta();
        meta[key] = Date.now();
        saveMeta(meta);
        clearTimeout(pushTimers[key]);
        pushTimers[key] = setTimeout(function () { pushTool(key); }, 1500);
      }
    };
  }

  /* ---------- API pública ---------- */

  window.PLSync = {
    configured: configured,
    user: function () { return acct ? { email: acct.email } : null; },

    register: function (email, password) {
      email = email.toLowerCase().trim();
      return deriveKeys(email, password).then(function (keys) {
        return api("/auth/register", "POST", { email: email, authKey: keys.authKey }).then(function (r) {
          return crypto.subtle.exportKey("jwk", keys.encKey).then(function (jwk) {
            acct = { token: r.token, email: r.email, jwk: jwk };
            encKey = keys.encKey;
            saveAcct(acct);
            saveMeta({});
            return pushAll();
          });
        });
      });
    },

    login: function (email, password) {
      email = email.toLowerCase().trim();
      return deriveKeys(email, password).then(function (keys) {
        return api("/auth/login", "POST", { email: email, authKey: keys.authKey }).then(function (r) {
          return crypto.subtle.exportKey("jwk", keys.encKey).then(function (jwk) {
            acct = { token: r.token, email: r.email, jwk: jwk };
            encKey = keys.encKey;
            saveAcct(acct);
            saveMeta({}); // força o pull a aceitar tudo o que vier do servidor
            return pullAll().then(function (changed) {
              return pushAll().then(function () { return changed; });
            });
          });
        });
      });
    },

    logout: function () {
      acct = null;
      encKey = null;
      saveAcct(null);
      saveMeta({});
    },

    syncNow: function () {
      if (!acct) return Promise.resolve(0);
      return pullAll().then(function (changed) {
        return pushAll().then(function () { return changed; });
      });
    },

    deleteAccount: function () {
      return api("/account", "DELETE").then(function () {
        acct = null; encKey = null;
        saveAcct(null); saveMeta({});
      });
    }
  };

  /* ---------- arranque ---------- */

  hookStore();
  document.dispatchEvent(new CustomEvent("pl:sync-ready"));

  if (configured() && acct) {
    pullAll().then(function (changed) {
      if (changed > 0 && !/account\.html/.test(location.pathname) &&
          !sessionStorage.getItem("pl_sync_reloaded")) {
        sessionStorage.setItem("pl_sync_reloaded", "1");
        location.reload();
      } else {
        sessionStorage.removeItem("pl_sync_reloaded");
      }
    }).catch(function (e) {
      console.debug("[PsicoLab sync] pull falhou:", e.code || e.message);
    });
  }
})();
