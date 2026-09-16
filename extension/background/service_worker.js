/**
 * Background Service Worker Orchestrator
 * Manages Offscreen document lifecycle, state transitions, tab capture,
 * backend API transmission, and macro execution loops.
 */

import { AgentController } from './agent_controller.js';
import { PrivacyGate } from './privacy_gate.js';

let agentState = {
  logs: [],
  status: 'Idle',
  isRunning: false
};

const OFFSCREEN_DOCUMENT_PATH = 'offscreen/offscreen.html';

async function setupOffscreenDocument() {
  if (await chrome.offscreen.hasDocument()) return;
  try {
    await chrome.offscreen.createDocument({
      url: chrome.runtime.getURL(OFFSCREEN_DOCUMENT_PATH),
      reasons: ['DOM_PARSER', 'BLOBS'],
      justification: 'Offscreen canvas processing'
    });
    await new Promise((r) => setTimeout(r, 100));
  } catch (err) {
    if (!err.message?.includes('Only a single offscreen document')) {
      console.warn('Offscreen creation error:', err);
    }
  }
}

// Pre-warm offscreen document on startup
setupOffscreenDocument().catch(() => {});

function addLog(msg) {
  const timestamp = new Date().toLocaleTimeString();
  const entry = `[${timestamp}] ${msg}`;
  agentState.logs.unshift(entry);
  if (agentState.logs.length > 50) agentState.logs.pop();

  chrome.runtime.sendMessage({
    action: 'LOG_EVENT',
    payload: { entry, logs: agentState.logs }
  }).catch(() => {});
}

function updateStatus(newStatus) {
  agentState.status = newStatus;
  
  // Keep isRunning synced so background events like DOM_MUTATION know if agent is active
  if (newStatus.toLowerCase().includes('error') || newStatus.toLowerCase().includes('failed') || newStatus.toLowerCase().includes('complete') || newStatus.toLowerCase().includes('cancelled')) {
    agentState.isRunning = false;
  }
  
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
          'privacy/token-vault.js',
          'privacy/policy.js',
          'privacy/fusion.js',
          'content/dom-observer.js',
          'content/page-extractor.js',
          'content/pii_dom_scanner.js',
          'content/pii_text_scanner.js',
          'agent/action-guard.js',
          'content/actions/executor.js',
          'content/actions/click.js',
          'content/actions/type.js',
          'content/actions/scroll.js',
          'content/actions/keypress.js',
          'content/actions/wait.js',
          'content/content_script.js'
        ]
      });
      await new Promise((r) => setTimeout(r, 150));
    } catch (e) {
      console.warn('Could not inject content scripts dynamically:', e);
    }
  }
}

// Instantiate the controller
const agentController = new AgentController(addLog, updateStatus, setupOffscreenDocument, ensureContentScriptInjected);

// Ensure global sidepanel doesn't open automatically and is disabled globally by default
chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: false }).catch(() => {});
chrome.sidePanel.setOptions({ enabled: false }).catch(() => {});

chrome.runtime.onInstalled.addListener(() => {
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: false }).catch(() => {});
  chrome.sidePanel.setOptions({ enabled: false }).catch(() => {});
});

chrome.action.onClicked.addListener((tab) => {
  if (!tab || !tab.id) return;
  
  // Enable the side panel specifically for the active tab with tabId query parameter
  chrome.sidePanel.setOptions({
    tabId: tab.id,
    path: `sidepanel.html?tabId=${tab.id}`,
    enabled: true
  });
  
  // Open it for this tab (must be called synchronously to keep user gesture)
  chrome.sidePanel.open({ windowId: tab.windowId, tabId: tab.id }).catch((err) => {
    console.warn('Error opening tab-specific side panel:', err);
  });
});

// Runtime Listener
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message) return;

  // Relay from sidepanel to content script if explicitly targeted
  if (message.target === "content" && sender.tab === undefined) {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      const tabId = tabs[0]?.id;
      if (tabId != null) {
        chrome.tabs.sendMessage(tabId, message).catch(() => {});
      }
    });
    return false;
  }

  const { action, payload } = message;

  if (action === 'START_AGENT') {
    agentState.isRunning = true;
    const goal = (payload && payload.goal) || 'Complete task';
    const serverUrl = (payload && payload.serverUrl) || 'http://127.0.0.1:8000';
    const targetTabId = payload && payload.tabId;
    
    if (targetTabId) {
      agentController.start(goal, targetTabId, serverUrl);
    } else {
      chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        if (tabs.length > 0) {
          agentController.start(goal, tabs[0].id, serverUrl);
        } else {
          updateStatus('Error: No active tab found.');
        }
      });
    }

    sendResponse({ success: true, state: agentController.state });
    return true;
  }

  if (action === 'STOP_AGENT') {
    agentController.stop();
    sendResponse({ success: true, state: agentController.state });
    return true;
  }

  if (action === 'GET_AGENT_STATUS') {
    sendResponse({ success: true, state: agentController.state });
    return true;
  }

  if (action === 'EXECUTION_FINISHED') {
    agentController.handleExecutionFinished(payload);
  }

  if (action === 'LOG_EVENT') {
    if (payload && payload.message) {
      addLog(payload.message);
    }
    return true;
  }

  if (action === 'DOM_MUTATION') {
    // Handle DOM mutations reported by dom-observer.js
    if (agentState.isRunning) {
      console.log('[ServiceWorker] Received DOM mutation:', payload);
      // We could trigger a new reasoning cycle here if needed
    }
    return true;
  }
});
