/**
 * Background Service Worker Orchestrator
 * Manages Offscreen document lifecycle, state transitions, tab capture,
 * backend API transmission, and macro execution loops.
 */

let agentState = {
  isRunning: false,
  status: 'Idle',
  userGoal: '',
  serverUrl: 'http://127.0.0.1:8000',
  domRedactionEnabled: true,
  textRedactionEnabled: true,
  cvRedactionEnabled: true,
  redactionBufferPx: 5,
  logs: []
};

const OFFSCREEN_DOCUMENT_PATH = 'offscreen/offscreen.html';

// Offscreen Document Lifecycle Management
async function setupOffscreenDocument() {
  if (await hasOffscreenDocument()) return;

  try {
    await chrome.offscreen.createDocument({
      url: OFFSCREEN_DOCUMENT_PATH,
      reasons: [chrome.offscreen.Reason.DOM_PARSER || 'DOM_PARSER', chrome.offscreen.Reason.BLOBS || 'BLOBS'],
      justification: 'Offscreen canvas processing for PII visual redaction and WebP encoding.'
    });
  } catch (err) {
    if (!err.message.includes('Only a single offscreen document')) {
      throw err;
    }
  }
}

async function hasOffscreenDocument() {
  const matchedClients = await clients.matchAll();
  for (const client of matchedClients) {
    if (client.url.endsWith(OFFSCREEN_DOCUMENT_PATH)) {
      return true;
    }
  }
  return false;
}

function addLog(msg) {
  const timestamp = new Date().toLocaleTimeString();
  const entry = `[${timestamp}] ${msg}`;
  agentState.logs.unshift(entry);
  if (agentState.logs.length > 50) agentState.logs.pop();

  // Notify active popups
  chrome.runtime.sendMessage({
    action: 'LOG_EVENT',
    payload: { entry, logs: agentState.logs }
  }).catch(() => {});
}

function updateStatus(newStatus) {
  agentState.status = newStatus;
  addLog(`Status: ${newStatus}`);
  chrome.runtime.sendMessage({
    action: 'STATUS_UPDATE',
    payload: { status: agentState.status, isRunning: agentState.isRunning }
  }).catch(() => {});
}

async function ensureContentScriptInjected(tabId) {
  try {
    await chrome.tabs.sendMessage(tabId, { action: 'PING' });
  } catch (err) {
    try {
      await chrome.scripting.executeScript({
        target: { tabId: tabId },
        files: [
          'content/pii_dom_scanner.js',
          'content/pii_text_scanner.js',
          'content/macro_executor.js',
          'content/content_script.js'
        ]
      });
      await new Promise((r) => setTimeout(r, 150));
    } catch (e) {
      console.warn('Could not inject content scripts dynamically:', e);
    }
  }
}

// Core Execution Cycle
async function runAgentCycle(tabId) {
  if (!agentState.isRunning) return;

  try {
    updateStatus('Scanning DOM & Text PII...');
    await setupOffscreenDocument();
    await ensureContentScriptInjected(tabId);

    // Step 1: Scan Tier 1 & 2 PII bounding boxes from active content script
    const contentResponse = await chrome.tabs.sendMessage(tabId, { action: 'SCAN_PII' });
    const boundingBoxes = (contentResponse && contentResponse.boundingBoxes) || [];
    addLog(`Scanned ${boundingBoxes.length} PII target bounding boxes.`);

    // Step 2: Capture screen state
    updateStatus('Capturing screen state...');
    const rawDataUrl = await chrome.tabs.captureVisibleTab(null, { format: 'png' });

    // Step 3: Offscreen Canvas Obfuscation (+5px padding & Tier 3 CV)
    updateStatus('Redacting sensitive visual regions...');
    const redactionResult = await chrome.runtime.sendMessage({
      action: 'REDACT_CANVAS',
      payload: {
        dataUrl: rawDataUrl,
        boundingBoxes: boundingBoxes,
        paddingPx: agentState.redactionBufferPx,
        cvEnabled: agentState.cvRedactionEnabled
      }
    });

    if (!redactionResult || !redactionResult.success) {
      throw new Error(redactionResult?.error || 'Canvas redaction failed.');
    }

    const { redactedImageWebp, redactedCount } = redactionResult.result;
    addLog(`Obfuscation complete. ${redactedCount} regions blacked out (+${agentState.redactionBufferPx}px buffer).`);

    // Step 4: Transmit anonymized payload to backend FastAPI server
    updateStatus('Sending anonymized state to VLM server...');
    const response = await fetch(`${agentState.serverUrl}/api/v1/plan`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        goal: agentState.userGoal,
        image: redactedImageWebp,
        tab_info: { id: tabId }
      })
    });

    if (!response.ok) {
      throw new Error(`Server returned status ${response.status}`);
    }

    const planData = await response.json();
    const steps = planData.steps || [];
    addLog(`VLM returned plan with ${steps.length} steps.`);

    if (steps.length === 0 || planData.status === 'completed') {
      agentState.isRunning = false;
      updateStatus('Goal Completed Successfully!');
      return;
    }

    // Step 5: Execute Macro Plan on tab
    updateStatus('Executing macro step plan...');
    await chrome.tabs.sendMessage(tabId, {
      action: 'EXECUTE_STEPS',
      payload: { steps: steps }
    });

  } catch (err) {
    console.error('Agent cycle error:', err);
    agentState.isRunning = false;
    updateStatus(`Error: ${err.message}`);
  }
}

// Runtime Listener
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  const { action, payload } = message;

  if (action === 'START_AGENT') {
    agentState.isRunning = true;
    agentState.userGoal = payload.goal || 'Complete task';
    agentState.serverUrl = payload.serverUrl || agentState.serverUrl;
    updateStatus('Starting Agent Loop...');

    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (tabs.length > 0) {
        runAgentCycle(tabs[0].id);
      } else {
        agentState.isRunning = false;
        updateStatus('Error: No active tab found.');
      }
    });

    sendResponse({ success: true, state: agentState });
    return true;
  }

  if (action === 'STOP_AGENT') {
    agentState.isRunning = false;
    updateStatus('Agent Stopped by User.');
    
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (tabs.length > 0) {
        chrome.tabs.sendMessage(tabs[0].id, { action: 'STOP_EXECUTION' }).catch(() => {});
      }
    });

    sendResponse({ success: true, state: agentState });
    return true;
  }

  if (action === 'GET_AGENT_STATUS') {
    sendResponse({ success: true, state: agentState });
    return true;
  }

  if (action === 'EXECUTION_FINISHED') {
    if (payload && payload.finished) {
      agentState.isRunning = false;
      updateStatus('Task execution finished!');
    } else if (agentState.isRunning) {
      // Re-trigger cycle for dynamic page updates
      chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        if (tabs.length > 0) {
          runAgentCycle(tabs[0].id);
        }
      });
    }
  }

  if (action === 'LOG_EVENT') {
    if (payload && payload.message) {
      addLog(payload.message);
    }
  }
});
