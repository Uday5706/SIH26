/**
 * Popup Dashboard Controller (Flat 2D Professional Interface)
 * Connects UI interactions with the Service Worker state manager and Proof Snapshot viewer.
 */

document.addEventListener('DOMContentLoaded', () => {
  const goalInput = document.getElementById('goalInput');
  const btnStart = document.getElementById('btnStart');
  const btnStop = document.getElementById('btnStop');
  const btnProof = document.getElementById('btnProof');
  const statusText = document.getElementById('statusText');
  const statusDot = document.getElementById('statusDot');
  const logsContainer = document.getElementById('logsContainer');
  const serverUrlInput = document.getElementById('serverUrl');

  // Fetch current state on open
  chrome.runtime.sendMessage({ action: 'GET_AGENT_STATUS' }, (response) => {
    if (response && response.state) {
      updateUI(response.state);
    }
  });

  // Handle Start
  btnStart.addEventListener('click', () => {
    const goal = goalInput.value.trim() || 'Execute privacy-preserving workflow';
    const serverUrl = serverUrlInput.value.trim();

    chrome.runtime.sendMessage(
      {
        action: 'START_AGENT',
        payload: { goal, serverUrl }
      },
      (response) => {
        if (response && response.state) {
          updateUI(response.state);
        }
      }
    );
  });

  // Handle Stop
  btnStop.addEventListener('click', () => {
    chrome.runtime.sendMessage({ action: 'STOP_AGENT' }, (response) => {
      if (response && response.state) {
        updateUI(response.state);
      }
    });
  });

  const btnAuditPayload = document.getElementById('btnAuditPayload');

  // Handle View Redacted Proof Snapshot Image
  btnProof.addEventListener('click', () => {
    const serverUrl = serverUrlInput.value.trim() || 'http://127.0.0.1:8000';
    const proofUrl = `${serverUrl}/public/snapshots/latest_redacted_frame.png`;
    chrome.tabs.create({ url: proofUrl });
  });

  // Handle View Transmitted Audit JSON Payload
  if (btnAuditPayload) {
    btnAuditPayload.addEventListener('click', () => {
      const serverUrl = serverUrlInput.value.trim() || 'http://127.0.0.1:8000';
      const auditUrl = `${serverUrl}/public/payload_audit.json`;
      chrome.tabs.create({ url: auditUrl });
    });
  }

  // Listen for live background updates
  chrome.runtime.onMessage.addListener((message) => {
    const { action, payload } = message;

    if (action === 'STATUS_UPDATE') {
      statusText.textContent = payload.status;
      setRunningState(payload.isRunning);
    }

    if (action === 'LOG_EVENT') {
      if (payload.logs) {
        renderLogs(payload.logs);
      } else if (payload.entry) {
        appendLog(payload.entry);
      }
    }
  });

  function updateUI(state) {
    statusText.textContent = state.status || 'Idle';
    goalInput.value = state.userGoal || '';
    serverUrlInput.value = state.serverUrl || 'http://127.0.0.1:8000';
    setRunningState(state.isRunning);
    if (state.logs) renderLogs(state.logs);
  }

  function setRunningState(isRunning) {
    btnStart.disabled = isRunning;
    btnStop.disabled = !isRunning;
    goalInput.disabled = isRunning;
    statusDot.className = `status-dot ${isRunning ? 'running' : 'idle'}`;
  }

  function renderLogs(logs) {
    logsContainer.innerHTML = '';
    logs.forEach((log) => appendLog(log));
  }

  function appendLog(text) {
    const div = document.createElement('div');
    div.className = 'log-entry';
    div.textContent = text;
    logsContainer.appendChild(div);
    logsContainer.scrollTop = logsContainer.scrollHeight;
  }
});
