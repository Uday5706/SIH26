/**
 * Background Service Worker Orchestrator
 * Manages Offscreen document lifecycle, state transitions, tab capture,
 * backend API transmission, authentication, and macro execution loops.
 */

import {
  loginWithGoogle,
  getAuthState,
  getIdToken,
  logout
} from './auth.js';

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


// ============================================================
// Offscreen Document Lifecycle Management
// ============================================================

async function setupOffscreenDocument() {
  if (await hasOffscreenDocument()) return;

  try {
    await chrome.offscreen.createDocument({
      url: OFFSCREEN_DOCUMENT_PATH,
      reasons: [
        chrome.offscreen.Reason.DOM_PARSER || 'DOM_PARSER',
        chrome.offscreen.Reason.BLOBS || 'BLOBS'
      ],
      justification:
        'Offscreen canvas processing for PII visual redaction and WebP encoding.'
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


// ============================================================
// Logging / Status
// ============================================================

function addLog(msg) {
  const timestamp = new Date().toLocaleTimeString();
  const entry = `[${timestamp}] ${msg}`;

  agentState.logs.unshift(entry);

  if (agentState.logs.length > 50) {
    agentState.logs.pop();
  }

  // Notify active popups
  chrome.runtime.sendMessage({
    action: 'LOG_EVENT',
    payload: {
      entry,
      logs: agentState.logs
    }
  }).catch(() => {});
}

function updateStatus(newStatus) {
  agentState.status = newStatus;

  addLog(`Status: ${newStatus}`);

  chrome.runtime.sendMessage({
    action: 'STATUS_UPDATE',
    payload: {
      status: agentState.status,
      isRunning: agentState.isRunning
    }
  }).catch(() => {});
}


// ============================================================
// Content Script Injection
// ============================================================

async function ensureContentScriptInjected(tabId) {
  try {
    await chrome.tabs.sendMessage(tabId, {
      action: 'PING'
    });
  } catch (err) {
    try {
      await chrome.scripting.executeScript({
        target: {
          tabId: tabId
        },
        files: [
          'content/pii_dom_scanner.js',
          'content/pii_text_scanner.js',
          'content/macro_executor.js',
          'content/content_script.js'
        ]
      });

      await new Promise((r) => setTimeout(r, 150));

    } catch (e) {
      console.warn(
        'Could not inject content scripts dynamically:',
        e
      );
    }
  }
}


// ============================================================
// Core Execution Cycle
// ============================================================

async function runAgentCycle(tabId) {

  // Agent should not run if it has been stopped.
  if (!agentState.isRunning) return;

  try {

    // --------------------------------------------------------
    // AUTHENTICATION CHECK
    // --------------------------------------------------------

    const auth = await getAuthState();

    if (!auth.authenticated) {
      agentState.isRunning = false;

      updateStatus('Please sign in with Google first.');

      return;
    }


    // --------------------------------------------------------
    // Step 0: Prepare offscreen document + content scripts
    // --------------------------------------------------------

    updateStatus('Scanning DOM & Text PII...');

    await setupOffscreenDocument();

    await ensureContentScriptInjected(tabId);


    // --------------------------------------------------------
    // Step 1: Scan Tier 1 & 2 PII bounding boxes
    // --------------------------------------------------------

    const contentResponse = await chrome.tabs.sendMessage(
      tabId,
      {
        action: 'SCAN_PII'
      }
    );

    const boundingBoxes =
      (contentResponse && contentResponse.boundingBoxes) || [];

    addLog(
      `Scanned ${boundingBoxes.length} PII target bounding boxes.`
    );


    // --------------------------------------------------------
    // Step 2: Capture screen state
    // --------------------------------------------------------

    updateStatus('Capturing screen state...');

    const rawDataUrl = await chrome.tabs.captureVisibleTab(
      null,
      {
        format: 'png'
      }
    );


    // --------------------------------------------------------
    // Step 3: Offscreen Canvas Obfuscation
    // --------------------------------------------------------

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

    if (
      !redactionResult ||
      !redactionResult.success
    ) {
      throw new Error(
        redactionResult?.error ||
        'Canvas redaction failed.'
      );
    }

    const {
      redactedImageWebp,
      redactedCount
    } = redactionResult.result;

    addLog(
      `Obfuscation complete. ${redactedCount} regions blacked out (+${agentState.redactionBufferPx}px buffer).`
    );


    // --------------------------------------------------------
    // Step 4: Get authentication token
    // --------------------------------------------------------

    updateStatus('Authenticating request...');

    const idToken = await getIdToken();

    if (!idToken) {
      agentState.isRunning = false;

      updateStatus('Authentication expired. Please sign in again.');

      return;
    }


    // --------------------------------------------------------
    // Step 5: Transmit anonymized payload to FastAPI server
    // --------------------------------------------------------

    updateStatus(
      'Sending anonymized state to VLM server...'
    );

    const response = await fetch(
      `${agentState.serverUrl}/api/v1/plan`,
      {
        method: 'POST',

        headers: {
          'Content-Type': 'application/json',

          // Send Google ID token to FastAPI
          'Authorization': `Bearer ${idToken}`
        },

        body: JSON.stringify({
          goal: agentState.userGoal,

          image: redactedImageWebp,

          tab_info: {
            id: tabId
          }
        })
      }
    );


    // --------------------------------------------------------
    // Handle server errors
    // --------------------------------------------------------

    if (!response.ok) {

      // Token may have expired / become invalid
      if (
        response.status === 401 ||
        response.status === 403
      ) {
        agentState.isRunning = false;

        updateStatus(
          'Authentication failed. Please sign in again.'
        );

        return;
      }

      throw new Error(
        `Server returned status ${response.status}`
      );
    }


    // --------------------------------------------------------
    // Parse VLM response
    // --------------------------------------------------------

    const planData = await response.json();

    const steps = planData.steps || [];

    addLog(
      `VLM returned plan with ${steps.length} steps.`
    );


    // --------------------------------------------------------
    // Goal completed
    // --------------------------------------------------------

    if (
      steps.length === 0 ||
      planData.status === 'completed'
    ) {
      agentState.isRunning = false;

      updateStatus(
        'Goal Completed Successfully!'
      );

      return;
    }


    // --------------------------------------------------------
    // Step 6: Execute Macro Plan on tab
    // --------------------------------------------------------

    updateStatus(
      'Executing macro step plan...'
    );

    await chrome.tabs.sendMessage(
      tabId,
      {
        action: 'EXECUTE_STEPS',

        payload: {
          steps: steps
        }
      }
    );

  } catch (err) {

    console.error(
      'Agent cycle error:',
      err
    );

    agentState.isRunning = false;

    updateStatus(
      `Error: ${err.message}`
    );
  }
}


// ============================================================
// Runtime Message Listener
// ============================================================

chrome.runtime.onMessage.addListener(
  (message, sender, sendResponse) => {

    const {
      action,
      payload
    } = message;


    // ========================================================
    // GOOGLE LOGIN
    // ========================================================

    if (action === 'GOOGLE_LOGIN') {

     
  loginWithGoogle(agentState.serverUrl)
    .then((auth) => {

      updateStatus(
        `Signed in as ${auth.user.email}`
      );

      sendResponse({
        success: true,
        auth: {
          authenticated: true,
          user: auth.user
        }
      });

    })
    .catch((err) => {

      console.error(
        'Google login failed:',
        err
      );

      sendResponse({
        success: false,
        error: err.message
      });

    });

  return true;
    }


    // ========================================================
    // GET AUTHENTICATION STATUS
    // ========================================================

    if (action === 'GET_AUTH_STATUS') {

      getAuthState()
        .then((auth) => {

          sendResponse({
            success: true,

            auth: {
              authenticated: auth.authenticated,
              user: auth.user
            }
          });

        })
        .catch((err) => {

          sendResponse({
            success: false,
            error: err.message
          });

        });

      return true;
    }


    // ========================================================
    // GOOGLE LOGOUT
    // ========================================================

    if (action === 'GOOGLE_LOGOUT') {

      logout()
        .then(() => {

          // Stop agent immediately after logout
          agentState.isRunning = false;

          updateStatus('Signed out.');

          sendResponse({
            success: true
          });

        })
        .catch((err) => {

          sendResponse({
            success: false,
            error: err.message
          });

        });

      return true;
    }


    // ========================================================
    // START AGENT
    // ========================================================

    if (action === 'START_AGENT') {

      agentState.isRunning = true;

      agentState.userGoal =
        payload.goal || 'Complete task';

      agentState.serverUrl =
        payload.serverUrl ||
        agentState.serverUrl;

      updateStatus(
        'Starting Agent Loop...'
      );


      chrome.tabs.query(
        {
          active: true,
          currentWindow: true
        },

        (tabs) => {

          if (tabs.length > 0) {

            runAgentCycle(
              tabs[0].id
            );

          } else {

            agentState.isRunning = false;

            updateStatus(
              'Error: No active tab found.'
            );
          }
        }
      );


      sendResponse({
        success: true,
        state: agentState
      });

      return true;
    }


    // ========================================================
    // STOP AGENT
    // ========================================================

    if (action === 'STOP_AGENT') {

      agentState.isRunning = false;

      updateStatus(
        'Agent Stopped by User.'
      );


      chrome.tabs.query(
        {
          active: true,
          currentWindow: true
        },

        (tabs) => {

          if (tabs.length > 0) {

            chrome.tabs.sendMessage(
              tabs[0].id,
              {
                action: 'STOP_EXECUTION'
              }
            ).catch(() => {});

          }
        }
      );


      sendResponse({
        success: true,
        state: agentState
      });

      return true;
    }


    // ========================================================
    // GET AGENT STATUS
    // ========================================================

    if (action === 'GET_AGENT_STATUS') {

      sendResponse({
        success: true,
        state: agentState
      });

      return true;
    }


    // ========================================================
    // EXECUTION FINISHED
    // ========================================================

    if (action === 'EXECUTION_FINISHED') {

      if (
        payload &&
        payload.finished
      ) {

        agentState.isRunning = false;

        updateStatus(
          'Task execution finished!'
        );

      } else if (
        agentState.isRunning
      ) {

        // Re-trigger cycle for dynamic page updates

        chrome.tabs.query(
          {
            active: true,
            currentWindow: true
          },

          (tabs) => {

            if (tabs.length > 0) {

              runAgentCycle(
                tabs[0].id
              );
            }
          }
        );
      }
    }


    // ========================================================
    // LOG EVENT
    // ========================================================

    if (action === 'LOG_EVENT') {

      if (
        payload &&
        payload.message
      ) {

        addLog(
          payload.message
        );
      }
    }
  }
);