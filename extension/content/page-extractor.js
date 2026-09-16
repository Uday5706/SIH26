/**
 * Page Extractor — Structured elements[] extraction from DOM + Accessibility Tree
 * 
 * Extracts a structured representation of all interactive/visible elements on the page.
 * Each element gets a stable ID (e.g., e1, e2), role, tag, type, label, bbox, value,
 * sensitivity classification, and accessibility attributes.
 * 
 * Integrates with SentraDOMObserver for revision-aware state and
 * SentraPrivacyVault/PIIDomScanner for sensitivity classification.
 * 
 * Part of the PRIVAGENT LocalPerceptionEngine perception cascade.
 */

window.SentraPageExtractor = (function () {
  'use strict';

  // ── Element ID Management ──────────────────────────────────────────
  let _nextId = 1;
  const _elementIdMap = new WeakMap(); // DOM element → stable ID

  /**
   * Get or assign a stable element ID. Uses WeakMap for GC-safe tracking
   * and sets data-sentra-id on the element for CSS selector targeting.
   */
  function getStableId(el) {
    let id = _elementIdMap.get(el);
    if (!id) {
      // Check if element already has a sentra ID from a previous scan
      const existing = el.getAttribute('data-sentra-id');
      if (existing) {
        id = existing;
      } else {
        id = `e${_nextId++}`;
        el.setAttribute('data-sentra-id', id);
      }
      _elementIdMap.set(el, id);
    }
    return id;
  }

  // ── Selectors ──────────────────────────────────────────────────────
  const INTERACTIVE_SELECTOR = [
    'input', 'textarea', 'select',
    '[contenteditable="true"]',
    'button', 'a[href]',
    '[role="button"]', '[role="textbox"]',
    '[role="combobox"]', '[role="checkbox"]',
    '[role="radio"]', '[role="slider"]',
    '[role="menuitem"]', '[role="link"]',
    '[role="tab"]', '[role="dialog"]',
    '[role="switch"]', '[role="spinbutton"]',
    '[role="searchbox"]', '[role="option"]'
  ].join(', ');

  // ── Visibility ─────────────────────────────────────────────────────

  function isVisible(el) {
    if (!el) return false;
    const rect = el.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return false;
    try {
      const style = window.getComputedStyle(el);
      return (
        style.visibility !== 'hidden' &&
        style.display !== 'none' &&
        style.opacity !== '0'
      );
    } catch {
      return true;
    }
  }

  function isInteractable(el) {
    if (!el) return false;
    if (el.disabled) return false;
    if (el.getAttribute('aria-disabled') === 'true') return false;
    if (el.getAttribute('aria-hidden') === 'true') return false;
    return isVisible(el);
  }

  // ── Label Extraction ───────────────────────────────────────────────
  // Comprehensive label finder using multiple strategies

  function extractLabel(el) {
    if (!el) return '';

    // 1. Explicit <label for="...">
    if (el.id) {
      try {
        const label = document.querySelector(`label[for="${CSS.escape(el.id)}"]`);
        if (label && label.textContent.trim()) {
          return cleanLabel(label.textContent);
        }
      } catch (e) { /* ignore */ }
    }

    // 2. Wrapping <label>
    const parentLabel = el.closest('label');
    if (parentLabel) {
      const clone = parentLabel.cloneNode(true);
      clone.querySelectorAll('input, select, textarea, button').forEach(c => c.remove());
      const txt = clone.textContent.trim();
      if (txt) return cleanLabel(txt);
    }

    // 3. ARIA attributes
    const ariaLabel = el.getAttribute('aria-label');
    if (ariaLabel && ariaLabel.trim()) return ariaLabel.trim();

    const ariaLabelledBy = el.getAttribute('aria-labelledby');
    if (ariaLabelledBy) {
      try {
        const ids = ariaLabelledBy.split(/\s+/);
        const parts = ids.map(id => {
          const target = document.getElementById(id);
          return target ? target.textContent.trim() : '';
        }).filter(Boolean);
        if (parts.length > 0) return cleanLabel(parts.join(' '));
      } catch (e) { /* ignore */ }
    }

    // 4. Placeholder
    const placeholder = el.getAttribute('placeholder');
    if (placeholder && placeholder.trim()) return placeholder.trim();

    // 5. Preceding sibling or nearby heading/label text
    let prev = el.previousElementSibling;
    while (prev) {
      if (/^(label|h1|h2|h3|h4|h5|h6|p|span|div)$/i.test(prev.tagName)) {
        const txt = prev.textContent.trim();
        if (txt && txt.length < 60) return cleanLabel(txt);
      }
      prev = prev.previousElementSibling;
    }

    // 6. Following sibling label (checkbox/radio patterns)
    const next = el.nextElementSibling;
    if (next && /^label$/i.test(next.tagName)) {
      const txt = next.textContent.trim();
      if (txt && txt.length < 60) return cleanLabel(txt);
    }

    // 7. Parent form group label
    const parentContainer = el.closest('.form-group, .form-field, .input-group, .field, [class*="field"], [class*="input"]');
    if (parentContainer) {
      const containerLabel = parentContainer.querySelector('label, [class*="label"], [class*="title"]');
      if (containerLabel && containerLabel !== el) {
        const txt = containerLabel.textContent.trim();
        if (txt && txt.length < 60) return cleanLabel(txt);
      }
    }

    // 8. Title attribute
    const title = el.getAttribute('title');
    if (title && title.trim()) return title.trim();

    // 9. Button/link text content
    if (el.tagName === 'BUTTON' || el.tagName === 'A' || el.getAttribute('role') === 'button') {
      const txt = el.textContent.trim();
      if (txt && txt.length < 60) return cleanLabel(txt);
    }

    // 10. Fallback: name, id, or role
    return el.getAttribute('name') || el.id || el.getAttribute('role') || el.tagName.toLowerCase();
  }

  function cleanLabel(txt) {
    return txt.replace(/\s+/g, ' ').replace(/[*:]/g, '').trim();
  }

  // ── Role Resolution ────────────────────────────────────────────────

  function resolveRole(el) {
    // Explicit ARIA role takes priority
    const ariaRole = el.getAttribute('role');
    if (ariaRole) return ariaRole;

    // Implicit role from tag + type
    const tag = el.tagName.toLowerCase();
    if (tag === 'input') {
      const type = (el.getAttribute('type') || 'text').toLowerCase();
      const roleMap = {
        'text': 'textbox', 'email': 'textbox', 'tel': 'textbox',
        'url': 'textbox', 'search': 'searchbox', 'number': 'spinbutton',
        'password': 'textbox', 'checkbox': 'checkbox', 'radio': 'radio',
        'range': 'slider', 'submit': 'button', 'button': 'button',
        'reset': 'button', 'file': 'button', 'image': 'button',
        'date': 'textbox', 'time': 'textbox', 'datetime-local': 'textbox',
        'color': 'button', 'hidden': 'none'
      };
      return roleMap[type] || 'textbox';
    }
    if (tag === 'textarea') return 'textbox';
    if (tag === 'select') return 'combobox';
    if (tag === 'button') return 'button';
    if (tag === 'a') return 'link';

    return tag;
  }

  // ── Value Extraction ───────────────────────────────────────────────

  function getElementValue(el) {
    const tag = el.tagName;
    if (tag === 'INPUT') {
      const type = (el.type || 'text').toLowerCase();
      if (type === 'checkbox' || type === 'radio') {
        return el.checked ? 'checked' : 'unchecked';
      }
      if (type === 'file') {
        return el.files && el.files.length > 0 ? `${el.files.length} file(s)` : '';
      }
      return el.value || '';
    }
    if (tag === 'TEXTAREA') return el.value || '';
    if (tag === 'SELECT') {
      const selected = el.options[el.selectedIndex];
      return selected ? selected.textContent.trim() : el.value || '';
    }
    if (el.isContentEditable) return el.textContent || '';
    if (tag === 'BUTTON' || tag === 'A') return el.textContent.trim() || '';
    return el.value || el.textContent.trim() || '';
  }

  // ── CSS Selector Generation ────────────────────────────────────────

  function generateSelector(el) {
    // 1. Unique ID
    if (el.id && typeof el.id === 'string') {
      try {
        const idSel = `#${CSS.escape(el.id)}`;
        if (document.querySelectorAll(idSel).length === 1) return idSel;
      } catch (e) { /* ignore */ }
    }

    // 2. Unique name attribute
    const name = el.getAttribute('name');
    if (name) {
      try {
        const nameSel = `${el.tagName.toLowerCase()}[name="${CSS.escape(name)}"]`;
        if (document.querySelectorAll(nameSel).length === 1) return nameSel;
      } catch (e) { /* ignore */ }
    }

    // 3. data-testid
    const testId = el.getAttribute('data-testid') || el.getAttribute('data-id');
    if (testId) return `[data-testid="${CSS.escape(testId)}"]`;

    // 4. Sentra ID (always unique)
    const sentraId = el.getAttribute('data-sentra-id');
    if (sentraId) return `[data-sentra-id="${sentraId}"]`;

    // 5. Tag + type + nth-of-type fallback
    const tag = el.tagName.toLowerCase();
    const type = el.getAttribute('type');
    if (type) {
      const typeSel = `${tag}[type="${type}"]`;
      const all = document.querySelectorAll(typeSel);
      const idx = Array.from(all).indexOf(el);
      if (idx >= 0) return `${typeSel}:nth-of-type(${idx + 1})`;
    }

    return `[data-sentra-id="${el.getAttribute('data-sentra-id') || 'unknown'}"]`;
  }

  // ── Sensitivity Classification ─────────────────────────────────────
  // Deterministic rule-based classification using DOM/A11y signals only

  const HIGH_KEYWORDS = /password|pass|secret|cvv|cvc|\bpin\b|pincode|otp|apikey|api_key|token|auth_token|private_key|card|credit|cardnumber/i;
  const MODERATE_KEYWORDS = /email|tel|phone|mobile|ssn|aadhaar|social|tax|account|name|fullname|firstname|lastname|address|zip|postal|city|state|country|location|dob|birth/i;

  /**
   * Helper to deterministically check if a string is a valid date (e.g. May 12th, 2006, 12/05/2006)
   */
  function isLikelyDate(str) {
    if (!str || str.length < 5 || str.length > 30) return false;
    const datePattern = /\b(?:\d{1,2}[-\/.]\d{1,2}[-\/.]\d{2,4}|(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\s+\d{1,2}(?:st|nd|rd|th)?(?:,\s*|\s+)\d{4}|\d{4}[-\/.]\d{1,2}[-\/.]\d{1,2}|\d{1,2}\s+(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\s+\d{4})\b/i;
    return datePattern.test(str);
  }

  /**
   * High-confidence deterministic sensitivity detection.
   * No ML needed — uses type, autocomplete, name, id, label, placeholder, and value.
   */
  function classifySensitivity(el, value) {
    const tag = el.tagName;
    const type = (el.getAttribute('type') || 'text').toLowerCase();
    
    // We want to skip keyword checks for generic buttons/links unless they contain a Date of Birth
    let isGenericButtonOrLink = false;
    if (tag === 'BUTTON' || tag === 'A' || type === 'submit' || type === 'button' || type === 'reset') {
      isGenericButtonOrLink = true;
    }

    const autocomplete = (el.getAttribute('autocomplete') || '').toLowerCase();
    const name = el.getAttribute('name') || '';
    const id = el.id || '';
    const placeholder = el.getAttribute('placeholder') || '';
    const label = extractLabel(el);
    const combined = `${type} ${autocomplete} ${name} ${id} ${placeholder} ${label}`.toLowerCase();

    // ── DOB specific context + value check ──
    if (/dob|birth|bday/i.test(combined) && isLikelyDate(value)) {
      return { sensitive: true, sensitivity: 'MODERATE', category: 'DOB', confidence: 0.99 };
    }

    if (isGenericButtonOrLink) {
      return { sensitive: false, sensitivity: 'NONE', category: 'GENERAL', confidence: 1.0 };
    }

    // ── Autocomplete-based detection (highest confidence) ──
    const highAutoComplete = {
      'cc-number': 'CREDIT_CARD', 'cc-csc': 'CVV', 'cc-exp': 'CREDIT_CARD',
      'cc-name': 'NAME', 'cc-type': 'CREDIT_CARD',
      'current-password': 'PASSWORD', 'new-password': 'PASSWORD'
    };
    if (highAutoComplete[autocomplete]) {
      return { sensitive: true, sensitivity: 'HIGH', category: highAutoComplete[autocomplete], confidence: 0.99 };
    }

    const modAutoComplete = {
      'email': 'EMAIL', 'tel': 'PHONE', 'tel-national': 'PHONE',
      'name': 'NAME', 'given-name': 'NAME', 'family-name': 'NAME',
      'address-line1': 'ADDRESS', 'address-line2': 'ADDRESS',
      'postal-code': 'ZIP', 'country': 'LOCATION',
      'bday': 'DOB', 'bday-day': 'DOB', 'bday-month': 'DOB', 'bday-year': 'DOB'
    };
    if (modAutoComplete[autocomplete]) {
      return { sensitive: true, sensitivity: 'MODERATE', category: modAutoComplete[autocomplete], confidence: 0.97 };
    }

    // ── Type-based detection ──
    if (type === 'password') {
      return { sensitive: true, sensitivity: 'HIGH', category: 'PASSWORD', confidence: 0.99 };
    }
    if (type === 'email') {
      return { sensitive: true, sensitivity: 'MODERATE', category: 'EMAIL', confidence: 0.98 };
    }
    if (type === 'tel') {
      return { sensitive: true, sensitivity: 'MODERATE', category: 'PHONE', confidence: 0.98 };
    }

    // ── Keyword-based detection ──
    if (HIGH_KEYWORDS.test(combined)) {
      let category = 'PASSWORD';
      if (/otp|verification\s*code/i.test(combined)) category = 'OTP';
      else if (/\bpin\b|pincode/i.test(combined)) category = 'PIN';
      else if (/api_?key/i.test(combined)) category = 'API_KEY';
      else if (/token/i.test(combined)) category = 'TOKEN';
      else if (/private_?key/i.test(combined)) category = 'PRIVATE_KEY';
      else if (/cvv|cvc/i.test(combined)) category = 'CVV';
      else if (/card|credit/i.test(combined)) category = 'CREDIT_CARD';
      return { sensitive: true, sensitivity: 'HIGH', category, confidence: 0.92 };
    }

    if (MODERATE_KEYWORDS.test(combined)) {
      let category = 'PII_TEXT';
      if (/email/i.test(combined)) category = 'EMAIL';
      else if (/phone|mobile|tel/i.test(combined)) category = 'PHONE';
      else if (/aadhaar|ssn|social|tax|pan/i.test(combined)) category = 'GOVT_ID';
      else if (/name|fullname|firstname|lastname/i.test(combined)) category = 'NAME';
      else if (/address|zip|postal|city/i.test(combined)) category = 'ADDRESS';
      else if (/location|country|state/i.test(combined)) category = 'LOCATION';
      else if (/dob|birth/i.test(combined)) category = 'DOB';
      return { sensitive: true, sensitivity: 'MODERATE', category, confidence: 0.88 };
    }

    return { sensitive: false, sensitivity: 'NONE', category: 'GENERAL', confidence: 1.0 };
  }

  // ── Main Extraction ────────────────────────────────────────────────

  /**
   * Extract full structured elements[] representation of the page.
   * @param {Object} options
   * @param {number} options.revision - Current DOM observer revision
   * @param {Set} options.onlyIds - If provided, only extract these element IDs (for deltas)
   * @returns {{ elements: Array, meta: Object }}
   */
  function extract(options = {}) {
    const revision = options.revision || 0;
    const onlyIds = options.onlyIds || null;

    const rawElements = Array.from(document.querySelectorAll(INTERACTIVE_SELECTOR));
    const visibleElements = rawElements.filter(isVisible);

    const elements = [];
    const dpr = window.devicePixelRatio || 1;

    visibleElements.forEach((el, index) => {
      const elId = getStableId(el, index);

      // If delta mode, skip elements not in the requested set
      if (onlyIds && !onlyIds.has(elId)) return;

      const rect = el.getBoundingClientRect();
      const role = resolveRole(el);
      const type = (el.getAttribute('type') || (el.tagName === 'TEXTAREA' ? 'textarea' : (el.tagName === 'SELECT' ? 'select' : 'text'))).toLowerCase();
      const label = extractLabel(el);
      const value = getElementValue(el);
      const classification = classifySensitivity(el, value);
      const selector = generateSelector(el);

      elements.push({
        id: elId,
        role: role,
        tag: el.tagName.toLowerCase(),
        type: type,
        label: label,
        bbox: [
          Math.round(rect.left * dpr),
          Math.round(rect.top * dpr),
          Math.round(rect.width * dpr),
          Math.round(rect.height * dpr)
        ],
        value: value,
        has_value: value.length > 0,
        sensitive: classification.sensitive,
        sensitivity: classification.sensitivity,
        category: classification.category,
        confidence: classification.confidence,
        selector: selector,
        interactable: isInteractable(el),
        attributes: {
          autocomplete: el.getAttribute('autocomplete') || null,
          placeholder: el.getAttribute('placeholder') || null,
          name: el.getAttribute('name') || null,
          disabled: el.disabled || false,
          required: el.required || false,
          'aria-label': el.getAttribute('aria-label') || null,
          'aria-required': el.getAttribute('aria-required') || null
        }
      });
    });

    return {
      elements,
      meta: {
        revision,
        url: window.location.href,
        title: document.title || window.location.hostname,
        totalElements: elements.length,
        sensitiveElements: elements.filter(e => e.sensitive).length,
        viewport: {
          width: window.innerWidth,
          height: window.innerHeight,
          devicePixelRatio: dpr,
          scrollX: window.scrollX,
          scrollY: window.scrollY
        },
        timestamp: Date.now()
      }
    };
  }

  /**
   * Extract only the elements specified by IDs (for delta updates).
   */
  function extractByIds(elementIds, revision) {
    return extract({ revision, onlyIds: new Set(elementIds) });
  }

  /**
   * Quick summary of the page state without full extraction.
   */
  function summary() {
    const allElements = document.querySelectorAll(INTERACTIVE_SELECTOR);
    const visibleCount = Array.from(allElements).filter(isVisible).length;
    return {
      url: window.location.href,
      title: document.title,
      totalInteractive: allElements.length,
      visibleInteractive: visibleCount,
      timestamp: Date.now()
    };
  }

  return {
    extract,
    extractByIds,
    summary,
    getStableId,
    isVisible,
    isInteractable,
    classifySensitivity,
    extractLabel
  };
})();
