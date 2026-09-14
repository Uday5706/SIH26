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
  const matchedClients = await clients.matchAll();
  for (const client of matchedClients) {
    if (client.url.endsWith(OFFSCREEN_DOCUMENT_PATH)) return;
  }
  try {
    await chrome.offscreen.createDocument({
      url: OFFSCREEN_DOCUMENT_PATH,
      reasons: [chrome.offscreen.Reason.DOM_PARSER || 'DOM_PARSER', chrome.offscreen.Reason.BLOBS || 'BLOBS'],
      justification: 'Offscreen canvas processing'
    });
  } catch (err) {
    if (!err.message.includes('Only a single offscreen document')) throw err;
  }
}

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
  addLog(`Status: ${newStatus}`);
  chrome.runtime.sendMessage({
    action: 'STATUS_UPDATE',
    payload: { status: agentState.status, isRunning: (agentState.status === 'running' || agentState.status === 'executing') }
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

// Side panel behavior & toolbar action
chrome.action.onClicked.addListener(async (tab) => {
  await chrome.sidePanel.open({ tabId: tab.id });
});

chrome.runtime.onInstalled.addListener(() => {
  chrome.sidePanel
    .setPanelBehavior({ openPanelOnActionClick: true })
    .catch(() => {});
});

// Runtime Listener
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message) return;

  // Relay between sidepanel and content script
  if (message.target === "content" && sender.tab === undefined) {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      const tabId = tabs[0]?.id;
      if (tabId != null) {
        chrome.tabs.sendMessage(tabId, message).catch(() => {});
      }
    });
    return false;
  }

  if (message.target === "panel") {
    chrome.runtime.sendMessage(message).catch(() => {});
    return false;
  }

  const { action, payload } = message;

  if (action === 'START_AGENT') {
    agentState.isRunning = true;
    const goal = payload.goal || 'Complete task';
    
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (tabs.length > 0) {
        agentController.start(goal, tabs[0].id);
      } else {
        updateStatus('Error: No active tab found.');
      }
    });

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
  }
});
