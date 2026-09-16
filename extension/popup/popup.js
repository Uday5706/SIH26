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

  // Handle View Redacted Proof Snapshot Image
  btnProof.addEventListener('click', () => {
    const serverUrl = serverUrlInput.value.trim() || 'http://127.0.0.1:8000';
    const proofUrl = `${serverUrl}/public/snapshots/latest_redacted_frame.png`;
    chrome.tabs.create({ url: proofUrl });
  });

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

  function appendLog(logData) {
    const div = document.createElement('div');
    div.className = 'log-entry';

    if (typeof logData === 'string') {
      // It's a standard string log
      div.textContent = logData;
    } else if (typeof logData === 'object') {
      // It's a structured API log
      if (logData.type === 'API_REQUEST') {
        const payload = logData.data;
        const domSnap = payload.dom_snapshot;
        // Omit it from the stringify
        const displayObj = { ...payload, dom_snapshot: "<DOM hidden in UI>" };
        
        let htmlStr = `<strong>[API Request] POST /plan</strong>\n`;
        htmlStr += JSON.stringify(displayObj, null, 2);
        
        if (domSnap) {
          // Escape HTML for safe insertion
          const safeDom = domSnap.replace(/</g, '&lt;').replace(/>/g, '&gt;');
          htmlStr += `\n<details style="margin-top:4px; padding:4px; background:#1e293b; border-radius:4px;">
            <summary style="cursor:pointer; color:#38bdf8; font-weight:bold;">View DOM Snapshot</summary>
            <div style="max-height:200px; overflow-y:auto; margin-top:4px; color:#94a3b8; font-size:0.65rem;">
              ${safeDom}
            </div>
          </details>`;
        }
        div.innerHTML = htmlStr;
      } else if (logData.type === 'API_RESPONSE') {
        const htmlStr = `<strong>[API Response] Status: ${logData.status}</strong>\n` + JSON.stringify(logData.steps, null, 2);
        div.innerHTML = htmlStr;
      } else {
        div.textContent = JSON.stringify(logData, null, 2);
      }
    }

    logsContainer.appendChild(div);
    logsContainer.scrollTop = logsContainer.scrollHeight;
  }
});
