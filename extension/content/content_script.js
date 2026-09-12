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
      const domBoxes = window.PIIDomScanner ? window.PIIDomScanner.scan() : [];
      const textBoxes = window.PIITextScanner ? window.PIITextScanner.scan() : [];
      const allBoxes = [...domBoxes, ...textBoxes];

      sendResponse({
        success: true,
        boundingBoxes: allBoxes,
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
