/**
 * Macro-Micro Step Executor
 * Executes structured action plans locally on the active DOM.
 * Listens for UI shifts via MutationObserver and falls back to fuzzy DOM matching.
 */

window.MacroExecutor = (function () {
  let isExecuting = false;
  let currentObserver = null;

  function findElement(selector, fallbackText) {
    if (selector) {
      try {
        const el = document.querySelector(selector);
        if (el) return el;
      } catch (e) {
        // Invalid selector syntax
      }
    }

    // Fuzzy matching fallback via text or placeholder
    if (fallbackText) {
      const lowerFallback = fallbackText.toLowerCase();
      const candidates = document.querySelectorAll('button, a, input, [role="button"]');
      for (const candidate of candidates) {
        const text = (candidate.textContent || candidate.value || candidate.getAttribute('placeholder') || '').toLowerCase();
        if (text.includes(lowerFallback)) {
          return candidate;
        }
      }
    }

    return null;
  }

  async function executeStep(step) {
    const { action_type, target_selector, text_fallback, value, coordinates } = step;

    if (action_type === 'scroll') {
      if (coordinates) {
        window.scrollTo({ left: coordinates.x, top: coordinates.y, behavior: 'smooth' });
      } else {
        window.scrollBy({ top: 300, behavior: 'smooth' });
      }
      await delay(400);
      return { success: true };
    }

    const targetElement = findElement(target_selector, text_fallback);
    if (!targetElement && action_type !== 'wait_for_mutation' && action_type !== 'finish') {
      return { success: false, error: `Element not found: ${target_selector || text_fallback}` };
    }

    if (targetElement) {
      targetElement.scrollIntoView({ behavior: 'smooth', block: 'center' });
      await delay(200);
    }

    switch (action_type) {
      case 'click':
        targetElement.click();
        await delay(300);
        return { success: true };

      case 'type':
        targetElement.focus();
        const nativeInputValueSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set;
        if (nativeInputValueSetter && targetElement instanceof HTMLInputElement) {
          nativeInputValueSetter.call(targetElement, value || '');
        } else {
          targetElement.value = value || '';
        }
        targetElement.dispatchEvent(new Event('input', { bubbles: true }));
        targetElement.dispatchEvent(new Event('change', { bubbles: true }));
        await delay(300);
        return { success: true };

      case 'wait_for_mutation':
        await waitForDOMMutation(step.timeout || 3000);
        return { success: true };

      case 'finish':
        return { success: true, finished: true };

      default:
        return { success: false, error: `Unknown action_type: ${action_type}` };
    }
  }

  function waitForDOMMutation(timeoutMs = 3000) {
    return new Promise((resolve) => {
      let timer;
      const observer = new MutationObserver((mutations) => {
        if (mutations.length > 0) {
          clearTimeout(timer);
          observer.disconnect();
          resolve(true);
        }
      });

      observer.observe(document.body, {
        childList: true,
        subtree: true,
        attributes: true
      });

      timer = setTimeout(() => {
        observer.disconnect();
        resolve(false);
      }, timeoutMs);
    });
  }

  async function executePlan(steps, onStepCallback) {
    isExecuting = true;

    for (let i = 0; i < steps.length; i++) {
      if (!isExecuting) break;

      const step = steps[i];
      if (onStepCallback) onStepCallback(i, step);

      const result = await executeStep(step);
      if (!result.success) {
        isExecuting = false;
        return { success: false, failedStepIndex: i, error: result.error };
      }

      if (result.finished) {
        isExecuting = false;
        return { success: true, finished: true };
      }
    }

    isExecuting = false;
    return { success: true };
  }

  function stop() {
    isExecuting = false;
    if (currentObserver) {
      currentObserver.disconnect();
    }
  }

  function delay(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  return {
    executePlan,
    stop
  };
})();
