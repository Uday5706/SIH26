/**
 * Action Guard — Validates server-proposed actions before local execution
 * 
 * Every action the remote server proposes must pass through the Action Guard
 * before execution. Validates: element existence, state revision compatibility,
 * element visibility/interactability, role/label match, and permission checks.
 * 
 * Also handles token resolution — when the server says "fill EMAIL_01",
 * the guard resolves it to the real value from the local vault.
 * 
 * Part of the PRIVAGENT local agent layer.
 */

window.SentraActionGuard = (function () {
  'use strict';

  // ── Validation ─────────────────────────────────────────────────────

  /**
   * Validate a proposed action before execution.
   * 
   * @param {Object} action - Server-proposed action
   * @param {string} action.action - Action type (click, type, scroll, wait, finish)
   * @param {string} action.element_id - Target element's sentra ID (e.g., "e17")
   * @param {string} [action.value_token] - Token to resolve (e.g., "[EMAIL_01]")
   * @param {string} [action.value] - Direct value (if no token)
   * @param {number} [action.revision] - Server's state revision when action was planned
   * @param {Object} options - Validation options
   * @param {number} options.currentRevision - Current DOM observer revision
   * @returns {Object} { valid, action, reason, resolvedValue }
   */
  function validate(action, options = {}) {
    if (!action) {
      return reject('MALFORMED', 'Action is null or undefined');
    }

    if (!action.action) {
      return reject('MALFORMED', 'Missing action type');
    }

    const actionType = action.action.toLowerCase();

    // ── Finish action always passes ──
    if (actionType === 'finish' || actionType === 'wait' || actionType === 'wait_for_mutation') {
      return approve(action);
    }

    // ── Scroll without a target is valid ──
    if (actionType === 'scroll' && !action.element_id && !action.target_selector) {
      return approve(action);
    }

    // ── Validate element target ──
    const targetEl = resolveElement(action);
    if (!targetEl) {
      return reject('ELEMENT_NOT_FOUND', `Cannot find element: ${action.element_id || action.target_selector || 'no target'}`, options.currentRevision);
    }

    // ── Visibility check ──
    if (!isVisible(targetEl)) {
      return reject('ELEMENT_NOT_VISIBLE', `Element ${action.element_id} is not visible`, options.currentRevision);
    }

    // ── Interactability check ──
    if (actionType !== 'scroll' && !isInteractable(targetEl)) {
      return reject('ELEMENT_NOT_INTERACTABLE', `Element ${action.element_id} is disabled or not interactable`, options.currentRevision);
    }

    // ── Revision compatibility check ──
    if (action.revision !== undefined && options.currentRevision !== undefined) {
      const revDiff = options.currentRevision - action.revision;
      if (revDiff > 5) {
        // State has changed significantly since the action was planned
        return reject('STALE_REVISION', `State has changed significantly (rev ${action.revision} → ${options.currentRevision}, diff=${revDiff}). Action may be outdated.`, options.currentRevision);
      }
    }

    // ── Role/type sanity check ──
    if (action.expected_role) {
      const actualRole = targetEl.getAttribute('role') || targetEl.tagName.toLowerCase();
      if (actualRole !== action.expected_role) {
        console.warn(`[ActionGuard] Role mismatch: expected '${action.expected_role}', got '${actualRole}'. Allowing with warning.`);
      }
    }

    // ── Resolve token values ──
    let resolvedValue = action.value || null;
    if (action.value_token) {
      resolvedValue = resolveToken(action.value_token);
      if (resolvedValue === null) {
        // Token not found in vault — might be a plain value token
        console.warn(`[ActionGuard] Token '${action.value_token}' not found in vault. Using raw token as value.`);
        resolvedValue = action.value_token;
      }
    }

    return {
      valid: true,
      action: actionType,
      element: targetEl,
      elementId: action.element_id || targetEl.getAttribute('data-sentra-id'),
      resolvedValue,
      originalAction: action,
      revision: options.currentRevision
    };
  }

  // ── Element Resolution ─────────────────────────────────────────────

  /**
   * Find the target DOM element from an action definition.
   * Tries: element_id → target_selector → selector → text fallback
   */
  function resolveElement(action) {
    // 1. Sentra element ID
    if (action.element_id) {
      const el = document.querySelector(`[data-sentra-id="${action.element_id}"]`);
      if (el) return el;
    }

    // 2. CSS selector
    const selector = action.target_selector || action.selector || action.css_selector;
    if (selector && typeof selector === 'string') {
      try {
        // Handle comma-separated selector fallbacks
        const selectors = selector.split(',').map(s => s.trim());
        for (const sel of selectors) {
          const el = document.querySelector(sel);
          if (el && isVisible(el)) return el;
        }
      } catch (e) { /* invalid selector */ }
    }

    // 3. Text fallback (fuzzy match)
    if (action.text_fallback || action.text) {
      const searchText = (action.text_fallback || action.text).toLowerCase();
      const candidates = document.querySelectorAll('button, a, input, textarea, select, [role="button"], label');
      for (const el of candidates) {
        const elText = (el.textContent || el.value || el.getAttribute('placeholder') || '').toLowerCase().trim();
        if (elText === searchText || elText.includes(searchText)) {
          if (isVisible(el)) return el;
        }
      }
    }

    return null;
  }

  // ── Token Resolution ───────────────────────────────────────────────

  /**
   * Resolve a token value using the local vault.
   */
  function resolveToken(token) {
    // Use SentraTokenVault if available
    if (window.SentraTokenVault) {
      return window.SentraTokenVault.resolve(token);
    }

    // Fallback: try legacy SentraPrivacyVault
    if (window.SentraPrivacyVault) {
      return window.SentraPrivacyVault.resolveValue(token);
    }

    return null;
  }

  // ── Helpers ────────────────────────────────────────────────────────

  function isVisible(el) {
    if (!el) return false;
    const rect = el.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return false;
    try {
      const style = window.getComputedStyle(el);
      return style.visibility !== 'hidden' && style.display !== 'none' && style.opacity !== '0';
    } catch {
      return true;
    }
  }

  function isInteractable(el) {
    if (!el) return false;
    if (el.disabled) return false;
    if (el.getAttribute('aria-disabled') === 'true') return false;
    return true;
  }

  function approve(action) {
    return {
      valid: true,
      action: action.action,
      element: null,
      elementId: null,
      resolvedValue: action.value || null,
      originalAction: action,
      revision: null
    };
  }

  function reject(code, reason, revision) {
    console.warn(`[ActionGuard] REJECTED (${code}): ${reason}`);
    return {
      valid: false,
      code,
      reason,
      revision: revision || null
    };
  }

  // ── Batch Validation ───────────────────────────────────────────────

  /**
   * Validate a list of actions (returns on first failure).
   */
  function validateBatch(actions, options = {}) {
    const results = [];
    for (const action of actions) {
      const result = validate(action, options);
      results.push(result);
      if (!result.valid) break; // Stop on first invalid action
    }
    return results;
  }

  return {
    validate,
    validateBatch,
    resolveElement,
    resolveToken
  };
})();
