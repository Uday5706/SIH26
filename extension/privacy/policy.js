/**
 * Privacy Policy Engine — Configurable confidence thresholds and fail-closed defaults
 * 
 * Determines the privacy action (tokenize, verify, redact) based on detection confidence.
 * Prioritizes RECALL over precision — false positives are better than PII leaks.
 * 
 * Thresholds are configurable via chrome.storage.local for tunability.
 * 
 * Part of the PRIVAGENT privacy firewall layer.
 */

window.SentraPrivacyPolicy = (function () {
  'use strict';

  // ── Default Policy Configuration ───────────────────────────────────
  // Prioritizes high recall: better to over-redact than leak PII

  const DEFAULT_CONFIG = {
    // Confidence thresholds
    thresholds: {
      autoTokenize: 0.90,      // >= this → automatic tokenization/redaction
      needsVerification: 0.60, // >= this but < autoTokenize → secondary detector needed
      conservative: 0.0        // >= this but < needsVerification → fail-closed conservative redaction
    },

    // Per-category overrides (lower thresholds = more aggressive redaction)
    categoryOverrides: {
      PASSWORD:     { autoTokenize: 0.80, sensitivity: 'HIGH' },
      CVV:          { autoTokenize: 0.80, sensitivity: 'HIGH' },
      CREDIT_CARD:  { autoTokenize: 0.85, sensitivity: 'HIGH' },
      API_KEY:      { autoTokenize: 0.80, sensitivity: 'HIGH' },
      PRIVATE_KEY:  { autoTokenize: 0.80, sensitivity: 'HIGH' },
      OTP:          { autoTokenize: 0.80, sensitivity: 'HIGH' },
      PIN:          { autoTokenize: 0.80, sensitivity: 'HIGH' },
      TOKEN:        { autoTokenize: 0.80, sensitivity: 'HIGH' },
      GOVT_ID:      { autoTokenize: 0.85, sensitivity: 'HIGH' },
      EMAIL:        { autoTokenize: 0.90, sensitivity: 'MODERATE' },
      PHONE:        { autoTokenize: 0.90, sensitivity: 'MODERATE' },
      NAME:         { autoTokenize: 0.90, sensitivity: 'MODERATE' },
      ADDRESS:      { autoTokenize: 0.90, sensitivity: 'MODERATE' },
      DOB:          { autoTokenize: 0.90, sensitivity: 'MODERATE' },
      LOCATION:     { autoTokenize: 0.92, sensitivity: 'MODERATE' },
      FACE:         { autoTokenize: 0.85, sensitivity: 'HIGH' }
    },

    // Visual redaction policies
    visualRedaction: {
      HIGH: 'opaque_mask',     // Solid black mask
      MODERATE: 'blur',        // Gaussian blur
      LOW: 'none',             // No redaction
      FACE: 'opaque_mask'      // Always mask faces
    },

    // Fail-closed behavior
    failClosed: true,          // If uncertain, treat as sensitive
    logDecisions: true         // Log policy decisions to console for debugging
  };

  let _config = JSON.parse(JSON.stringify(DEFAULT_CONFIG));
  let _configLoaded = false;

  // ── Configuration Loading ──────────────────────────────────────────

  /**
   * Load policy configuration from chrome.storage.local.
   * Falls back to defaults if nothing stored.
   */
  async function loadConfig() {
    try {
      const stored = await chrome.storage.local.get('sentra_privacy_policy');
      if (stored.sentra_privacy_policy) {
        _config = { ...DEFAULT_CONFIG, ...stored.sentra_privacy_policy };
        // Merge nested objects
        _config.thresholds = { ...DEFAULT_CONFIG.thresholds, ...(stored.sentra_privacy_policy.thresholds || {}) };
        _config.categoryOverrides = { ...DEFAULT_CONFIG.categoryOverrides, ...(stored.sentra_privacy_policy.categoryOverrides || {}) };
        _config.visualRedaction = { ...DEFAULT_CONFIG.visualRedaction, ...(stored.sentra_privacy_policy.visualRedaction || {}) };
      }
      _configLoaded = true;
    } catch (e) {
      // chrome.storage may not be available in content scripts without permission
      _configLoaded = true;
    }
  }

  /**
   * Save current policy configuration to chrome.storage.local.
   */
  async function saveConfig() {
    try {
      await chrome.storage.local.set({ sentra_privacy_policy: _config });
    } catch (e) {
      console.warn('[SentraPrivacyPolicy] Could not persist config:', e);
    }
  }

  /**
   * Update policy configuration (partial update supported).
   */
  async function updateConfig(partialConfig) {
    if (partialConfig.thresholds) {
      _config.thresholds = { ..._config.thresholds, ...partialConfig.thresholds };
    }
    if (partialConfig.categoryOverrides) {
      _config.categoryOverrides = { ..._config.categoryOverrides, ...partialConfig.categoryOverrides };
    }
    if (partialConfig.visualRedaction) {
      _config.visualRedaction = { ..._config.visualRedaction, ...partialConfig.visualRedaction };
    }
    if (partialConfig.failClosed !== undefined) {
      _config.failClosed = partialConfig.failClosed;
    }
    if (partialConfig.logDecisions !== undefined) {
      _config.logDecisions = partialConfig.logDecisions;
    }
    await saveConfig();
  }

  // ── Policy Decision Engine ─────────────────────────────────────────

  /**
   * Determine the privacy action for a detected item.
   * 
   * @param {Object} detection - Detection result
   * @param {string} detection.category - PII category (EMAIL, PERSON, etc.)
   * @param {number} detection.confidence - Detection confidence [0, 1]
   * @param {string} detection.source - Detection source (DOM, REGEX, OCR, NER, VISION)
   * @param {string} detection.sensitivity - Sensitivity level (HIGH, MODERATE, LOW, NONE)
   * @returns {Object} Decision: { action, reason, visualRedaction, tokenize, sensitivity }
   */
  function decide(detection) {
    const { category, confidence, source, sensitivity } = detection;
    const catConfig = _config.categoryOverrides[category] || {};
    const autoThreshold = catConfig.autoTokenize || _config.thresholds.autoTokenize;
    const verifyThreshold = _config.thresholds.needsVerification;
    const effectiveSensitivity = catConfig.sensitivity || sensitivity || 'MODERATE';

    let decision;

    if (confidence >= autoThreshold) {
      // ── HIGH CONFIDENCE → Auto tokenize/redact ──
      decision = {
        action: 'TOKENIZE',
        reason: `High confidence (${(confidence * 100).toFixed(0)}%) ≥ threshold (${(autoThreshold * 100).toFixed(0)}%)`,
        tokenize: true,
        redact: true,
        visualRedaction: _config.visualRedaction[effectiveSensitivity] || 'blur',
        sensitivity: effectiveSensitivity,
        needsVerification: false
      };
    } else if (confidence >= verifyThreshold) {
      // ── MEDIUM CONFIDENCE → Needs secondary verification ──
      decision = {
        action: 'VERIFY',
        reason: `Medium confidence (${(confidence * 100).toFixed(0)}%) — needs secondary detector`,
        tokenize: _config.failClosed, // If fail-closed, tokenize anyway
        redact: _config.failClosed,
        visualRedaction: _config.failClosed ? 'blur' : 'none',
        sensitivity: effectiveSensitivity,
        needsVerification: true
      };
    } else {
      // ── LOW CONFIDENCE → Depends on fail-closed policy ──
      if (_config.failClosed && sensitivity !== 'NONE') {
        decision = {
          action: 'CONSERVATIVE_REDACT',
          reason: `Low confidence (${(confidence * 100).toFixed(0)}%) but fail-closed policy active`,
          tokenize: true,
          redact: true,
          visualRedaction: 'blur',
          sensitivity: 'LOW',
          needsVerification: true
        };
      } else {
        decision = {
          action: 'PASS',
          reason: `Low confidence (${(confidence * 100).toFixed(0)}%) — no redaction needed`,
          tokenize: false,
          redact: false,
          visualRedaction: 'none',
          sensitivity: 'NONE',
          needsVerification: false
        };
      }
    }

    if (_config.logDecisions) {
      console.log(`[PrivacyPolicy] ${category} (${source}, conf=${(confidence * 100).toFixed(0)}%) → ${decision.action}: ${decision.reason}`);
    }

    return decision;
  }

  /**
   * Batch decide for multiple detections.
   */
  function decideBatch(detections) {
    return detections.map(d => ({
      ...d,
      decision: decide(d)
    }));
  }

  /**
   * Get the visual redaction method for a sensitivity level.
   */
  function getVisualRedaction(sensitivity) {
    return _config.visualRedaction[sensitivity] || 'none';
  }

  // ── Public API ─────────────────────────────────────────────────────

  // Load config on initialization
  loadConfig();

  return {
    decide,
    decideBatch,
    getVisualRedaction,
    loadConfig,
    saveConfig,
    updateConfig,
    getConfig: () => JSON.parse(JSON.stringify(_config)),
    resetConfig: () => { _config = JSON.parse(JSON.stringify(DEFAULT_CONFIG)); }
  };
})();
