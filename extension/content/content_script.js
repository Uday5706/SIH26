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

    if (action === 'SCAN_PII') {
      const domResult = window.PIIDomScanner ? window.PIIDomScanner.scan() : { boundingBoxes: [], sanitizedDom: [] };
      const textBoxes = window.PIITextScanner ? window.PIITextScanner.scan() : [];
      const allBoxes = [...(domResult.boundingBoxes || []), ...textBoxes];

      sendResponse({
        success: true,
        boundingBoxes: allBoxes,
        sanitizedDom: domResult.sanitizedDom || [],
        viewport: {
          width: window.innerWidth,
          height: window.innerHeight,
          scrollX: window.scrollX,
          scrollY: window.scrollY
        }
      });
      return true;
    }

    if (action === 'EXECUTE_STEPS') {
      const steps = payload.steps || [];
      
      // We process the steps sequentially in the content script
      // However, usually the Controller loops through them one by one.
      // If the controller sends multiple steps at once, we execute them in order.
      
      (async function() {
        for (let i = 0; i < steps.length; i++) {
           const step = steps[i];
           chrome.runtime.sendMessage({
             action: 'LOG_EVENT',
             payload: { message: `Executing step ${i + 1}/${steps.length}: ${step.action}` }
           });
           
           const result = await window.ActionExecutor.executeAction(step);
           
           if (!result.success) {
              chrome.runtime.sendMessage({
                action: 'EXECUTION_FINISHED',
                payload: { success: false, error: result.error, failedStepIndex: i }
              });
              return;
           }
        }
        
        chrome.runtime.sendMessage({
          action: 'EXECUTION_FINISHED',
          payload: { success: true, finished: true }
        });
      })();

      sendResponse({ success: true, status: 'Execution started' });
      return true;
    }

    if (action === 'STOP_EXECUTION') {
      sendResponse({ success: true, status: 'Execution stopping not fully implemented for new executor but acknowledged' });
      return true;
    }
  });
})();
