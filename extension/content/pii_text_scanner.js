/**
 * Tier 2: Probabilistic Text & Regex NLP PII Scanner
 * Scans visible text nodes for Credit Cards (with Luhn validation), Emails, SSNs, Aadhaar numbers, and Phone numbers.
 * Computes exact DOM Range bounding boxes.
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
      name: 'Email',
      regex: /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g
    },
    {
      name: 'Aadhaar',
      regex: /\b[2-9]\d{3}\s?\d{4}\s?\d{4}\b/g
    },
    {
      name: 'SSN',
      regex: /\b\d{3}-\d{2}-\d{4}\b/g
    },
    {
      name: 'Phone',
      regex: /\b(?:\+?\d{1,3}[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}\b/g
    },
    {
      name: 'CreditCard',
      regex: /\b(?:\d[ -]*?){13,16}\b/g,
      validate: validateLuhn
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
      
      PATTERNS.forEach(({ name, regex, validate }) => {
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
                  reason: name,
                  text: matchedString.length > 4 ? matchedString.substring(0, 3) + '***' : '***'
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
