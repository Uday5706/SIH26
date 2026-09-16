/**
 * Content Script Controller
 * Connects background service worker commands with DOM scanners, observer, and action executor.
 */

(function () {
  console.log('[Privacy Vision Agent] Content script loaded.');

  // Initialize DOM Observer
  if (window.SentraDOMObserver) {
    window.SentraDOMObserver.start();
  } else {
    console.warn('[Privacy Vision Agent] SentraDOMObserver not found.');
  }

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    const { action, payload } = message;

    if (action === 'PING') {
      sendResponse({ status: 'PONG', revision: window.SentraDOMObserver ? window.SentraDOMObserver.getRevision() : 0 });
      return true;
    }

    if (action === 'GET_STATE_FULL') {
      try {
        const revision = window.SentraDOMObserver ? window.SentraDOMObserver.getRevision() : 0;
        const state = window.SentraPageExtractor ? window.SentraPageExtractor.extract({ revision }) : null;
        const vault = window.SentraTokenVault ? window.SentraTokenVault.getDebugSnapshot() : null;
        sendResponse({ success: true, state, vault });
      } catch (e) {
        console.error('GET_STATE_FULL error:', e);
        sendResponse({ success: false, error: e.message });
      }
      return true;
    }

    if (action === 'SYNC_VAULT') {
      if (window.SentraTokenVault && message.tokens) {
        window.SentraTokenVault.syncTokens(message.tokens);
      }
      sendResponse({ success: true });
      return true;
    }

    if (action === 'GET_STATE_DELTA') {
      try {
        const delta = window.SentraDOMObserver ? window.SentraDOMObserver.peekDelta() : null;
        if (!delta || !delta.hasChanges) {
          sendResponse({ success: true, hasChanges: false, revision: window.SentraDOMObserver ? window.SentraDOMObserver.getRevision() : 0 });
          return true;
        }

        const stateDelta = window.SentraPageExtractor ? window.SentraPageExtractor.extractByIds(
          [...delta.added, ...delta.updated], 
          delta.revision
        ) : null;

        sendResponse({
          success: true,
          hasChanges: true,
          revision: delta.revision,
          delta: {
            addedOrUpdated: stateDelta ? stateDelta.elements : [],
            removed: delta.removed
          }
        });
      } catch (e) {
        console.error('GET_STATE_DELTA error:', e);
        sendResponse({ success: false, error: e.message });
      }
      return true;
    }

    // Keep legacy SCAN_PII for compatibility
    if (action === 'SCAN_PII') {
      try {
        const domResult = window.PIIDomScanner ? window.PIIDomScanner.scan() : { boundingBoxes: [], sanitizedDom: [], sanitizationContext: null, vault: null };
        const textBoxes = window.PIITextScanner ? window.PIITextScanner.scan() : [];
        const allBoxes = [...(domResult.boundingBoxes || []), ...textBoxes];

        sendResponse({
          success: true,
          page: {
            url: window.location.href,
            title: document.title || window.location.hostname
          },
          boundingBoxes: allBoxes,
          sanitizedDom: domResult.sanitizedDom || [],
          sanitizationContext: domResult.sanitizationContext || null,
          vault: domResult.vault || null,
          domSnapshot: domResult.domSnapshot || '',
          viewportSize: domResult.viewportSize || {
            width: window.innerWidth,
            height: window.innerHeight,
            devicePixelRatio: window.devicePixelRatio || 1,
            scrollX: window.scrollX,
            scrollY: window.scrollY
          }
        });
      } catch (e) {
        console.error('SCAN_PII error in content script:', e);
        sendResponse({ success: false, error: e.message });
      }
      return true;
    }

    if (action === 'EXECUTE_STEPS') {
      const steps = payload.steps || [];
      const revision = window.SentraDOMObserver ? window.SentraDOMObserver.getRevision() : 0;
      
      (async function() {
        for (let i = 0; i < steps.length; i++) {
           const step = steps[i];
           chrome.runtime.sendMessage({
             action: 'LOG_EVENT',
             payload: { message: `Executing step ${i + 1}/${steps.length}: ${step.action}` }
           });
           
           // Pass through ActionGuard
           if (window.SentraActionGuard) {
             const validation = window.SentraActionGuard.validate(step, { currentRevision: revision });
             if (!validation.valid) {
                chrome.runtime.sendMessage({
                  action: 'EXECUTION_FINISHED',
                  payload: { success: false, error: `Guard rejected: ${validation.reason}`, failedStepIndex: i }
                });
                return;
             }
             // Prepare the validated step (with resolved values) for executor
             step.value = validation.resolvedValue;
             step.target_selector = validation.elementId ? `[data-sentra-id="${validation.elementId}"]` : step.target_selector;
           }
           
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
