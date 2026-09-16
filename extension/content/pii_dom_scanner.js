/**
 * Universal DOM-Based JSON Generator & Privacy-Preserving Tokenization Vault
 * 
 * Capabilities:
 * 1. Scans interactive and form elements on ANY webpage (inputs, textareas, selects, buttons, contenteditables).
 * 2. Intelligent context extraction (associated labels, aria attributes, placeholders, preceding text).
 * 3. Classifies field sensitivity (HIGH vs MODERATE vs NONE).
 * 4. Generates realistic, category-tailored synthetic/dummy data for sensitive fields.
 * 5. Maintains window.SentraPrivacyVault: Tracks what was changed with what (original <--> dummy)
 *    to preserve complete local context for subsequent local form-filling operations.
 */

// SentraPrivacyVault has been migrated to extension/privacy/token-vault.js (as SentraTokenVault).
// PIIDomScanner now uses SentraTokenVault for semantic tokenization.

window.PIIDomScanner = (function () {
  const HIGH_SENSITIVITY_KEYWORDS = /password|pass|secret|cvv|cvc|\bpin\b|pincode|otp|apikey|api_key|token|auth_token|private_key|card|credit|cardnumber/i;
  const MODERATE_SENSITIVITY_KEYWORDS = /email|tel|phone|mobile|ssn|aadhaar|social|tax|account|name|fullname|firstname|lastname|address|zip|postal|city|state|country|location/i;

  // Semantic Token Generator
  // Produces semantic tokens (e.g. [EMAIL_01]) instead of fake data strings
  const DUMMY_REGISTRY = {
    EMAIL: (index) => `[EMAIL_${String(index).padStart(2, '0')}]`,
    PHONE: (index) => `[PHONE_${String(index).padStart(2, '0')}]`,
    NAME: (index) => `[NAME_${String(index).padStart(2, '0')}]`,
    PASSWORD: (index) => `[PASSWORD_${String(index).padStart(2, '0')}]`,
    PIN: (index) => `[PIN_${String(index).padStart(2, '0')}]`,
    OTP: (index) => `[OTP_${String(index).padStart(2, '0')}]`,
    CREDIT_CARD: (index) => `[CREDIT_CARD_${String(index).padStart(2, '0')}]`,
    CVV: (index) => `[CVV_${String(index).padStart(2, '0')}]`,
    ADDRESS: (index) => `[ADDRESS_${String(index).padStart(2, '0')}]`,
    CITY: (index) => `[CITY_${String(index).padStart(2, '0')}]`,
    ZIP: (index) => `[ZIP_${String(index).padStart(2, '0')}]`,
    GOVT_ID: (index) => `[GOVT_ID_${String(index).padStart(2, '0')}]`,
    API_KEY: (index) => `[API_KEY_${String(index).padStart(2, '0')}]`,
    TOKEN: (index) => `[TOKEN_${String(index).padStart(2, '0')}]`,
    PRIVATE_KEY: (index) => `[PRIVATE_KEY_${String(index).padStart(2, '0')}]`,
    LOCATION: (index) => `[LOCATION_${String(index).padStart(2, '0')}]`,
    GENERAL: (index) => `[GENERAL_${String(index).padStart(2, '0')}]`
  };

  let syntheticCounters = {};

  function resetCounters() {
    syntheticCounters = {};
  }

  function getSyntheticDummy(category, rawValue, context = {}) {
    if (window.SentraTokenVault && window.SentraTokenVault.tokenize) {
      return window.SentraTokenVault.tokenize(category, rawValue, context);
    }
    const cat = category || 'GENERAL';
    syntheticCounters[cat] = (syntheticCounters[cat] || 0) + 1;
    const generator = DUMMY_REGISTRY[cat] || DUMMY_REGISTRY.GENERAL;
    return generator(syntheticCounters[cat]);
  }

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

  // Universal Label Finder: Handles <label for>, wrapping <label>, ARIA labels, placeholders, and adjacent text
  function extractLabel(el) {
    if (!el) return '';

    // 1. Explicit label for attribute
    if (el.id) {
      try {
        const label = document.querySelector(`label[for="${CSS.escape(el.id)}"]`);
        if (label && label.textContent.trim()) {
          return cleanLabelText(label.textContent);
        }
      } catch (e) {}
    }

    // 2. Wrapping <label>
    const parentLabel = el.closest('label');
    if (parentLabel) {
      const clone = parentLabel.cloneNode(true);
      clone.querySelectorAll('input, select, textarea, button').forEach(c => c.remove());
      const txt = clone.textContent.trim();
      if (txt) return cleanLabelText(txt);
    }

    // 3. ARIA attributes
    const ariaLabel = el.getAttribute('aria-label');
    if (ariaLabel && ariaLabel.trim()) return ariaLabel.trim();

    const ariaLabelledBy = el.getAttribute('aria-labelledby');
    if (ariaLabelledBy) {
      try {
        const targetEl = document.getElementById(ariaLabelledBy);
        if (targetEl && targetEl.textContent.trim()) {
          return cleanLabelText(targetEl.textContent);
        }
      } catch (e) {}
    }

    // 4. Placeholder attribute
    const placeholder = el.getAttribute('placeholder');
    if (placeholder && placeholder.trim()) return placeholder.trim();

    // 5. Preceding sibling or nearby heading/label text
    let prev = el.previousElementSibling;
    while (prev) {
      if (/^(label|h1|h2|h3|h4|h5|h6|p|span|div)$/i.test(prev.tagName)) {
        const txt = prev.textContent.trim();
        if (txt && txt.length < 50) return cleanLabelText(txt);
      }
      prev = prev.previousElementSibling;
    }

    // 6. Following sibling label (e.g. floating labels or checkboxes: <input><label>...)
    let next = el.nextElementSibling;
    if (next && /^label$/i.test(next.tagName)) {
      const txt = next.textContent.trim();
      if (txt && txt.length < 50) return cleanLabelText(txt);
    }

    // 7. Parent form group or container label text
    const parentContainer = el.closest('.form-group, .form-field, .input-group, .field, [class*="field"], [class*="input"]');
    if (parentContainer) {
      const containerLabel = parentContainer.querySelector('label, [class*="label"], [class*="title"]');
      if (containerLabel && containerLabel !== el) {
        const txt = containerLabel.textContent.trim();
        if (txt && txt.length < 50) return cleanLabelText(txt);
      }
    }

    // 8. Name or title fallback
    const title = el.getAttribute('title');
    if (title && title.trim()) return title.trim();

    const elIdStr = typeof el.id === 'string' ? el.id : '';
    return el.getAttribute('name') || elIdStr || el.getAttribute('role') || el.tagName.toLowerCase();
  }

  function cleanLabelText(txt) {
    return txt.replace(/\s+/g, ' ').replace(/[*:]/g, '').trim();
  }

  // Generate robust, unique CSS selector for any element
  function generateSelector(el, index) {
    if (el.id && typeof el.id === 'string') {
      try {
        const idSelector = `#${CSS.escape(el.id)}`;
        if (document.querySelectorAll(idSelector).length === 1) {
          return idSelector;
        }
      } catch (e) {}
    }

    const name = el.getAttribute('name');
    if (name) {
      try {
        const nameSelector = `${el.tagName.toLowerCase()}[name="${CSS.escape(name)}"]`;
        if (document.querySelectorAll(nameSelector).length === 1) {
          return nameSelector;
        }
      } catch (e) {}
    }

    const testId = el.getAttribute('data-testid') || el.getAttribute('data-id');
    if (testId) {
      return `[data-testid="${CSS.escape(testId)}"]`;
    }

    // Ensure deterministic identification by injecting Sentra ID attribute if missing
    let sentraId = el.getAttribute('data-sentra-id');
    if (!sentraId) {
      sentraId = `sentra-el-${index + 1}`;
      el.setAttribute('data-sentra-id', sentraId);
    }
    return `[data-sentra-id="${sentraId}"]`;
  }

  function classifyField(el) {
    const type = (el.getAttribute('type') || 'text').toLowerCase();
    
    // Buttons should not be classified as sensitive text inputs and replaced with dummy data
    if (el.tagName === 'BUTTON' || type === 'submit' || type === 'button') {
      return {
        isSensitive: false,
        sensitivity: 'NONE',
        category: 'GENERAL'
      };
    }

    const autocomplete = (el.getAttribute('autocomplete') || '').toLowerCase();
    const name = el.getAttribute('name') || '';
    const id = el.id || '';
    const placeholder = el.getAttribute('placeholder') || '';
    const labelText = extractLabel(el);
    const combinedAttr = `${type} ${autocomplete} ${name} ${id} ${placeholder} ${labelText}`.toLowerCase();

    // 1. High Sensitivity checks
    if (type === 'password' || HIGH_SENSITIVITY_KEYWORDS.test(combinedAttr)) {
      let category = 'PASSWORD';
      if (/otp|verification\s*code/i.test(combinedAttr)) category = 'OTP';
      else if (/\bpin\b|pincode|pin_code/i.test(combinedAttr)) category = 'PIN';
      else if (/api_?key/i.test(combinedAttr)) category = 'API_KEY';
      else if (/token/i.test(combinedAttr)) category = 'TOKEN';
      else if (/private_?key/i.test(combinedAttr)) category = 'PRIVATE_KEY';
      else if (/cvv|cvc/i.test(combinedAttr)) category = 'CVV';
      else if (/card|credit/i.test(combinedAttr)) category = 'CREDIT_CARD';

      return {
        isSensitive: true,
        sensitivity: 'HIGH',
        category: category
      };
    }

    // 2. Moderate Sensitivity checks
    if (MODERATE_SENSITIVITY_KEYWORDS.test(combinedAttr) || type === 'email' || type === 'tel') {
      let category = 'PII_TEXT';
      if (type === 'email' || /email/i.test(combinedAttr)) category = 'EMAIL';
      else if (type === 'tel' || /phone|mobile|tel/i.test(combinedAttr)) category = 'PHONE';
      else if (/aadhaar|ssn|social|tax/i.test(combinedAttr)) category = 'GOVT_ID';
      else if (/name/i.test(combinedAttr)) category = 'NAME';
      else if (/address|zip|postal|city/i.test(combinedAttr)) category = 'ADDRESS';
      else if (/location/i.test(combinedAttr)) category = 'LOCATION';

      return {
        isSensitive: true,
        sensitivity: 'MODERATE',
        category: category
      };
    }

    return {
      isSensitive: false,
      sensitivity: 'NONE',
      category: 'GENERAL'
    };
  }

  function getElementValue(el) {
    if (el.tagName === 'INPUT') {
      const type = (el.type || 'text').toLowerCase();
      if (type === 'checkbox' || type === 'radio') {
        return el.checked ? 'true' : 'false';
      }
      return el.value || '';
    }
    if (el.tagName === 'TEXTAREA' || el.tagName === 'SELECT') {
      return el.value || '';
    }
    if (el.isContentEditable) {
      return el.textContent || '';
    }
    return el.value || el.textContent.trim() || '';
  }

  // Primary Universal Scan Function
  function scanDOM() {
    resetCounters();
    window.SentraPrivacyVault.reset();

    const boundingBoxes = [];
    const sanitizedDom = [];

    // Query interactive and form controls across any page
    const query = [
      'input',
      'textarea',
      'select',
      '[contenteditable="true"]',
      'button',
      'a[href]',
      '[role="button"]',
      '[role="textbox"]',
      '[role="combobox"]',
      '[role="checkbox"]'
    ].join(', ');

    const rawElements = Array.from(document.querySelectorAll(query));
    // Filter visible elements
    const elements = rawElements.filter(el => isVisible(el));

    elements.forEach((el, index) => {
      const rect = el.getBoundingClientRect();
      const role = el.getAttribute('role') || el.tagName.toLowerCase();
      const inputType = (el.getAttribute('type') || (el.tagName === 'TEXTAREA' ? 'textarea' : (el.tagName === 'SELECT' ? 'select' : 'text'))).toLowerCase();
      const label = extractLabel(el);
      const classification = classifyField(el);
      const selector = generateSelector(el, index);
      const fieldId = el.getAttribute('data-sentra-id') || `sentra-el-${index + 1}`;

      // Fix alignment for screenshot redaction:
      // 1. Multiply by devicePixelRatio because captureVisibleTab captures in physical pixels.
      // 2. Use rect.left/top directly (without scrollX/Y) because captureVisibleTab only captures the visible viewport!
      const dpr = window.devicePixelRatio || 1;
      const elementBbox = [
        Math.round(rect.left * dpr),
        Math.round(rect.top * dpr),
        Math.round(rect.width * dpr),
        Math.round(rect.height * dpr)
      ];

      const rawValue = getElementValue(el);
      const hasValue = rawValue.length > 0;

      let sanitizedValue = rawValue;
      let dummyValue = null;

      if (classification.isSensitive) {
        // Generate realistic dummy value / token
        dummyValue = getSyntheticDummy(classification.category, rawValue, {
          fieldId: fieldId,
          elementId: fieldId,
          selector: selector,
          sensitivity: classification.sensitivity
        });
        sanitizedValue = dummyValue;

        // Tight visual bounding box for canvas redaction
        boundingBoxes.push({
          x: elementBbox[0],
          y: elementBbox[1],
          width: elementBbox[2],
          height: elementBbox[3],
          type: 'DOM_PII',
          sensitivity: classification.sensitivity,
          category: classification.category,
          placeholder: `[PII_${classification.category}]`,
          dummyValue: dummyValue,
          reason: `${el.tagName.toLowerCase()}[${classification.category}]`
        });
      }

      // Record in SentraTokenVault is already handled by getSyntheticDummy if SentraTokenVault exists
      // But we will add legacy vault logic fallback just in case
      if (window.SentraPrivacyVault && window.SentraPrivacyVault.recordField) {
        window.SentraPrivacyVault.recordField({
          fieldId: fieldId,
          selector: selector,
          tagName: el.tagName.toLowerCase(),
          type: inputType,
          label: label,
          category: classification.category,
          sensitivity: classification.sensitivity,
          originalValue: rawValue,
          dummyValue: dummyValue,
          isSanitized: classification.isSensitive
        });
      }

      // Build clean structured DOM node for VLM/server reasoning
      sanitizedDom.push({
        id: fieldId,
        role: role,
        tag: el.tagName.toLowerCase(),
        type: inputType,
        selector: selector,
        label: label,
        has_value: hasValue,
        value: sanitizedValue,
        is_sanitized: classification.isSensitive,
        sensitivity: classification.sensitivity,
        semantic_type: classification.category,
        bbox: elementBbox
      });
    });

    const vaultSnapshot = window.SentraPrivacyVault.getSnapshot();

    let domSnapshot = '';
    try {
      const clone = document.documentElement.cloneNode(true);
      vaultSnapshot.transformations.filter(t => t.isSanitized).forEach(t => {
        try {
          const els = clone.querySelectorAll(t.selector);
          els.forEach(el => {
            if (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT') {
              el.setAttribute('value', t.dummyValue);
              el.value = t.dummyValue;
              el.textContent = t.dummyValue; 
            } else {
              el.textContent = t.dummyValue;
            }
          });
        } catch (e) {}
      });
      domSnapshot = clone.outerHTML;
    } catch (e) {
      domSnapshot = '<html lang="en"><body>Error generating snapshot</body></html>';
    }

    return {
      boundingBoxes: boundingBoxes,
      sanitizedDom: sanitizedDom,
      domSnapshot: domSnapshot,
      viewportSize: {
        width: window.innerWidth,
        height: window.innerHeight,
        devicePixelRatio: window.devicePixelRatio || 1,
        scrollX: window.scrollX,
        scrollY: window.scrollY
      },
      sanitizationContext: {
        totalFieldsScanned: sanitizedDom.length,
        sanitizedFieldsCount: window.SentraTokenVault ? Object.keys(window.SentraTokenVault.getCategoryCounts()).length : 0,
        transformations: []
      },
      vault: window.SentraTokenVault ? window.SentraTokenVault.getDebugSnapshot() : {}
    };
  }

  return {
    scan: scanDOM
  };
})();

