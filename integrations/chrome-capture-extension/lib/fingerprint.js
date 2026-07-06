(function (global) {
  'use strict';

  function normalize(content) {
    return String(content || '')
      .replace(/\s+/g, ' ')
      .trim()
      .toLowerCase();
  }

  async function sha256(value) {
    const data = new TextEncoder().encode(value);
    const hashBuffer = await crypto.subtle.digest('SHA-256', data);
    const hashBytes = Array.from(new Uint8Array(hashBuffer));
    return hashBytes.map((byte) => byte.toString(16).padStart(2, '0')).join('');
  }

  async function compute(content) {
    const canonical = normalize(content);
    if (!canonical) {
      throw new Error('Fingerprint content must be a non-empty string');
    }
    return sha256(canonical);
  }

  global.OBFingerprint = {
    normalize,
    sha256,
    compute
  };
})(typeof globalThis !== 'undefined' ? globalThis : self);
