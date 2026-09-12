/**
 * Tier 1: Deterministic DOM PII Scanner & Structured Sanitizer
 * Identifies sensitive input fields, attributes, and roles.
 * Classifies sensitivity into HIGH (opaque mask) vs MODERATE/LOW (localized blur).
 * Generates structured sanitized DOM representations for VLM context while leaving real DOM intact.
 */

window.PIIDomScanner = (function () {
  const HIGH_SENSITIVITY_KEYWORDS = /password|pass|secret|cvv|cvc|\bpin\b|pincode|otp|apikey|api_key|token|auth_token|private_key|card|credit|cardnumber/i;
  const MODERATE_SENSITIVITY_KEYWORDS = /email|tel|phone|mobile|ssn|aadhaar|social|tax|account|name|fullname|firstname|lastname|address|zip|postal|city|state|country|location/i;

  function isVisible(el) {
    if (!el) return false;
    const rect = el.getBoundingClientRect();
    const style = window.getComputedStyle(el);
    return (
      rect.width > 0 &&
      rect.height > 0 &&
      style.visibility !== 'hidden' &&
      style.display !== 'none' &&
      style.opacity !== '0'
    );
  }

  function getAssociatedLabelText(el) {
    if (el.id) {
      const label = document.querySelector(`label[for="${CSS.escape(el.id)}"]`);
      if (label) return label.textContent.trim();
    }
    const parentLabel = el.closest('label');
    if (parentLabel) {
      // Clone and remove the input itself to get clean label text
      const clone = parentLabel.cloneNode(true);
      clone.querySelectorAll('input, select, textarea, button').forEach(child => child.remove());
      return clone.textContent.trim();
    }
    const ariaLabel = el.getAttribute('aria-label');
    if (ariaLabel) return ariaLabel.trim();
    return el.getAttribute('placeholder') || el.name || el.id || '';
  }

  function classifyField(el) {
    const type = (el.getAttribute('type') || 'text').toLowerCase();
    const autocomplete = (el.getAttribute('autocomplete') || '').toLowerCase();
    const name = el.getAttribute('name') || '';
    const id = el.id || '';
    const placeholder = el.getAttribute('placeholder') || '';
    const labelText = getAssociatedLabelText(el);
    const combinedAttr = `${type} ${autocomplete} ${name} ${id} ${placeholder} ${labelText}`.toLowerCase();

    // Check HIGH sensitivity first
    if (type === 'password' || HIGH_SENSITIVITY_KEYWORDS.test(combinedAttr)) {
      let category = 'PASSWORD';
      if (/otp|verification\s*code/i.test(combinedAttr)) category = 'OTP';
      else if (/\bpin\b|pincode|pin_code/i.test(combinedAttr)) category = 'PIN';
      else if (/api_?key/i.test(combinedAttr)) category = 'API_KEY';
      else if (/token/i.test(combinedAttr)) category = 'TOKEN';
      else if (/private_?key/i.test(combinedAttr)) category = 'PRIVATE_KEY';
      else if (/card|credit|cvv|cvc/i.test(combinedAttr)) category = 'CREDIT_CARD';

      return {
        isSensitive: true,
        sensitivity: 'HIGH',
        category: category,
        placeholder: `[PII_${category}]`
      };
    }

    // Check MODERATE/LOW sensitivity
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
        category: category,
        placeholder: `[PII_${category}]`
      };
    }

    return { isSensitive: false, sensitivity: 'NONE', category: 'GENERAL', placeholder: null };
  }

  function scanDOMInputs() {
    const boundingBoxes = [];
    const sanitizedDom = [];
    const elements = document.querySelectorAll('input, textarea, select, [contenteditable="true"], button, a, [role="button"]');

    elements.forEach((el) => {
      if (!isVisible(el)) return;

      const rect = el.getBoundingClientRect();
      const role = el.getAttribute('role') || el.tagName.toLowerCase();
      const label = getAssociatedLabelText(el);
      const classification = classifyField(el);

      const elementBbox = [
        Math.round(rect.left + window.scrollX),
        Math.round(rect.top + window.scrollY),
        Math.round(rect.width),
        Math.round(rect.height)
      ];

      if (classification.isSensitive) {
        // Tight region-level bounding box specifically for the input value area
        boundingBoxes.push({
          x: elementBbox[0],
          y: elementBbox[1],
          width: elementBbox[2],
          height: elementBbox[3],
          type: 'DOM_PII',
          sensitivity: classification.sensitivity,
          category: classification.category,
          placeholder: classification.placeholder,
          reason: `${el.tagName.toLowerCase()}[${classification.category}]`,
          element: el
        });
      }

      // Build structured sanitized context entry for server/VLM
      sanitizedDom.push({
        role: role,
        semantic_type: classification.category,
        label: label,
        has_value: !!(el.value || el.textContent.trim()),
        value: classification.isSensitive ? classification.placeholder : (el.value || el.textContent.trim() || null),
        sensitivity: classification.sensitivity,
        bbox: elementBbox,
        selector: el.id ? `#${el.id}` : (el.name ? `input[name="${el.name}"]` : el.tagName.toLowerCase())
      });
    });

    return {
      boundingBoxes: boundingBoxes,
      sanitizedDom: sanitizedDom
    };
  }

  return {
    scan: scanDOMInputs
  };
})();

