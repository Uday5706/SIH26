/**
 * Tier 1: Deterministic DOM PII Scanner
 * Identifies sensitive form inputs, passwords, credit card fields, and ARIA attributes
 * Returns pixel-accurate bounding box coordinates for obfuscation.
 */

window.PIIDomScanner = (function () {
  const SENSITIVE_TYPES = new Set(['password', 'email', 'tel']);
  
  const SENSITIVE_AUTOCOMPLETE = new Set([
    'cc-number', 'cc-csc', 'cc-exp', 'cc-exp-month', 'cc-exp-year', 'cc-type',
    'email', 'tel', 'tel-national', 'bday', 'ssn', 'current-password', 'new-password'
  ]);

  const SENSITIVE_KEYWORDS = /password|pass|secret|cvv|cvc|card|credit|cardnumber|ssn|aadhaar|social|pin|tax|account/i;

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

  function scanDOMInputs() {
    const boundingBoxes = [];
    const elements = document.querySelectorAll('input, textarea, select, [contenteditable="true"]');

    elements.forEach((el) => {
      if (!isVisible(el)) return;

      let isSensitive = false;
      let reason = '';

      const type = (el.getAttribute('type') || '').toLowerCase();
      const autocomplete = (el.getAttribute('autocomplete') || '').toLowerCase();
      const name = el.getAttribute('name') || '';
      const id = el.id || '';
      const placeholder = el.getAttribute('placeholder') || '';
      const ariaLabel = el.getAttribute('aria-label') || '';
      const labelText = getAssociatedLabelText(el);

      if (type === 'password') {
        isSensitive = true;
        reason = 'input[type=password]';
      } else if (SENSITIVE_TYPES.has(type)) {
        isSensitive = true;
        reason = `input[type=${type}]`;
      } else if (SENSITIVE_AUTOCOMPLETE.has(autocomplete)) {
        isSensitive = true;
        reason = `autocomplete=${autocomplete}`;
      } else if (
        SENSITIVE_KEYWORDS.test(name) ||
        SENSITIVE_KEYWORDS.test(id) ||
        SENSITIVE_KEYWORDS.test(placeholder) ||
        SENSITIVE_KEYWORDS.test(ariaLabel) ||
        SENSITIVE_KEYWORDS.test(labelText)
      ) {
        isSensitive = true;
        reason = 'attribute heuristic match';
      }

      if (isSensitive) {
        const rect = el.getBoundingClientRect();
        boundingBoxes.push({
          x: Math.round(rect.left + window.scrollX),
          y: Math.round(rect.top + window.scrollY),
          width: Math.round(rect.width),
          height: Math.round(rect.height),
          type: 'DOM_PII',
          reason: reason,
          tag: el.tagName
        });
      }
    });

    return boundingBoxes;
  }

  function getAssociatedLabelText(el) {
    if (el.id) {
      const label = document.querySelector(`label[for="${el.id}"]`);
      if (label) return label.textContent || '';
    }
    const parentLabel = el.closest('label');
    if (parentLabel) return parentLabel.textContent || '';
    return '';
  }

  return {
    scan: scanDOMInputs
  };
})();
