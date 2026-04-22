(function (global) {
  'use strict';

  const EMPTY_PATTERNS = {
    restricted: [],
    personal: []
  };

  let compiledPatternsPromise = null;

  function getPatternsUrl() {
    if (global.chrome && global.chrome.runtime && typeof global.chrome.runtime.getURL === 'function') {
      return global.chrome.runtime.getURL('data/sensitivity-patterns.json');
    }
    return 'data/sensitivity-patterns.json';
  }

  function compileGroup(entries) {
    return (Array.isArray(entries) ? entries : [])
      .map((entry) => {
        if (!entry || typeof entry.pattern !== 'string') {
          return null;
        }

        try {
          return {
            label: String(entry.label || '').trim() || 'pattern',
            regex: new RegExp(entry.pattern, entry.flags || '')
          };
        } catch (error) {
          console.warn('[Open Brain Capture] Invalid sensitivity pattern skipped', entry, error);
          return null;
        }
      })
      .filter(Boolean);
  }

  async function loadPatterns() {
    if (!compiledPatternsPromise) {
      compiledPatternsPromise = fetch(getPatternsUrl())
        .then((response) => {
          if (!response.ok) {
            throw new Error(`Unable to load bundled sensitivity patterns (${response.status})`);
          }
          return response.json();
        })
        .then((raw) => ({
          restricted: compileGroup(raw.restricted),
          personal: compileGroup(raw.personal)
        }))
        .catch((error) => {
          console.error('[Open Brain Capture] Falling back to empty sensitivity patterns', error);
          return EMPTY_PATTERNS;
        });
    }

    return compiledPatternsPromise;
  }

  async function detectSensitivity(text) {
    const patterns = await loadPatterns();
    const value = String(text || '');
    const restrictedMatches = patterns.restricted.filter((entry) => entry.regex.test(value)).map((entry) => entry.label);
    if (restrictedMatches.length > 0) {
      return {
        tier: 'restricted',
        labels: restrictedMatches
      };
    }

    const personalMatches = patterns.personal.filter((entry) => entry.regex.test(value)).map((entry) => entry.label);
    if (personalMatches.length > 0) {
      return {
        tier: 'personal',
        labels: personalMatches
      };
    }

    return {
      tier: 'standard',
      labels: []
    };
  }

  async function containsRestrictedContent(text) {
    const result = await detectSensitivity(text);
    return result.tier === 'restricted';
  }

  global.OBSensitivity = {
    loadPatterns,
    detectSensitivity,
    containsRestrictedContent
  };
})(typeof globalThis !== 'undefined' ? globalThis : self);
