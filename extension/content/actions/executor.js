/**
 * Action Executor (Main Router)
 * Validates action JSON and routes to specific handlers.
 * Provides shared targeting and visual feedback utilities.
 */

window.ActionExecutor = (function() {
  
  const handlers = {};

  function registerHandler(actionName, handlerFn) {
    handlers[actionName] = handlerFn;
  }

  // Robust target resolution based on structured JSON targeting
  function resolveTarget(targetDef) {
    if (!targetDef) return null;

    // We build a list of all potential elements in the body
    // and score them based on matching attributes.
    const candidates = Array.from(document.querySelectorAll('button, a, input, textarea, select, [role="button"]'));
    
    let bestMatch = null;
    let highestScore = 0;

    for (const el of candidates) {
      if (!isVisible(el) || el.disabled) continue;

      let score = 0;
      
      // Match role / tag
      const role = el.getAttribute('role') || el.tagName.toLowerCase();
      if (targetDef.role && role.includes(targetDef.role.toLowerCase())) {
        score += 2;
      }

      // Match text (button text, link text)
      if (targetDef.text) {
        const textContent = (el.textContent || el.value || '').trim().toLowerCase();
        if (textContent === targetDef.text.toLowerCase()) {
          score += 5; // Exact match
        } else if (textContent.includes(targetDef.text.toLowerCase())) {
          score += 3; // Partial match
        }
      }

      // Match semantic type (from our DOM scanner) or specific attributes
      if (targetDef.semantic_type) {
        const type = (el.getAttribute('type') || '').toLowerCase();
        const name = (el.getAttribute('name') || '').toLowerCase();
        const placeholder = (el.getAttribute('placeholder') || '').toLowerCase();
        const combined = `${type} ${name} ${placeholder}`;
        
        if (combined.includes(targetDef.semantic_type.toLowerCase())) {
          score += 4;
        }
      }

      if (score > highestScore) {
        highestScore = score;
        bestMatch = el;
      }
    }

    // Fail safely if ambiguity is too high (we need a decent score to proceed)
    if (highestScore >= 2) {
      return bestMatch;
    }
    return null;
  }

  function isVisible(el) {
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

  // Visual action feedback
  function highlightElement(el) {
    const originalBorder = el.style.border;
    const originalBoxShadow = el.style.boxShadow;
    const originalTransition = el.style.transition;

    el.style.transition = 'all 0.2s ease';
    el.style.border = '2px solid #ef4444';
    el.style.boxShadow = '0 0 10px rgba(239, 68, 68, 0.8)';
    
    // Optional: Add a temporary tiny "Agent" indicator badge
    const badge = document.createElement('div');
    badge.textContent = '🤖 Agent';
    badge.style.position = 'absolute';
    badge.style.background = '#ef4444';
    badge.style.color = 'white';
    badge.style.fontSize = '10px';
    badge.style.padding = '2px 4px';
    badge.style.borderRadius = '4px';
    badge.style.zIndex = '999999';
    badge.style.pointerEvents = 'none';
    
    const rect = el.getBoundingClientRect();
    badge.style.top = `${rect.top + window.scrollY - 15}px`;
    badge.style.left = `${rect.left + window.scrollX}px`;
    document.body.appendChild(badge);

    setTimeout(() => {
      el.style.border = originalBorder;
      el.style.boxShadow = originalBoxShadow;
      el.style.transition = originalTransition;
      if (document.body.contains(badge)) {
        document.body.removeChild(badge);
      }
    }, 800);
  }

  function delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  async function executeAction(actionDef) {
    console.log('[ActionExecutor] Received action:', actionDef);
    try {
      if (!actionDef || !actionDef.action) {
        return { success: false, error: 'MALFORMED_ACTION' };
      }

      const handler = handlers[actionDef.action];
      if (!handler) {
        return { success: false, action: actionDef.action, error: 'UNSUPPORTED_ACTION' };
      }

      return await handler(actionDef, { resolveTarget, highlightElement, delay });
    } catch (err) {
      console.error('[ActionExecutor] Action failed:', err);
      return { success: false, action: actionDef?.action, error: err.message };
    }
  }

  return {
    registerHandler,
    executeAction,
    resolveTarget,
    highlightElement,
    delay
  };
})();
