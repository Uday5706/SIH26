/**
 * Tier 2: Probabilistic Text & Regex NLP PII Scanner
 * Scans visible text nodes for Credit Cards (with Luhn validation), Emails, SSNs, Aadhaar, Phone numbers, OTPs, PINs, and API Keys.
 * Computes exact DOM Range bounding boxes for localized blurring/masking.
 */

window.PIITextScanner = (function () {

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

  const PATTERNS = [
    {
      name: 'API_KEY',
      category: 'API_KEY',
      sensitivity: 'HIGH',
      placeholder: '[PII_API_KEY]',
      regex: /\b(?:sk_live_|pk_live_|api_key_|AKIA)[a-zA-Z0-9]{16,40}\b/g
    },
    {
      name: 'OTP',
      category: 'OTP',
      sensitivity: 'HIGH',
      placeholder: '[PII_OTP]',
      regex: /\b(?:OTP|code|verification\s*code)\s*[:=]?\s*(\d{4,8})\b/gi
    },
    {
      name: 'PIN',
      category: 'PIN',
      sensitivity: 'HIGH',
      placeholder: '[PII_PIN]',
      regex: /\b(?:PIN|pin\s*code)\s*[:=]?\s*(\d{4,6})\b/gi
    },
    {
      name: 'Token',
      category: 'TOKEN',
      sensitivity: 'HIGH',
      placeholder: '[PII_TOKEN]',
      regex: /\b(?:bearer\s+|token\s*[:=]?\s*)([a-zA-Z0-9._-]{20,})\b/gi
    },
    {
      name: 'PrivateKey',
      category: 'PRIVATE_KEY',
      sensitivity: 'HIGH',
      placeholder: '[PII_PRIVATE_KEY]',
      regex: /-----BEGIN\s+(?:RSA\s+|EC\s+|OPENSSH\s+|PRIVATE\s+)?KEY-----/g
    },
    {
      name: 'Email',
      category: 'EMAIL',
      sensitivity: 'MODERATE',
      placeholder: '[PII_EMAIL]',
      regex: /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g
    },
    {
      name: 'Aadhaar',
      category: 'GOVT_ID',
      sensitivity: 'MODERATE',
      placeholder: '[PII_GOVT_ID]',
      regex: /\b[2-9]\d{3}\s?\d{4}\s?\d{4}\b/g
    },
    {
      name: 'SSN',
      category: 'GOVT_ID',
      sensitivity: 'MODERATE',
      placeholder: '[PII_GOVT_ID]',
      regex: /\b\d{3}-\d{2}-\d{4}\b/g
    },
    {
      name: 'Phone',
      category: 'PHONE',
      sensitivity: 'MODERATE',
      placeholder: '[PII_PHONE]',
      regex: /\b(?:\+?\d{1,3}[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}\b/g
    },
    {
      name: 'CreditCard',
      category: 'CREDIT_CARD',
      sensitivity: 'HIGH',
      placeholder: '[PII_CREDIT_CARD]',
      regex: /\b(?:\d[ -]*?){13,16}\b/g,
      validate: validateLuhn
    },
    {
      name: 'Name',
      category: 'NAME',
      sensitivity: 'MODERATE',
      placeholder: '[PII_NAME]',
      regex: /\b(?:Name|Full Name|Customer)\s*:\s*([A-Z][a-z]+\s+[A-Z][a-z]+)\b/gi
    },
    {
      name: 'Address',
      category: 'ADDRESS',
      sensitivity: 'MODERATE',
      placeholder: '[PII_ADDRESS]',
      regex: /\b\d+\s+[A-Z][a-z]+\s+(?:Street|St|Avenue|Ave|Road|Rd|Boulevard|Blvd|Lane|Ln|Drive|Dr|Suite|Ste)\b/gi
    }
  ];

  function scanTextNodes() {
    const boundingBoxes = [];
    const walker = document.createTreeWalker(
      document.body,
      NodeFilter.SHOW_TEXT,
      {
        acceptNode: function (node) {
          if (!node.textContent || !node.textContent.trim()) return NodeFilter.FILTER_SKIP;
          const parent = node.parentElement;
          if (!parent) return NodeFilter.FILTER_SKIP;
          const style = window.getComputedStyle(parent);
          if (style.display === 'none' || style.visibility === 'hidden' || parent.tagName === 'SCRIPT' || parent.tagName === 'STYLE') {
            return NodeFilter.FILTER_SKIP;
          }
          return NodeFilter.FILTER_ACCEPT;
        }
      }
    );

    let currentNode;
    while ((currentNode = walker.nextNode())) {
      const text = currentNode.textContent;
      
      PATTERNS.forEach(({ name, category, sensitivity, placeholder, regex, validate }) => {
        regex.lastIndex = 0;
        let match;
        while ((match = regex.exec(text)) !== null) {
          const matchedString = match[0];
          if (validate && !validate(matchedString)) {
            continue;
          }

          try {
            const range = document.createRange();
            range.setStart(currentNode, match.index);
            range.setEnd(currentNode, match.index + matchedString.length);

            const rects = range.getClientRects();
            for (let i = 0; i < rects.length; i++) {
              const rect = rects[i];
              if (rect.width > 0 && rect.height > 0) {
                boundingBoxes.push({
                  x: Math.round(rect.left + window.scrollX),
                  y: Math.round(rect.top + window.scrollY),
                  width: Math.round(rect.width),
                  height: Math.round(rect.height),
                  type: 'TEXT_PII',
                  sensitivity: sensitivity,
                  category: category,
                  placeholder: placeholder,
                  reason: name
                });
              }
            }
          } catch (e) {
            // Ignore range calculation edge cases
          }
        }
      });
    }

    return boundingBoxes;
  }

  return {
    scan: scanTextNodes
  };
})();

