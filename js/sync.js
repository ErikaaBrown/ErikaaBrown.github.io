/* PsicoLab — sincronização opcional com cifragem ponta-a-ponta.
   Configuração: substituir API_BASE pelo URL do teu Worker (ver cloudflare/README.md). */
const API_BASE = "https://psicolab-api.nightmareftw.workers.dev";

(function () {
  var SYNC_TOOLS = ["mood", "thoughts", "gratitude", "habits", "sleep", "worries", "scores", "test_results"];
  var SHARE_CATEGORIES = ["test_results", "mood", "thoughts", "gratitude", "habits", "sleep", "worries"];
  var ITERATIONS = 310000;
  var RECOVERY_ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ"; // Crockford base32, sem I/L/O/U

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
  var encKey = null;   // CryptoKey da DEK, em memória (importada do jwk guardado)
  var ecdhPriv = null; // CryptoKey privada ECDH, em memória (para partilha com profissionais)
  var pending = null;  // { email, token de recuperação, dek, ecdhPrivRaw } enquanto se define a palavra-passe nova

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

  function genRecoveryCode() {
    var bytes = crypto.getRandomValues(new Uint8Array(15)); // 120 bits, 24 símbolos base32
    var bits = "";
    for (var i = 0; i < bytes.length; i++) bits += bytes[i].toString(2).padStart(8, "0");
    var out = "";
    for (var j = 0; j < bits.length; j += 5) out += RECOVERY_ALPHABET[parseInt(bits.substr(j, 5), 2)];
    return out.match(/.{1,4}/g).join("-");
  }
  function normalizeRecoveryCode(s) {
    return String(s || "").toUpperCase().replace(/[^0-9A-Z]/g, "")
      .replace(/O/g, "0").replace(/I/g, "1").replace(/L/g, "1");
  }

  function deriveSubkeys(email, secret, authSalt, encSalt) {
    var enc = new TextEncoder();
    return crypto.subtle.importKey("raw", enc.encode(secret), "PBKDF2", false, ["deriveBits", "deriveKey"])
      .then(function (base) {
        var authP = crypto.subtle.deriveBits(
          { name: "PBKDF2", salt: enc.encode(authSalt + "|" + email), iterations: ITERATIONS, hash: "SHA-256" },
          base, 256
        );
        var encP = crypto.subtle.deriveKey(
          { name: "PBKDF2", salt: enc.encode(encSalt + "|" + email), iterations: ITERATIONS, hash: "SHA-256" },
          base, { name: "AES-GCM", length: 256 }, true, ["encrypt", "decrypt"]
        );
        return Promise.all([authP, encP]);
      })
      .then(function (r) {
        return { authKey: hexOf(r[0]), wrapKey: r[1] };
      });
  }
  function derivePassKeys(email, password) {
    return deriveSubkeys(email, password, "psicolab-auth", "psicolab-enc");
  }
  function deriveRecoveryKeys(email, code) {
    return deriveSubkeys(email, normalizeRecoveryCode(code), "psicolab-recovery-auth", "psicolab-recovery-enc");
  }

  /* ---- embrulhar/desembrulhar bytes arbitrários com uma chave AES-GCM (DEK ou chave privada ECDH) ---- */
  function wrapBytes(raw, wrapKey) {
    var iv = crypto.getRandomValues(new Uint8Array(12));
    return crypto.subtle.encrypt({ name: "AES-GCM", iv: iv }, wrapKey, raw).then(function (ct) {
      return { iv: b64(iv), ct: b64(ct) };
    });
  }
  function unwrapBytes(ivB64, ctB64, wrapKey) {
    return crypto.subtle.decrypt({ name: "AES-GCM", iv: new Uint8Array(unb64(ivB64)) }, wrapKey, unb64(ctB64));
  }

  function genDEK() {
    return crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, true, ["encrypt", "decrypt"]);
  }
  function wrapDEK(dek, wrapKey) {
    return crypto.subtle.exportKey("raw", dek).then(function (raw) { return wrapBytes(raw, wrapKey); });
  }
  function unwrapDEK(ivB64, ctB64, wrapKey) {
    return unwrapBytes(ivB64, ctB64, wrapKey).then(function (raw) {
      return crypto.subtle.importKey("raw", raw, { name: "AES-GCM" }, true, ["encrypt", "decrypt"]);
    });
  }

  /* ---- par de chaves ECDH (P-256), para partilha ponta-a-ponta com profissionais ---- */
  function genECDHPair() {
    return crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveKey", "deriveBits"]);
  }
  function exportECDHPub(publicKey) {
    return crypto.subtle.exportKey("raw", publicKey).then(b64);
  }
  function importECDHPub(pubB64) {
    return crypto.subtle.importKey("raw", unb64(pubB64), { name: "ECDH", namedCurve: "P-256" }, true, []);
  }
  function wrapECDHPriv(privateKey, wrapKey) {
    return crypto.subtle.exportKey("pkcs8", privateKey).then(function (raw) { return wrapBytes(raw, wrapKey); });
  }
  function unwrapECDHPriv(ivB64, ctB64, wrapKey) {
    return unwrapBytes(ivB64, ctB64, wrapKey).then(function (raw) {
      return crypto.subtle.importKey("pkcs8", raw, { name: "ECDH", namedCurve: "P-256" }, true, ["deriveKey", "deriveBits"]);
    });
  }
  function deriveShareKey(myPriv, otherPubB64) {
    return importECDHPub(otherPubB64).then(function (peerPub) {
      return crypto.subtle.deriveBits({ name: "ECDH", public: peerPub }, myPriv, 256);
    }).then(function (secretBits) {
      return crypto.subtle.importKey("raw", secretBits, "HKDF", false, ["deriveKey"]);
    }).then(function (hkdfKey) {
      return crypto.subtle.deriveKey(
        { name: "HKDF", hash: "SHA-256", salt: new Uint8Array(0), info: new TextEncoder().encode("psicolab-share-v1") },
        hkdfKey, { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]
      );
    });
  }

  function ensureKey() {
    if (encKey) return Promise.resolve(encKey);
    if (!acct || !acct.dek) return Promise.reject(new Error("no-key"));
    return crypto.subtle.importKey("jwk", acct.dek, { name: "AES-GCM" }, true, ["encrypt", "decrypt"])
      .then(function (k) { encKey = k; return k; });
  }
  function ensureECDHPriv() {
    if (ecdhPriv) return Promise.resolve(ecdhPriv);
    if (!acct || !acct.ecdhPriv) return Promise.reject(new Error("no-ecdh-key"));
    return crypto.subtle.importKey("jwk", acct.ecdhPriv, { name: "ECDH", namedCurve: "P-256" }, true, ["deriveKey", "deriveBits"])
      .then(function (k) { ecdhPriv = k; return k; });
  }

  function encryptWith(key, obj) {
    var iv = crypto.getRandomValues(new Uint8Array(12));
    var data = new TextEncoder().encode(JSON.stringify(obj));
    return crypto.subtle.encrypt({ name: "AES-GCM", iv: iv }, key, data).then(function (ct) {
      return { iv: b64(iv), ct: b64(ct) };
    });
  }
  function decryptWith(key, ivB64, ctB64) {
    return crypto.subtle.decrypt({ name: "AES-GCM", iv: new Uint8Array(unb64(ivB64)) }, key, unb64(ctB64))
      .then(function (plain) { return JSON.parse(new TextDecoder().decode(plain)); });
  }

  function encryptJSON(obj) { return ensureKey().then(function (key) { return encryptWith(key, obj); }); }
  function decryptJSON(ivB64, ctB64) { return ensureKey().then(function (key) { return decryptWith(key, ivB64, ctB64); }); }

  /* ---------- API ---------- */

  function api(path, method, body, tokenOverride) {
    var headers = { "Content-Type": "application/json" };
    var tok = tokenOverride || (acct && acct.token);
    if (tok) headers["Authorization"] = "Bearer " + tok;
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

  /* ---------- sincronização pessoal (ferramentas) ---------- */

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

  /* ---------- upgrade automático de contas criadas antes da recuperação/partilha ---------- */

  function upgradeAddECDH(email, dek, passWrapKey, existingDekPass) {
    // conta que já tinha DEK + recuperação (upgrade anterior a esta funcionalidade),
    // mas ainda não tinha par ECDH — gera-o agora e roda o código de recuperação
    var recoveryCode = genRecoveryCode();
    return deriveRecoveryKeys(email, recoveryCode).then(function (recKeys) {
      return Promise.all([genECDHPair(), wrapDEK(dek, recKeys.wrapKey)]).then(function (r) {
        var ecdh = r[0], dekRecovery = r[1];
        return Promise.all([
          exportECDHPub(ecdh.publicKey),
          wrapECDHPriv(ecdh.privateKey, passWrapKey),
          wrapECDHPriv(ecdh.privateKey, recKeys.wrapKey)
        ]).then(function (w) {
          var ecdhPub = w[0], ecdhPrivPass = w[1], ecdhPrivRecovery = w[2];
          return api("/account/keys", "PUT", {
            dekPassIv: existingDekPass.iv, dekPassCt: existingDekPass.ct,
            recoveryAuthKey: recKeys.authKey,
            dekRecoveryIv: dekRecovery.iv, dekRecoveryCt: dekRecovery.ct,
            ecdhPub: ecdhPub,
            ecdhPrivPassIv: ecdhPrivPass.iv, ecdhPrivPassCt: ecdhPrivPass.ct,
            ecdhPrivRecoveryIv: ecdhPrivRecovery.iv, ecdhPrivRecoveryCt: ecdhPrivRecovery.ct
          }).then(function () {
            ecdhPriv = ecdh.privateKey;
            return crypto.subtle.exportKey("jwk", ecdh.privateKey);
          }).then(function (jwk) {
            acct.ecdhPriv = jwk;
            saveAcct(acct);
            return recoveryCode;
          });
        });
      });
    });
  }

  function upgradeLegacyAccount(email, legacyKey) {
    encKey = legacyKey; // as ferramentas já sincronizadas foram cifradas directamente com esta chave
    var recoveryCode = genRecoveryCode();
    return pullAll().then(function () {
      return Promise.all([genDEK(), genECDHPair(), deriveRecoveryKeys(email, recoveryCode)])
        .then(function (r) {
          var dek = r[0], ecdh = r[1], recKeys = r[2];
          return Promise.all([
            wrapDEK(dek, legacyKey),
            wrapDEK(dek, recKeys.wrapKey),
            exportECDHPub(ecdh.publicKey),
            wrapECDHPriv(ecdh.privateKey, legacyKey),
            wrapECDHPriv(ecdh.privateKey, recKeys.wrapKey)
          ]).then(function (w) {
            var dekPass = w[0], dekRecovery = w[1], ecdhPub = w[2], ecdhPrivPass = w[3], ecdhPrivRecovery = w[4];
            return api("/account/keys", "PUT", {
              dekPassIv: dekPass.iv, dekPassCt: dekPass.ct,
              recoveryAuthKey: recKeys.authKey,
              dekRecoveryIv: dekRecovery.iv, dekRecoveryCt: dekRecovery.ct,
              ecdhPub: ecdhPub,
              ecdhPrivPassIv: ecdhPrivPass.iv, ecdhPrivPassCt: ecdhPrivPass.ct,
              ecdhPrivRecoveryIv: ecdhPrivRecovery.iv, ecdhPrivRecoveryCt: ecdhPrivRecovery.ct
            }).then(function () {
              encKey = dek;
              ecdhPriv = ecdh.privateKey;
              return Promise.all([
                crypto.subtle.exportKey("jwk", dek),
                crypto.subtle.exportKey("jwk", ecdh.privateKey)
              ]);
            }).then(function (jwks) {
              acct.dek = jwks[0];
              acct.ecdhPriv = jwks[1];
              saveAcct(acct);
              return pushAll().then(function () { return recoveryCode; });
            });
          });
        });
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
    syncedTools: function () { return SYNC_TOOLS.slice(); },
    user: function () {
      return acct ? {
        email: acct.email, role: acct.role || "user", professionalCode: acct.professionalCode || "",
        displayName: acct.displayName || "", avatar: acct.avatar || "", bio: acct.bio || ""
      } : null;
    },

    register: function (email, password, honeypot) {
      email = email.toLowerCase().trim();
      var recoveryCode = genRecoveryCode();
      return Promise.all([derivePassKeys(email, password), deriveRecoveryKeys(email, recoveryCode)])
        .then(function (r) {
          var passKeys = r[0], recKeys = r[1];
          return Promise.all([genDEK(), genECDHPair()]).then(function (g) {
            var dek = g[0], ecdh = g[1];
            return Promise.all([
              wrapDEK(dek, passKeys.wrapKey), wrapDEK(dek, recKeys.wrapKey),
              exportECDHPub(ecdh.publicKey),
              wrapECDHPriv(ecdh.privateKey, passKeys.wrapKey), wrapECDHPriv(ecdh.privateKey, recKeys.wrapKey)
            ]).then(function (w) {
              var dekPass = w[0], dekRecovery = w[1], ecdhPub = w[2], ecdhPrivPass = w[3], ecdhPrivRecovery = w[4];
              return api("/auth/register", "POST", {
                email: email, authKey: passKeys.authKey, hp: honeypot || "",
                dekPassIv: dekPass.iv, dekPassCt: dekPass.ct,
                recoveryAuthKey: recKeys.authKey,
                dekRecoveryIv: dekRecovery.iv, dekRecoveryCt: dekRecovery.ct,
                ecdhPub: ecdhPub,
                ecdhPrivPassIv: ecdhPrivPass.iv, ecdhPrivPassCt: ecdhPrivPass.ct,
                ecdhPrivRecoveryIv: ecdhPrivRecovery.iv, ecdhPrivRecoveryCt: ecdhPrivRecovery.ct
              }).then(function (r2) {
                return Promise.all([crypto.subtle.exportKey("jwk", dek), crypto.subtle.exportKey("jwk", ecdh.privateKey)])
                  .then(function (jwks) {
                    acct = {
                      token: r2.token, email: r2.email, role: r2.role || "user",
                      displayName: "", avatar: "", bio: "",
                      dek: jwks[0], ecdhPriv: jwks[1]
                    };
                    encKey = dek;
                    ecdhPriv = ecdh.privateKey;
                    saveAcct(acct);
                    saveMeta({});
                    return pushAll().then(function () { return { recoveryCode: recoveryCode }; });
                  });
              });
            });
          });
        });
    },

    login: function (email, password) {
      email = email.toLowerCase().trim();
      return derivePassKeys(email, password).then(function (passKeys) {
        return api("/auth/login", "POST", { email: email, authKey: passKeys.authKey }).then(function (r) {
          // fica só em memória até a DEK ser desembrulhada com sucesso — saveAcct() só
          // no fim, para nunca persistir uma conta "a meio" sem chave utilizável
          acct = {
            token: r.token, email: r.email, role: r.role || "user", professionalCode: r.professionalCode || "",
            displayName: r.displayName || "", avatar: r.avatar || "", bio: r.bio || "",
            dek: null, ecdhPriv: null
          };
          saveMeta({});

          if (!r.dekPassCt) {
            // conta anterior à funcionalidade de recuperação/partilha: sobe de nível de forma transparente
            return upgradeLegacyAccount(email, passKeys.wrapKey).then(function (recoveryCode) {
              return { recoveryCode: recoveryCode, upgraded: true };
            });
          }

          return unwrapDEK(r.dekPassIv, r.dekPassCt, passKeys.wrapKey).then(function (dek) {
            encKey = dek;
            if (!r.ecdhPrivPassCt) {
              // já tinha DEK + recuperação (upgrade anterior a esta funcionalidade), mas ainda
              // não tinha par ECDH — gera-o agora, sem perder a DEK nem os dados já cifrados
              return crypto.subtle.exportKey("jwk", dek).then(function (dekJwk) {
                acct.dek = dekJwk;
                return upgradeAddECDH(email, dek, passKeys.wrapKey, { iv: r.dekPassIv, ct: r.dekPassCt });
              }).then(function (recoveryCode) {
                return pullAll().then(function (changed) {
                  return pushAll().then(function () {
                    return { recoveryCode: recoveryCode, upgraded: true, changed: changed };
                  });
                });
              });
            }
            return unwrapECDHPriv(r.ecdhPrivPassIv, r.ecdhPrivPassCt, passKeys.wrapKey).then(function (priv) {
              ecdhPriv = priv;
              return Promise.all([crypto.subtle.exportKey("jwk", dek), crypto.subtle.exportKey("jwk", priv)]);
            }).then(function (jwks) {
              acct.dek = jwks[0];
              acct.ecdhPriv = jwks[1];
              saveAcct(acct);
              return pullAll().then(function (changed) {
                return pushAll().then(function () { return { changed: changed }; });
              });
            });
          });
        });
      });
    },

    logout: function () {
      acct = null;
      encKey = null;
      ecdhPriv = null;
      saveAcct(null);
      saveMeta({});
    },

    syncNow: function () {
      if (!acct) return Promise.resolve(0);
      return pullAll().then(function (changed) {
        return pushAll().then(function () { return changed; });
      });
    },

    updateProfile: function (profile) {
      var displayName = (profile.displayName || "").trim().slice(0, 60);
      var bio = (profile.bio || "").trim().slice(0, 500);
      var avatar = profile.avatar || "";
      return api("/account/profile", "PUT", { displayName: displayName, bio: bio, avatar: avatar }).then(function () {
        if (acct) {
          acct.displayName = displayName;
          acct.bio = bio;
          acct.avatar = avatar;
          saveAcct(acct);
        }
      });
    },

    deleteAccount: function () {
      return api("/account", "DELETE").then(function () {
        acct = null; encKey = null; ecdhPriv = null;
        saveAcct(null); saveMeta({});
      });
    },

    /* ---- recuperação de acesso (esqueci-me da palavra-passe) ---- */

    recoverStart: function (email, code) {
      email = email.toLowerCase().trim();
      return deriveRecoveryKeys(email, code).then(function (recKeys) {
        return api("/auth/recover/start", "POST", { email: email, recoveryAuthKey: recKeys.authKey }).then(function (r) {
          return Promise.all([
            unwrapDEK(r.dekRecoveryIv, r.dekRecoveryCt, recKeys.wrapKey),
            unwrapECDHPriv(r.ecdhPrivRecoveryIv, r.ecdhPrivRecoveryCt, recKeys.wrapKey)
          ]).then(function (keys) {
            pending = { email: email, token: r.token, dek: keys[0], ecdhPriv: keys[1] };
            return true;
          });
        });
      });
    },

    recoverSetPassword: function (newPassword) {
      if (!pending) return Promise.reject(new Error("no-pending-recovery"));
      var email = pending.email, dek = pending.dek, priv = pending.ecdhPriv, token = pending.token;
      return derivePassKeys(email, newPassword).then(function (passKeys) {
        return Promise.all([wrapDEK(dek, passKeys.wrapKey), wrapECDHPriv(priv, passKeys.wrapKey)]).then(function (w) {
          var dekPass = w[0], ecdhPrivPass = w[1];
          return api("/auth/recover/reset", "POST", {
            newAuthKey: passKeys.authKey,
            dekPassIv: dekPass.iv, dekPassCt: dekPass.ct,
            ecdhPrivPassIv: ecdhPrivPass.iv, ecdhPrivPassCt: ecdhPrivPass.ct
          }, token).then(function (r) {
            return Promise.all([crypto.subtle.exportKey("jwk", dek), crypto.subtle.exportKey("jwk", priv)])
              .then(function (jwks) {
                acct = {
                  token: r.token, email: r.email || email, role: r.role || "user", professionalCode: r.professionalCode || "",
                  displayName: r.displayName || "", avatar: r.avatar || "", bio: r.bio || "",
                  dek: jwks[0], ecdhPriv: jwks[1]
                };
                encKey = dek;
                ecdhPriv = priv;
                saveAcct(acct);
                saveMeta({});
                pending = null;
                return pullAll().then(function (changed) {
                  return pushAll().then(function () { return changed; });
                });
              });
          });
        });
      });
    },

    recoverCancel: function () { pending = null; },

    /* ---- ligação e partilha com profissionais ---- */

    shareCategories: function () { return SHARE_CATEGORIES.slice(); },

    connect: function (professionalCode) {
      return api("/connections", "POST", { professionalCode: professionalCode.toUpperCase().trim() });
    },

    listConnections: function () {
      return api("/connections");
    },

    disconnect: function (connectionId) {
      return api("/connections/" + connectionId, "DELETE");
    },

    getShareStatus: function (connectionId) {
      return api("/shares/" + connectionId).then(function (r) {
        var on = {};
        (r.shares || []).forEach(function (s) { on[s.category] = s.updated; });
        return on;
      });
    },

    setShare: function (connectionId, category, otherPub, on) {
      if (!on) return api("/shares/" + connectionId + "/" + category, "DELETE");
      return ensureECDHPriv().then(function (priv) {
        return deriveShareKey(priv, otherPub).then(function (shareKey) {
          var raw = localStorage.getItem("pl_" + category);
          var value = null;
          try { value = raw !== null ? JSON.parse(raw) : (category === "test_results" ? [] : {}); } catch (e) { value = {}; }
          return encryptWith(shareKey, value).then(function (encd) {
            return api("/shares/" + connectionId + "/" + category, "PUT", { iv: encd.iv, ct: encd.ct, updated: Date.now() });
          });
        });
      });
    },

    refreshShares: function (connectionId, otherPub, categories) {
      return categories.reduce(function (p, cat) {
        return p.then(function () { return PLSync.setShare(connectionId, cat, otherPub, true); });
      }, Promise.resolve());
    },

    readShared: function (connectionId, otherPub) {
      return ensureECDHPriv().then(function (priv) {
        return deriveShareKey(priv, otherPub).then(function (shareKey) {
          return api("/shares/" + connectionId).then(function (r) {
            var out = {};
            var chain = Promise.resolve();
            (r.shares || []).forEach(function (s) {
              chain = chain.then(function () {
                return decryptWith(shareKey, s.iv, s.ct).then(function (value) {
                  out[s.category] = { value: value, updated: s.updated };
                }).catch(function () {
                  console.debug("[PsicoLab sync] não foi possível decifrar partilha:", s.category);
                });
              });
            });
            return chain.then(function () { return out; });
          });
        });
      });
    },

    /* ---- administração (gestão de contas profissionais) ---- */

    adminSearchUsers: function (query) {
      return api("/admin/users?q=" + encodeURIComponent(query || ""));
    },
    adminSetRole: function (userId, role) {
      return api("/admin/users/" + userId + "/role", "PUT", { role: role });
    }
  };

  /* ---------- arranque ---------- */

  hookStore();
  document.dispatchEvent(new CustomEvent("pl:sync-ready"));

  if (configured() && acct && acct.dek) {
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
