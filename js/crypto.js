/* Tadbir on-device encryption.
   Everything a user types is encrypted in the browser before upload. The server stores
   only ciphertext and never receives the password or any key.

   password + email --PBKDF2--> 64 bytes: first half = login password sent to the server,
                                          second half = key-encryption key (never leaves the device)
   data key (64 random bytes: 32 AES-GCM + 32 HMAC) is stored on the server only in wrapped form,
   once under the password key and once under the recovery-code key. */
(function (root) {
  "use strict";
  var subtle = (root.crypto || globalThis.crypto).subtle;
  var rnd = function (n) { var a = new Uint8Array(n); (root.crypto || globalThis.crypto).getRandomValues(a); return a; };
  var enc = new TextEncoder(), dec = new TextDecoder();
  var PW_ITER = 600000, REC_ITER = 100000;

  function hex(buf) { return Array.prototype.map.call(new Uint8Array(buf), function (b) { return (b < 16 ? "0" : "") + b.toString(16); }).join(""); }
  function b64(buf) { var s = "", a = new Uint8Array(buf); for (var i = 0; i < a.length; i++) s += String.fromCharCode(a[i]); return btoa(s); }
  function unb64(s) { var bin = atob(s), a = new Uint8Array(bin.length); for (var i = 0; i < bin.length; i++) a[i] = bin.charCodeAt(i); return a; }
  function normEmail(e) { return String(e || "").trim().toLowerCase(); }

  async function pbkdf(secret, salt, iter, bits) {
    var base = await subtle.importKey("raw", enc.encode(secret), "PBKDF2", false, ["deriveBits"]);
    return new Uint8Array(await subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt: enc.encode(salt), iterations: iter }, base, bits));
  }
  function aesKey(raw) { return subtle.importKey("raw", raw, "AES-GCM", false, ["encrypt", "decrypt"]); }

  /* From the password: what to send as the login password, and the local key-encryption key. */
  async function master(password, email) {
    var out = await pbkdf(password, "tadbir-v1:" + normEmail(email), PW_ITER, 512);
    return { authPw: hex(out.slice(0, 32)), kek: await aesKey(out.slice(32)) };
  }
  function newRecoveryCode() { return hex(rnd(20)).toUpperCase().match(/.{4}/g).join("-"); }
  async function recoveryKek(code, email) {
    var clean = String(code || "").toUpperCase().replace(/[^0-9A-F]/g, "");
    return aesKey(await pbkdf(clean, "tadbir-rec-v1:" + normEmail(email), REC_ITER, 256));
  }
  function newDataKey() { return rnd(64); }
  async function importDataKey(raw) {
    return {
      aes: await aesKey(raw.slice(0, 32)),
      hmac: await subtle.importKey("raw", raw.slice(32), { name: "HMAC", hash: "SHA-256" }, false, ["sign"])
    };
  }
  async function encryptBytes(key, bytes) {
    var iv = rnd(12), ct = new Uint8Array(await subtle.encrypt({ name: "AES-GCM", iv: iv }, key, bytes));
    var out = new Uint8Array(12 + ct.length); out.set(iv); out.set(ct, 12); return b64(out);
  }
  async function decryptBytes(key, text) {
    var all = unb64(text);
    return new Uint8Array(await subtle.decrypt({ name: "AES-GCM", iv: all.slice(0, 12) }, key, all.slice(12)));
  }
  function wrap(kek, raw) { return encryptBytes(kek, raw); }
  function unwrap(kek, text) { return decryptBytes(kek, text); }           // throws if the key is wrong
  function seal(K, obj) { return encryptBytes(K.aes, enc.encode(JSON.stringify(obj))); }
  async function open(K, text) { return JSON.parse(dec.decode(await decryptBytes(K.aes, text))); }
  /* Opaque row id, so the server cannot tell what kind of record a row is. */
  async function rowKey(K, name) { return hex(await subtle.sign("HMAC", K.hmac, enc.encode(name))); }

  var api = { master: master, newRecoveryCode: newRecoveryCode, recoveryKek: recoveryKek, newDataKey: newDataKey,
    importDataKey: importDataKey, b64: b64, unb64: unb64, wrap: wrap, unwrap: unwrap, seal: seal, open: open, rowKey: rowKey };
  if (typeof module !== "undefined" && module.exports) module.exports = api; else root.TC = api;
})(typeof window !== "undefined" ? window : globalThis);
