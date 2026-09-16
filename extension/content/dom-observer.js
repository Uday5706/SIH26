/**
 * DOM Observer — Event-driven mutation tracking with revision deltas
 * 
 * Watches for DOM changes via MutationObserver, page navigations (popstate/hashchange),
 * focus/blur, and modal opens. Maintains a revision counter and computes structured
 * deltas (added/removed/updated elements) so only changes are communicated.
 * 
 * Part of the PRIVAGENT LocalPerceptionEngine perception cascade.
 */

window.SentraDOMObserver = (function () {
  'use strict';

  // ── State ──────────────────────────────────────────────────────────
  let _revision = 0;
  let _observer = null;
  let _isActive = false;
  let _debounceTimer = null;
  let _listeners = [];  // callbacks: (delta) => void

  // Track the element snapshot at each revision for diffing
  let _previousElementIds = new Set();
  let _previousElementHashes = new Map(); // elementId → hash

  // Debounce config (ms)
  const DEBOUNCE_MS = 300;

  // Selectors for interactive/visible elements we track
  const TRACKED_SELECTOR = [
    'input', 'textarea', 'select',
    '[contenteditable="true"]',
    'button', 'a[href]',
    '[role="button"]', '[role="textbox"]',
    '[role="combobox"]', '[role="checkbox"]',
    '[role="radio"]', '[role="slider"]',
    '[role="menuitem"]', '[role="link"]',
    '[role="tab"]', '[role="dialog"]'
  ].join(', ');

  // ── Utilities ──────────────────────────────────────────────────────

  /**
   * Creates a lightweight hash of an element's observable properties
   * so we can detect meaningful changes without deep comparison.
   */
  function hashElement(el) {
    const rect = el.getBoundingClientRect();
    const parts = [
      el.tagName,
      el.getAttribute('type') || '',
      el.getAttribute('name') || '',
      el.id || '',
      el.getAttribute('role') || '',
      el.getAttribute('aria-label') || '',
      el.getAttribute('placeholder') || '',
      el.getAttribute('autocomplete') || '',
      el.disabled ? '1' : '0',
      el.getAttribute('aria-hidden') || '',
      // Value tracking (for inputs that changed)
      (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT')
        ? (el.value || '').substring(0, 50) : '',
      // Position/size (rounded to avoid sub-pixel noise)
      Math.round(rect.left),
      Math.round(rect.top),
      Math.round(rect.width),
      Math.round(rect.height)
    ];
    return parts.join('|');
  }

  /**
   * Get or assign a stable Sentra element ID.
   */
  function getElementId(el, index) {
    let id = el.getAttribute('data-sentra-id');
    if (!id) {
      id = `e${index + 1}`;
      el.setAttribute('data-sentra-id', id);
    }
    return id;
  }

  /**
   * Quick visibility check without getComputedStyle (for performance in observer).
   */
  function isQuickVisible(el) {
    if (!el || !el.getBoundingClientRect) return false;
    const rect = el.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  }

  // ── Delta Computation ─────────────────────────────────────────────

  /**
   * Computes delta between current DOM state and previous snapshot.
   * Returns: { revision, added[], removed[], updated[], unchanged }
   */
  function computeDelta() {
    const currentElements = Array.from(document.querySelectorAll(TRACKED_SELECTOR))
      .filter(isQuickVisible);

    const currentElementIds = new Set();
    const currentElementHashes = new Map();

    const added = [];
    const updated = [];

    currentElements.forEach((el, index) => {
      const elId = getElementId(el, index);
      const hash = hashElement(el);

      currentElementIds.add(elId);
      currentElementHashes.set(elId, hash);

      if (!_previousElementIds.has(elId)) {
        // New element
        added.push(elId);
      } else if (_previousElementHashes.get(elId) !== hash) {
        // Changed element
        updated.push(elId);
      }
    });

    // Removed = was in previous, not in current
    const removed = [];
    for (const prevId of _previousElementIds) {
      if (!currentElementIds.has(prevId)) {
        removed.push(prevId);
      }
    }

    // Update snapshot
    _previousElementIds = currentElementIds;
    _previousElementHashes = currentElementHashes;

    const hasChanges = added.length > 0 || removed.length > 0 || updated.length > 0;

    return {
      revision: _revision,
      hasChanges,
      added,
      removed,
      updated,
      totalTracked: currentElementIds.size,
      timestamp: Date.now()
    };
  }

  // ── Mutation Handler ───────────────────────────────────────────────

  function handleMutation(trigger = 'mutation') {
    // Debounce rapid-fire mutations
    if (_debounceTimer) clearTimeout(_debounceTimer);

    _debounceTimer = setTimeout(() => {
      _revision++;

      const delta = computeDelta();
      delta.trigger = trigger;

      if (delta.hasChanges) {
        console.log(`[SentraDOMObserver] Rev ${_revision} (${trigger}): +${delta.added.length} -${delta.removed.length} ~${delta.updated.length}`);

        // Notify all registered listeners
        _listeners.forEach(cb => {
          try { cb(delta); } catch (e) { console.warn('[SentraDOMObserver] Listener error:', e); }
        });

        // Notify background service worker
        try {
          chrome.runtime.sendMessage({
            action: 'DOM_MUTATION',
            payload: delta
          });
        } catch (e) {
          // Extension context may not be available
        }
      }
    }, DEBOUNCE_MS);
  }

  // ── Page Navigation Handlers ───────────────────────────────────────

  function handleNavigation(event) {
    handleMutation(`navigation:${event.type}`);
  }

  function handleFocusChange(event) {
    // Only trigger on focus changes to tracked elements
    const target = event.target;
    if (target && target.matches && target.matches(TRACKED_SELECTOR)) {
      handleMutation(`focus:${event.type}`);
    }
  }

  function handleInputChange(event) {
    const target = event.target;
    if (target && target.matches && target.matches('input, textarea, select, [contenteditable="true"]')) {
      handleMutation('input');
    }
  }

  // ── Public API ─────────────────────────────────────────────────────

  /**
   * Start observing the DOM. Idempotent — safe to call multiple times.
   */
  function start() {
    if (_isActive) return;
    _isActive = true;

    // Initial snapshot (revision 0)
    _revision = 0;
    computeDelta(); // Populate initial snapshot without notifying

    // MutationObserver for DOM structural changes
    _observer = new MutationObserver((mutations) => {
      // Quick filter: only care about mutations that affect tracked elements
      const relevant = mutations.some(m => {
        if (m.type === 'childList') return true;
        if (m.type === 'attributes') {
          const target = m.target;
          return target.matches && target.matches(TRACKED_SELECTOR);
        }
        return false;
      });

      if (relevant) {
        handleMutation('mutation');
      }
    });

    _observer.observe(document.documentElement, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['value', 'disabled', 'hidden', 'aria-hidden', 'style', 'class', 'type', 'placeholder']
    });

    // Page navigation events
    window.addEventListener('popstate', handleNavigation);
    window.addEventListener('hashchange', handleNavigation);

    // Focus tracking
    document.addEventListener('focusin', handleFocusChange);
    document.addEventListener('focusout', handleFocusChange);

    // Input value changes
    document.addEventListener('input', handleInputChange, true);
    document.addEventListener('change', handleInputChange, true);

    console.log('[SentraDOMObserver] Started. Tracking mutations, navigation, focus, and input changes.');
  }

  /**
   * Stop observing.
   */
  function stop() {
    if (!_isActive) return;
    _isActive = false;

    if (_observer) {
      _observer.disconnect();
      _observer = null;
    }

    window.removeEventListener('popstate', handleNavigation);
    window.removeEventListener('hashchange', handleNavigation);
    document.removeEventListener('focusin', handleFocusChange);
    document.removeEventListener('focusout', handleFocusChange);
    document.removeEventListener('input', handleInputChange, true);
    document.removeEventListener('change', handleInputChange, true);

    if (_debounceTimer) {
      clearTimeout(_debounceTimer);
      _debounceTimer = null;
    }

    console.log('[SentraDOMObserver] Stopped.');
  }

  /**
   * Register a callback to receive delta notifications.
   * @param {function} callback - Called with delta object on each meaningful change.
   * @returns {function} Unsubscribe function.
   */
  function onDelta(callback) {
    _listeners.push(callback);
    return () => {
      _listeners = _listeners.filter(cb => cb !== callback);
    };
  }

  /**
   * Force a full re-scan and return delta (useful after major page changes).
   */
  function forceRefresh() {
    _revision++;
    // Reset previous snapshot to force full delta
    _previousElementIds = new Set();
    _previousElementHashes = new Map();
    const delta = computeDelta();
    delta.trigger = 'force_refresh';
    return delta;
  }

  /**
   * Get current revision number.
   */
  function getRevision() {
    return _revision;
  }

  /**
   * Get current delta without incrementing revision.
   */
  function peekDelta() {
    return computeDelta();
  }

  return {
    start,
    stop,
    onDelta,
    forceRefresh,
    getRevision,
    peekDelta,
    getTrackedSelector: () => TRACKED_SELECTOR,
    isActive: () => _isActive
  };
})();
