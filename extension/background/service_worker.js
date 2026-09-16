/**
 * Background Service Worker Orchestrator
 * Manages Offscreen document lifecycle, state transitions, tab capture,
 * backend API transmission, and macro execution loops.
 */

// Initialize Side Panel behavior
chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch((error) => console.error(error));

let agentState = {
  isRunning: false,
  status: 'Idle',
  userGoal: '',
  serverUrl: 'http://127.0.0.1:8000',
  domRedactionEnabled: false,
  textRedactionEnabled: false,
  cvRedactionEnabled: false,
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

let agentSessionId = null;

function generateSessionId() {
  return 'sess_' + Math.random().toString(36).substr(2, 9) + '_' + Date.now();
}

// Core Execution Cycle
async function runAgentCycle(tabId) {
  if (!agentState.isRunning) return;

  try {
    if (!agentSessionId) {
      agentSessionId = generateSessionId();
      addLog(`Created new session: ${agentSessionId}`);
    }

    updateStatus('Scanning DOM & Text PII...');
    await setupOffscreenDocument();
    await ensureContentScriptInjected(tabId);

    // Step 1: Scan Tier 1 & 2 PII bounding boxes from active content script
    const contentResponse = await chrome.tabs.sendMessage(tabId, { action: 'SCAN_PII' });
    let boundingBoxes = (contentResponse && contentResponse.boundingBoxes) || [];
    
    // Filter out boxes if the user disabled them
    if (!agentState.domRedactionEnabled) {
        boundingBoxes = boundingBoxes.filter(b => b.type !== 'DOM_PII');
    }
    if (!agentState.textRedactionEnabled) {
        boundingBoxes = boundingBoxes.filter(b => b.type !== 'TEXT_PII');
    }
    
    const domSnapshot = (contentResponse && contentResponse.dom_snapshot) || '';
    const viewportSize = (contentResponse && contentResponse.viewport) || { width: 1920, height: 1080 };
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
    
    const tab = await chrome.tabs.get(tabId);
    
    const requestPayload = {
        goal: agentState.userGoal,
        image: redactedImageWebp,
        dom_snapshot: domSnapshot,
        viewport_size: viewportSize,
        session_id: agentSessionId,
        current_url: tab.url,
        tab_info: { id: tabId }
    };

    // Log the outgoing request payload (omitting the huge base64 string, but keeping dom_snapshot for the popup to render)
    const debugPayload = { ...requestPayload, image: "<base64_image_data_omitted>" };
    
    // We send it as a raw object to the popup so it can format it
    addLog({ type: 'API_REQUEST', data: debugPayload });

    const response = await fetch(`${agentState.serverUrl}/api/v1/plan`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(requestPayload)
    });

    if (!response.ok) {
      throw new Error(`Server returned status ${response.status}`);
    }

    const planData = await response.json();
    const steps = planData.steps || [];
    
    // Log the incoming response steps as an object
    addLog({ type: 'API_RESPONSE', status: planData.status, steps: steps });

    if (steps.length === 0 || planData.status === 'completed') {
      agentState.isRunning = false;
      updateStatus('Goal Completed Successfully!');
      return;
    }

    // Step 5: Execute Macro Plan on tab
    updateStatus('Executing macro step plan...');
    try {
      await chrome.tabs.sendMessage(tabId, {
        action: 'EXECUTE_STEPS',
        payload: { steps: steps }
      });
    } catch (sendErr) {
      addLog('Connection lost during execution (likely page navigation). Waiting for reload...');
    }

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
    agentSessionId = null;
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
      agentSessionId = null;
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

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status === 'complete' && agentState.isRunning) {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (tabs.length > 0 && tabs[0].id === tabId) {
        addLog('Page navigated. Re-injecting scripts and resuming cycle...');
        // Small delay to let the page settle
        setTimeout(() => runAgentCycle(tabId), 1000);
      }
    });
  }
});
