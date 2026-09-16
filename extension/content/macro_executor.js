/**
 * Macro-Micro Step Executor
 * Executes structured action plans locally on the active DOM.
 * Listens for UI shifts via MutationObserver and falls back to fuzzy DOM matching.
 */

window.MacroExecutor = (function () {
  let isExecuting = false;
  let currentObserver = null;
  let fakeCursor = null;
  let currentCursorX = -50;
  let currentCursorY = -50;

  function initCursor() {
    if (!fakeCursor) {
      fakeCursor = document.createElement('div');
      fakeCursor.id = 'vlm-fake-cursor';
      fakeCursor.style.position = 'fixed';
      fakeCursor.style.top = '0';
      fakeCursor.style.left = '0';
      fakeCursor.style.width = '32px';
      fakeCursor.style.height = '32px';
      
      // Realistic Mouse SVG Cursor (Base64)
      const cursorSvg = `data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAyNCAyNCI+PHBhdGggZD0iTTEgMSBsMTIgMTUgbC0zIC0xIGwyIDUgbC0zIDEgbC0yIC01IGwtNSAzIHoiIGZpbGw9ImJsYWNrIiBzdHJva2U9IndoaXRlIiBzdHJva2Utd2lkdGg9IjIiLz48L3N2Zz4=`;
      
      fakeCursor.style.backgroundImage = `url("${cursorSvg}")`;
      fakeCursor.style.backgroundSize = 'contain';
      fakeCursor.style.backgroundRepeat = 'no-repeat';
      fakeCursor.style.zIndex = '9999999';
      fakeCursor.style.pointerEvents = 'none';
      fakeCursor.style.transition = 'transform 0.4s ease-in-out, filter 0.15s ease';
      fakeCursor.style.transform = `translate(${currentCursorX}px, ${currentCursorY}px)`; // start offscreen
      document.documentElement.appendChild(fakeCursor);
    }
  }

  async function animateCursor(x, y) {
    initCursor();
    currentCursorX = x;
    currentCursorY = y;
    // Offset slightly so the tip of the arrow is exactly on the coordinate
    fakeCursor.style.transform = `translate(${x}px, ${y}px)`; 
    await delay(400); // wait for movement
    
    // Ripple / Click effect
    fakeCursor.style.transform = `translate(${x}px, ${y}px) scale(0.85)`;
    fakeCursor.style.filter = 'drop-shadow(0px 0px 8px rgba(50,255,50,0.8))';
    await delay(150);
    fakeCursor.style.transform = `translate(${x}px, ${y}px) scale(1)`;
    fakeCursor.style.filter = 'drop-shadow(0px 0px 2px rgba(0,0,0,0.5))';
  }

  function findElement(selector, fallbackText, coordinates) {
    if (selector) {
      try {
        // Handle common VLM hallucination of jQuery :contains selector natively
        if (selector.includes(':contains(')) {
           const parts = selector.split(':contains(');
           const tag = parts[0] || '*';
           const text = parts[1].replace(/\)$/, '').replace(/['"]/g, '').toLowerCase();
           const elements = Array.from(document.querySelectorAll(tag));
           // Find the deepest element that contains the text
           let bestMatch = null;
           for (const el of elements) {
               if (el.textContent.toLowerCase().includes(text)) {
                   if (!bestMatch || bestMatch.contains(el)) {
                       bestMatch = el;
                   }
               }
           }
           if (bestMatch) return bestMatch;
        } else {
            const elements = Array.from(document.querySelectorAll(selector));
            let visibleElements = elements.filter(el => {
                const rect = el.getBoundingClientRect();
                return rect.width > 0 && rect.height > 0 && rect.bottom >= 0 && rect.top <= window.innerHeight;
            });
            
            if (visibleElements.length > 0) {
                if (coordinates && coordinates.x !== undefined && coordinates.y !== undefined) {
                    const cx = coordinates.x <= 1 ? coordinates.x * window.innerWidth : coordinates.x;
                    const cy = coordinates.y <= 1 ? coordinates.y * window.innerHeight : coordinates.y;
                    
                    let closest = visibleElements[0];
                    let minDistance = Infinity;
                    
                    for (const el of visibleElements) {
                        const rect = el.getBoundingClientRect();
                        const elCenterX = rect.left + rect.width / 2;
                        const elCenterY = rect.top + rect.height / 2;
                        const dist = Math.sqrt(Math.pow(elCenterX - cx, 2) + Math.pow(elCenterY - cy, 2));
                        if (dist < minDistance) {
                            minDistance = dist;
                            closest = el;
                        }
                    }
                    return closest;
                }
                return visibleElements[0];
            }
            if (elements.length > 0) return elements[0];
         }
      } catch (e) {
        // Invalid selector syntax
      }
    }

    // Fuzzy matching fallback via text or placeholder
    if (fallbackText) {
      const lowerFallback = fallbackText.toLowerCase();
      const candidates = document.querySelectorAll('button, a, input, [role="button"], [role="link"], li, h1, h2, h3, h4, span');
      let bestFuzzyMatch = null;
      for (const candidate of candidates) {
        const text = (candidate.textContent || candidate.value || candidate.getAttribute('placeholder') || candidate.getAttribute('aria-label') || '').toLowerCase();
        if (text.includes(lowerFallback)) {
          const rect = candidate.getBoundingClientRect();
          const isVisible = rect.width > 0 && rect.height > 0 && rect.bottom >= 0 && rect.top <= window.innerHeight;
          if (isVisible) return candidate; // Prioritize first visible match
          if (!bestFuzzyMatch) bestFuzzyMatch = candidate;
        }
      }
      if (bestFuzzyMatch) return bestFuzzyMatch;
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

    const targetElement = findElement(target_selector, text_fallback, coordinates);
    if (!targetElement && !coordinates && action_type !== 'scroll' && action_type !== 'wait_for_mutation' && action_type !== 'finish' && action_type !== 'go_back') {
      return { success: false, error: `Element not found: ${target_selector || text_fallback}` };
    }

    if (targetElement) {
      targetElement.scrollIntoView({ behavior: 'smooth', block: 'center' });
      // Wait for smooth scrolling to completely finish before calculating coordinates
      await delay(800);
    }

    switch (action_type) {
      case 'click':
        let cx = 0, cy = 0;
        if (targetElement) {
          const rect = targetElement.getBoundingClientRect();
          cx = rect.left + rect.width / 2;
          cy = rect.top + rect.height / 2;
        } else if (coordinates && coordinates.x !== undefined && coordinates.y !== undefined) {
          cx = coordinates.x <= 1 ? coordinates.x * window.innerWidth : coordinates.x;
          cy = coordinates.y <= 1 ? coordinates.y * window.innerHeight : coordinates.y;
        }
        await animateCursor(cx, cy);
        
        let clickTarget = null;
        // Use native DOM click
        if (targetElement) {
            clickTarget = targetElement;
        } else if (coordinates && coordinates.x !== undefined) {
            clickTarget = document.elementFromPoint(cx, cy);
        }
        
        if (clickTarget) {
            // New Tab Shield: prevent links from opening in a new tab
            let parent = clickTarget;
            while (parent && parent !== document.body) {
                if (parent.tagName === 'A' && parent.getAttribute('target') === '_blank') {
                    parent.removeAttribute('target');
                }
                parent = parent.parentElement;
            }
            // Dispatch real mouse events for React/Angular/Vue/SVG apps
            ['mousedown', 'mouseup', 'click'].forEach(eventType => {
                const event = new MouseEvent(eventType, {
                    view: window,
                    bubbles: true,
                    cancelable: true,
                    clientX: cx,
                    clientY: cy,
                    buttons: 1
                });
                clickTarget.dispatchEvent(event);
            });
            
            // Fallback to native click
            if (typeof clickTarget.click === 'function') {
                try { clickTarget.click(); } catch(e) {}
            }
        }
        
        await waitForDOMMutation(3000, 500);
        return { success: true };

      case 'type':
        let tx = 0, ty = 0;
        if (targetElement) {
          const rect = targetElement.getBoundingClientRect();
          tx = rect.left + rect.width / 2;
          ty = rect.top + rect.height / 2;
        } else if (coordinates && coordinates.x !== undefined && coordinates.y !== undefined) {
          tx = coordinates.x <= 1 ? coordinates.x * window.innerWidth : coordinates.x;
          ty = coordinates.y <= 1 ? coordinates.y * window.innerHeight : coordinates.y;
        }
        await animateCursor(tx, ty);

        let finalTarget = targetElement;
        if (!targetElement && coordinates && coordinates.x !== undefined) {
            finalTarget = document.elementFromPoint(tx, ty);
        }

        // Robust resolution: If we landed on a label or wrapper, find the actual input
        if (finalTarget && finalTarget.tagName !== 'INPUT' && finalTarget.tagName !== 'TEXTAREA' && finalTarget.tagName !== 'SELECT') {
            if (finalTarget.tagName === 'LABEL' && finalTarget.htmlFor) {
                finalTarget = document.getElementById(finalTarget.htmlFor) || finalTarget;
            } else {
                const childInput = finalTarget.querySelector('input, textarea, select');
                if (childInput) {
                    finalTarget = childInput;
                } else if (finalTarget.parentElement) {
                    const siblingInput = finalTarget.parentElement.querySelector('input, textarea, select');
                    if (siblingInput) finalTarget = siblingInput;
                }
            }
        }

        if (finalTarget) {
            finalTarget.focus();
            const nativeInputValueSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set;
            if (nativeInputValueSetter && finalTarget instanceof HTMLInputElement) {
              nativeInputValueSetter.call(finalTarget, value || '');
            } else {
              finalTarget.value = value || '';
            }
            finalTarget.dispatchEvent(new Event('input', { bubbles: true }));
            finalTarget.dispatchEvent(new Event('change', { bubbles: true }));
        }
        await waitForDOMMutation(3000, 500);
        return { success: true };

      case 'right_click':
        let rx = 0, ry = 0;
        if (targetElement) {
          const rect = targetElement.getBoundingClientRect();
          rx = rect.left + rect.width / 2;
          ry = rect.top + rect.height / 2;
        } else if (coordinates && coordinates.x !== undefined && coordinates.y !== undefined) {
          rx = coordinates.x <= 1 ? coordinates.x * window.innerWidth : coordinates.x;
          ry = coordinates.y <= 1 ? coordinates.y * window.innerHeight : coordinates.y;
        }
        await animateCursor(rx, ry);

        let rightClickTarget = targetElement;
        if (!targetElement && coordinates && coordinates.x !== undefined) {
            rightClickTarget = document.elementFromPoint(rx, ry);
        }

        if (rightClickTarget) {
            ['mousedown', 'mouseup', 'contextmenu'].forEach(eventType => {
                const event = new MouseEvent(eventType, {
                    view: window,
                    bubbles: true,
                    cancelable: true,
                    clientX: rx,
                    clientY: ry,
                    button: 2,
                    buttons: 2
                });
                rightClickTarget.dispatchEvent(event);
            });
        }
        await waitForDOMMutation(3000, 500);
        return { success: true };

      case 'hover':
        let hx = 0, hy = 0;
        if (targetElement) {
          const rect = targetElement.getBoundingClientRect();
          hx = rect.left + rect.width / 2;
          hy = rect.top + rect.height / 2;
        } else if (coordinates && coordinates.x !== undefined && coordinates.y !== undefined) {
          hx = coordinates.x <= 1 ? coordinates.x * window.innerWidth : coordinates.x;
          hy = coordinates.y <= 1 ? coordinates.y * window.innerHeight : coordinates.y;
        }
        await animateCursor(hx, hy);

        let hoverTarget = targetElement;
        if (!targetElement && coordinates && coordinates.x !== undefined) {
            hoverTarget = document.elementFromPoint(hx, hy);
        }

        if (hoverTarget) {
            ['mouseenter', 'mouseover', 'mousemove'].forEach(eventType => {
                const event = new MouseEvent(eventType, {
                    view: window,
                    bubbles: true,
                    cancelable: true,
                    clientX: hx,
                    clientY: hy,
                    button: 0,
                    buttons: 0
                });
                hoverTarget.dispatchEvent(event);
            });
        }
        await waitForDOMMutation(3000, 500);
        return { success: true };

      case 'wait_for_mutation':
        await waitForDOMMutation(step.timeout || 3000, 500);
        return { success: true };

      case 'finish':
        return { success: true, finished: true };
        
      case 'go_back':
        window.history.back();
        await delay(1500);
        return { success: true };

      default:
        return { success: false, error: `Unknown action_type: ${action_type}` };
    }
  }

  function waitForDOMMutation(timeoutMs = 3000, idleMs = 500) {
    return new Promise((resolve) => {
      let timeoutTimer;
      let idleTimer;

      const observer = new MutationObserver((mutations) => {
        if (mutations.length > 0) {
          clearTimeout(idleTimer);
          idleTimer = setTimeout(() => {
             clearTimeout(timeoutTimer);
             observer.disconnect();
             resolve(true);
          }, idleMs);
        }
      });

      observer.observe(document.body, {
        childList: true,
        subtree: true,
        attributes: true
      });

      timeoutTimer = setTimeout(() => {
        clearTimeout(idleTimer);
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

  function getCursorPosition() {
    return { x: currentCursorX, y: currentCursorY };
  }

  return {
    executePlan,
    stop,
    getCursorPosition
  };
})();
