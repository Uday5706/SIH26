/**
 * Token Vault — Privacy-preserving bidirectional token ↔ real value store
 * 
 * Maintains a session-scoped vault of semantic tokens that replace PII before
 * data leaves the device. The vault NEVER crosses the network boundary.
 * 
 * Token format: [CATEGORY_NN] e.g. [PERSON_01], [EMAIL_02], [PHONE_01]
 * 
 * Usage:
 *   const token = SentraTokenVault.tokenize('EMAIL', 'rahul@gmail.com');
 *   // → "[EMAIL_01]"
 *   const real = SentraTokenVault.resolve('[EMAIL_01]');
 *   // → "rahul@gmail.com"
 * 
 * Part of the PRIVAGENT privacy firewall layer.
 */

window.SentraTokenVault = (function () {
  'use strict';

  // ── Vault State ────────────────────────────────────────────────────
  let _vault = {
    sessionId: null,
    pageUrl: '',
    pageTitle: '',
    createdAt: null,
    lastUpdated: null,

    // Core mappings
    tokenToReal: {},    // "[EMAIL_01]" → "rahul@gmail.com"
    realToToken: {},    // "rahul@gmail.com" → "[EMAIL_01]"

    // Category counters for sequential numbering
    counters: {},       // { EMAIL: 2, PERSON: 1, PHONE: 1 }

    // Detailed field records
    fields: [],         // [{ fieldId, elementId, selector, category, sensitivity, token, realValue, timestamp }]

    // Element ID → token mapping for quick action resolution
    elementTokenMap: {} // "e17" → "[EMAIL_01]"
  };

  // ── Initialization ─────────────────────────────────────────────────

  function init() {
    _vault.sessionId = `vault_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    _vault.pageUrl = window.location.href;
    _vault.pageTitle = document.title;
    _vault.createdAt = Date.now();
    _vault.lastUpdated = Date.now();
  }

  function reset() {
    _vault = {
      sessionId: `vault_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      pageUrl: window.location.href,
      pageTitle: document.title,
      createdAt: Date.now(),
      lastUpdated: Date.now(),
      tokenToReal: {},
      realToToken: {},
      counters: {},
      fields: [],
      elementTokenMap: {}
    };
  }

  // ── Tokenization ───────────────────────────────────────────────────

  /**
   * Generate a semantic token for a value.
   * If the value was already tokenized, returns the existing token.
   * 
   * @param {string} category - PII category (EMAIL, PERSON, PHONE, etc.)
   * @param {string} realValue - The actual sensitive value
   * @param {Object} context - Optional context { elementId, fieldId, selector, sensitivity }
   * @returns {string} Semantic token like "[EMAIL_01]"
   */
  function tokenize(category, realValue, context = {}) {
    if (!realValue || realValue.trim().length === 0) return '';

    const cat = (category || 'GENERAL').toUpperCase();
    const trimmedValue = realValue.trim();

    // Check if this value was already tokenized
    if (_vault.realToToken[trimmedValue]) {
      const existingToken = _vault.realToToken[trimmedValue];
      // Update element mapping if context provides new element ID
      if (context.elementId) {
        _vault.elementTokenMap[context.elementId] = existingToken;
      }
      return existingToken;
    }

    // Generate new token
    _vault.counters[cat] = (_vault.counters[cat] || 0) + 1;
    const num = String(_vault.counters[cat]).padStart(2, '0');
    const token = `[${cat}_${num}]`;

    // Store mappings
    _vault.tokenToReal[token] = trimmedValue;
    _vault.realToToken[trimmedValue] = token;

    // Store field record
    _vault.fields.push({
      fieldId: context.fieldId || null,
      elementId: context.elementId || null,
      selector: context.selector || null,
      category: cat,
      sensitivity: context.sensitivity || 'MODERATE',
      token: token,
      realValue: trimmedValue,
      timestamp: Date.now()
    });

    // Map element ID to token for action resolution
    if (context.elementId) {
      _vault.elementTokenMap[context.elementId] = token;
    }

    _vault.lastUpdated = Date.now();
    return token;
  }

  // ── Resolution ─────────────────────────────────────────────────────

  /**
   * Resolve a semantic token back to its real value.
   * Used locally when executing actions from the server.
   * 
   * @param {string} token - Token like "[EMAIL_01]" or element ID like "e17"
   * @returns {string|null} Real value, or null if not found
   */
  function resolve(token) {
    if (!token) return null;

    // Direct token lookup
    if (_vault.tokenToReal[token]) {
      return _vault.tokenToReal[token];
    }

    // Element ID lookup → token → real value
    const elementToken = _vault.elementTokenMap[token];
    if (elementToken && _vault.tokenToReal[elementToken]) {
      return _vault.tokenToReal[elementToken];
    }

    return null;
  }

  /**
   * Resolve a value that might be a token or a plain value.
   * If it's a token pattern [CATEGORY_NN], resolve it.
   * Otherwise return as-is.
   */
  function resolveIfToken(value) {
    if (!value) return value;
    if (typeof value !== 'string') return value;

    // Check if it matches token pattern
    if (/^\[.+_\d{2,}\]$/.test(value)) {
      const resolved = resolve(value);
      return resolved !== null ? resolved : value;
    }

    return value;
  }

  /**
   * Get the token for a given real value (reverse lookup).
   */
  function getToken(realValue) {
    if (!realValue) return null;
    return _vault.realToToken[realValue.trim()] || null;
  }

  /**
   * Get the token associated with an element ID.
   */
  function getTokenForElement(elementId) {
    return _vault.elementTokenMap[elementId] || null;
  }

  // ── Sanitization Helpers ───────────────────────────────────────────

  /**
   * Sanitize a string by replacing all known real values with their tokens.
   * Useful for sanitizing free-text fields or DOM snapshots.
   */
  function sanitizeString(str) {
    if (!str || typeof str !== 'string') return str;

    let sanitized = str;
    // Sort by length descending to replace longer values first (avoid partial matches)
    const entries = Object.entries(_vault.realToToken)
      .sort((a, b) => b[0].length - a[0].length);

    for (const [real, token] of entries) {
      if (real.length >= 3 && sanitized.includes(real)) {
        sanitized = sanitized.split(real).join(token);
      }
    }

    return sanitized;
  }

  /**
   * Desanitize a string by replacing all tokens with real values.
   * Used locally when displaying or executing with real data.
   */
  function desanitizeString(str) {
    if (!str || typeof str !== 'string') return str;

    let desanitized = str;
    for (const [token, real] of Object.entries(_vault.tokenToReal)) {
      if (desanitized.includes(token)) {
        desanitized = desanitized.split(token).join(real);
      }
    }

    return desanitized;
  }

  // ── Snapshot & Debug ───────────────────────────────────────────────

  /**
   * Synchronize tokens created by background workers (e.g., NER) into the local vault.
   * @param {Array} tokens - [{category, realValue, context}]
   */
  function syncTokens(tokens) {
    if (!tokens || !Array.isArray(tokens)) return;
    tokens.forEach(t => {
      tokenize(t.category, t.realValue, t.context);
    });
  }

  /**
   * Get a safe snapshot of the vault for debugging (excludes real values).
   * This is safe to log but NOT to send over the network.
   */
  function getDebugSnapshot() {
    return {
      sessionId: _vault.sessionId,
      pageUrl: _vault.pageUrl,
      pageTitle: _vault.pageTitle,
      createdAt: _vault.createdAt,
      lastUpdated: _vault.lastUpdated,
      totalTokens: Object.keys(_vault.tokenToReal).length,
      categories: { ..._vault.counters },
      tokens: Object.keys(_vault.tokenToReal),
      elementMappings: Object.keys(_vault.elementTokenMap).length
    };
  }

  /**
   * Get the full vault state. ⚠️ Contains real values — NEVER transmit.
   */
  function getFullState() {
    return { ..._vault };
  }

  /**
   * Get count of tokens by category.
   */
  function getCategoryCounts() {
    return { ..._vault.counters };
  }

  /**
   * Check if vault has any tokens.
   */
  function isEmpty() {
    return Object.keys(_vault.tokenToReal).length === 0;
  }

  // Initialize on load
  init();

  return {
    // Core
    tokenize,
    resolve,
    resolveIfToken,
    getToken,
    getTokenForElement,

    // Sanitization
    sanitizeString,
    desanitizeString,

    // Lifecycle
    reset,
    init,

    // Introspection
    syncTokens,
    getDebugSnapshot,
    getFullState,
    getCategoryCounts,
    isEmpty
  };
})();
