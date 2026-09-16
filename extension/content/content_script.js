/**
 * Content Script Controller
 * Connects background service worker commands with DOM scanners and macro executor.
 */

(function () {
  console.log('[Privacy Vision Agent] Content script loaded.');

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    const { action, payload } = message;

    if (action === 'PING') {
      sendResponse({ status: 'PONG' });
      return true;
    }

    function getSimplifiedDOM() {
      const interactives = document.querySelectorAll('input, select, textarea, button, a, label, [role="button"], [role="link"], h1, h2, h3, h4');
      let domLines = [];
      
      interactives.forEach(el => {
         // Skip invisible or hidden elements
         const rect = el.getBoundingClientRect();
         if (rect.width === 0 || rect.height === 0 || el.type === 'hidden') return;
         
         // Only include elements that are near the current viewport to aggressively compress DOM
         if (rect.bottom < -500 || rect.top > window.innerHeight + 1000) return;
         
         let str = `[${el.tagName.toLowerCase()}]`;
         
         // Extract useful attributes for the LLM
         ['id', 'name', 'type', 'placeholder', 'for', 'aria-label'].forEach(attr => {
             if (el.hasAttribute(attr)) {
                 str += ` ${attr}="${el.getAttribute(attr)}"`;
             }
         });
         
         // Sync live values
         if (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT') {
             if (el.type === 'checkbox' || el.type === 'radio') {
                 if (el.checked) str += ' checked';
             } else if (el.value) {
                 str += ` value="${el.value}"`;
             }
         }
         
         // Add absolute center coordinates
         const cx = Math.round(rect.left + rect.width / 2);
         const cy = Math.round(rect.top + rect.height / 2);
         str += ` center="${cx},${cy}"`;
         
         // Extract inner text for buttons and labels
         const text = el.textContent.trim().replace(/\s+/g, ' ');
         if (text && el.tagName !== 'INPUT' && el.tagName !== 'SELECT') {
             str += ` text="${text.substring(0, 100)}"`;
         }
         
         domLines.push(str);
      });
      
      return domLines.join('\n');
    }

    if (action === 'SCAN_PII') {
      const domBoxes = window.PIIDomScanner ? window.PIIDomScanner.scan() : [];
      const textBoxes = window.PIITextScanner ? window.PIITextScanner.scan() : [];
      const allBoxes = [...domBoxes, ...textBoxes];

      sendResponse({
        success: true,
        boundingBoxes: allBoxes,
        dom_snapshot: getSimplifiedDOM(),
        viewport: {
          width: window.innerWidth,
          height: window.innerHeight,
          devicePixelRatio: window.devicePixelRatio || 1.0,
          scrollX: window.scrollX,
          scrollY: window.scrollY,
          cursor_position: window.MacroExecutor ? window.MacroExecutor.getCursorPosition() : null
        }
      });
      return true;
    }

    if (action === 'EXECUTE_STEPS') {
      const steps = payload.steps || [];
      window.MacroExecutor.executePlan(steps, (index, step) => {
        chrome.runtime.sendMessage({
          action: 'LOG_EVENT',
          payload: { message: `Executing step ${index + 1}/${steps.length}: ${step.action_type} on ${step.target_selector || 'viewport'}` }
        });
      }).then((result) => {
        chrome.runtime.sendMessage({
          action: 'EXECUTION_FINISHED',
          payload: result
        });
      });

      sendResponse({ success: true, status: 'Execution started' });
      return true;
    }

    if (action === 'STOP_EXECUTION') {
      if (window.MacroExecutor) {
        window.MacroExecutor.stop();
      }
      sendResponse({ success: true, status: 'Execution stopped' });
      return true;
    }
  });
})();
