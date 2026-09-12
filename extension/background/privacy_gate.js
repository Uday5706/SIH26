/**
 * Final Privacy Validation Layer
 * Ensures that no raw sensitive data (HIGH or MODERATE sensitivity) leaves the local browser.
 * Deeply scrubs JSON payloads and forcefully replaces leaked PII with a placeholder.
 */

const PrivacyGate = (function () {
  // Luhn algorithm check for valid credit card numbers
  function validateLuhn(cardNumberStr) {
    const cleanNum = cardNumberStr.replace(/[\s-]/g, '');
    if (!/^\d{13,19}$/.test(cleanNum)) return false;

    let sum = 0;
    let shouldDouble = false;
    for (let i = cleanNum.length - 1; i >= 0; i--) {
      let digit = parseInt(cleanNum.charAt(i), 10);
      if (shouldDouble) {
        digit *= 2;
        if (digit > 9) digit -= 9;
      }
      sum += digit;
      shouldDouble = !shouldDouble;
    }
    return sum % 10 === 0;
  }

  // Define patterns for scrubbing out sensitive strings from the payload
  const PATTERNS = [
    {
      name: 'CreditCard',
      placeholder: '[BLOCKED_CREDIT_CARD]',
      regex: /\b(?:\d[ -]*?){13,16}\b/g,
      validate: validateLuhn
    },
    {
      name: 'API_KEY',
      placeholder: '[BLOCKED_API_KEY]',
      regex: /\b(?:sk_live_|pk_live_|api_key_|AKIA)[a-zA-Z0-9]{16,40}\b/g
    },
    {
      name: 'PrivateKey',
      placeholder: '[BLOCKED_PRIVATE_KEY]',
      regex: /-----BEGIN\s+(?:RSA\s+|EC\s+|OPENSSH\s+|PRIVATE\s+)?KEY-----/g
    },
    {
      name: 'SSN',
      placeholder: '[BLOCKED_SSN]',
      regex: /\b\d{3}-\d{2}-\d{4}\b/g
    },
    {
      name: 'Aadhaar',
      placeholder: '[BLOCKED_AADHAAR]',
      regex: /\b[2-9]\d{3}\s?\d{4}\s?\d{4}\b/g
    }
  ];

  /**
   * Sanitizes a single string by checking all privacy patterns.
   */
  function sanitizeString(str) {
    if (typeof str !== 'string') return str;
    
    let sanitizedStr = str;
    let wasModified = false;

    PATTERNS.forEach(pattern => {
      pattern.regex.lastIndex = 0; // reset regex
      
      if (pattern.validate) {
        sanitizedStr = sanitizedStr.replace(pattern.regex, (match) => {
          if (pattern.validate(match)) {
            wasModified = true;
            return pattern.placeholder;
          }
          return match;
        });
      } else {
        if (pattern.regex.test(sanitizedStr)) {
           wasModified = true;
           sanitizedStr = sanitizedStr.replace(pattern.regex, pattern.placeholder);
        }
      }
    });

    return { sanitizedStr, wasModified };
  }

  /**
   * Deeply traverses an object/array and scrubs all string values.
   */
  function deepSanitize(obj) {
    let modifications = 0;
    
    function recurse(current) {
      if (typeof current === 'string') {
        const result = sanitizeString(current);
        if (result.wasModified) modifications++;
        return result.sanitizedStr;
      }
      
      if (Array.isArray(current)) {
        return current.map(item => recurse(item));
      }
      
      if (current !== null && typeof current === 'object') {
        const sanitizedObj = {};
        for (const [key, value] of Object.entries(current)) {
          sanitizedObj[key] = recurse(value);
        }
        return sanitizedObj;
      }
      
      return current;
    }

    const safePayload = recurse(obj);
    return { safePayload, modifications };
  }

  return {
    auditPayload: function(payload) {
      return deepSanitize(payload);
    }
  };
})();

export { PrivacyGate };
