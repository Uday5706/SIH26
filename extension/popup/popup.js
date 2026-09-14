/**
 * Popup Dashboard Controller (Flat 2D Professional Interface)
 * Connects UI interactions with the Service Worker state manager,
 * authentication, and Proof Snapshot viewer.
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

  // Authentication elements
  const btnGoogleLogin = document.getElementById('btnGoogleLogin');
  const btnGoogleLogout = document.getElementById('btnGoogleLogout');
  const authStatus = document.getElementById('authStatus');

  // Keep authentication and agent state separately.
  // This prevents one UI update from accidentally overriding the other.
  let isAuthenticated = false;
  let isAgentRunning = false;


  // ============================================================
  // Authentication UI
  // ============================================================

  function updateAuthUI(auth) {
    isAuthenticated = !!(
      auth &&
      auth.authenticated
    );

    if (isAuthenticated) {
      const email =
        auth.user?.email || 'Google user';

      authStatus.textContent =
        `Signed in: ${email}`;

      if (btnGoogleLogin) {
        btnGoogleLogin.style.display = 'none';
      }

      if (btnGoogleLogout) {
        btnGoogleLogout.style.display = 'block';
      }

    } else {

      authStatus.textContent =
        'Not signed in';

      if (btnGoogleLogin) {
        btnGoogleLogin.style.display = 'block';
      }

      if (btnGoogleLogout) {
        btnGoogleLogout.style.display = 'none';
      }
    }

    // Recalculate Start button state using
    // both authentication and agent state.
    setRunningState(isAgentRunning);
  }


  // ============================================================
  // Running State
  // ============================================================

  function setRunningState(isRunning) {

    isAgentRunning = !!isRunning;

    // Start requires authentication AND the agent must not
    // already be running.
    btnStart.disabled =
      isAgentRunning || !isAuthenticated;

    btnStop.disabled =
      !isAgentRunning;

    goalInput.disabled =
      isAgentRunning;

    statusDot.className =
      `status-dot ${
        isAgentRunning ? 'running' : 'idle'
      }`;
  }


  // ============================================================
  // Check Authentication When Popup Opens
  // ============================================================

  chrome.runtime.sendMessage(
    {
      action: 'GET_AUTH_STATUS'
    },
    (response) => {

      if (chrome.runtime.lastError) {
        console.error(
          'Auth status error:',
          chrome.runtime.lastError.message
        );

        updateAuthUI(null);
        return;
      }

      if (response?.success) {
        updateAuthUI(response.auth);
      } else {
        updateAuthUI(null);
      }
    }
  );


  // ============================================================
  // Google Login
  // ============================================================

  if (btnGoogleLogin) {

    btnGoogleLogin.addEventListener(
      'click',
      () => {

        authStatus.textContent =
          'Signing in...';

        btnGoogleLogin.disabled = true;

        chrome.runtime.sendMessage(
          {
            action: 'GOOGLE_LOGIN',
            payload: {
            serverUrl:
              serverUrlInput.value.trim() ||
              'http://127.0.0.1:8000'
            }
          },
          (response) => {

            btnGoogleLogin.disabled = false;

            if (chrome.runtime.lastError) {

              console.error(
                'Google login error:',
                chrome.runtime.lastError.message
              );

              authStatus.textContent =
                'Login failed. Please try again.';

              return;
            }

            if (response?.success) {

              updateAuthUI(
                response.auth
              );

            } else {

              authStatus.textContent =
                `Login failed: ${
                  response?.error ||
                  'Unknown error'
                }`;
            }
          }
        );
      }
    );
  }


  // ============================================================
  // Google Logout
  // ============================================================

  if (btnGoogleLogout) {

    btnGoogleLogout.addEventListener(
      'click',
      () => {

        btnGoogleLogout.disabled = true;

        chrome.runtime.sendMessage(
          {
            action: 'GOOGLE_LOGOUT'
          },
          (response) => {

            btnGoogleLogout.disabled = false;

            if (chrome.runtime.lastError) {

              console.error(
                'Google logout error:',
                chrome.runtime.lastError.message
              );

              authStatus.textContent =
                'Logout failed. Please try again.';

              return;
            }

            if (response?.success) {

              updateAuthUI({
                authenticated: false,
                user: null
              });

            } else {

              authStatus.textContent =
                `Logout failed: ${
                  response?.error ||
                  'Unknown error'
                }`;
            }
          }
        );
      }
    );
  }


  // ============================================================
  // Fetch Current Agent State on Popup Open
  // ============================================================

  chrome.runtime.sendMessage(
    {
      action: 'GET_AGENT_STATUS'
    },
    (response) => {

      if (chrome.runtime.lastError) {
        console.error(
          'Agent status error:',
          chrome.runtime.lastError.message
        );
        return;
      }

      if (response?.state) {
        updateUI(response.state);
      }
    }
  );


  // ============================================================
  // Handle Start
  // ============================================================

  btnStart.addEventListener(
    'click',
    () => {

      // --------------------------------------------------------
      // Client-side authentication check
      // --------------------------------------------------------
      chrome.runtime.sendMessage(
        {
          action: 'GET_AUTH_STATUS'
        },
        (authResponse) => {

          if (chrome.runtime.lastError) {

            console.error(
              'Auth check failed:',
              chrome.runtime.lastError.message
            );

            authStatus.textContent =
              'Unable to verify authentication.';

            return;
          }


          // ----------------------------------------------------
          // Block Start if user is not authenticated
          // ----------------------------------------------------

          if (
            !authResponse?.auth?.authenticated
          ) {

            isAuthenticated = false;

            authStatus.textContent =
              'Please sign in with Google first.';

            setRunningState(
              isAgentRunning
            );

            return;
          }


          // ----------------------------------------------------
          // Authentication successful
          // ----------------------------------------------------

          isAuthenticated = true;

          const goal =
            goalInput.value.trim() ||
            'Execute privacy-preserving workflow';

          const serverUrl =
            serverUrlInput.value.trim();


          // ----------------------------------------------------
          // Send START_AGENT to Service Worker
          // ----------------------------------------------------

          chrome.runtime.sendMessage(
            {
              action: 'START_AGENT',

              payload: {
                goal,
                serverUrl
              }
            },
            (response) => {

              if (chrome.runtime.lastError) {

                console.error(
                  'Start agent error:',
                  chrome.runtime.lastError.message
                );

                statusText.textContent =
                  'Failed to start agent.';

                return;
              }

              if (
                response &&
                response.state
              ) {

                updateUI(
                  response.state
                );
              }
            }
          );
        }
      );
    }
  );


  // ============================================================
  // Handle Stop
  // ============================================================

  btnStop.addEventListener(
    'click',
    () => {

      chrome.runtime.sendMessage(
        {
          action: 'STOP_AGENT'
        },
        (response) => {

          if (chrome.runtime.lastError) {

            console.error(
              'Stop agent error:',
              chrome.runtime.lastError.message
            );

            return;
          }

          if (
            response &&
            response.state
          ) {

            updateUI(
              response.state
            );
          }
        }
      );
    }
  );


  // ============================================================
  // Handle View Redacted Proof Snapshot
  // ============================================================

  btnProof.addEventListener(
    'click',
    () => {

      const serverUrl =
        serverUrlInput.value.trim() ||
        'http://127.0.0.1:8000';

      const proofUrl =
        `${serverUrl}/public/snapshots/latest_redacted_frame.png`;

      chrome.tabs.create({
        url: proofUrl
      });
    }
  );


  // ============================================================
  // Listen for Live Background Updates
  // ============================================================

  chrome.runtime.onMessage.addListener(
    (message) => {

      const {
        action,
        payload
      } = message;


      // --------------------------------------------------------
      // Agent Status Update
      // --------------------------------------------------------

      if (action === 'STATUS_UPDATE') {

        if (payload) {

          statusText.textContent =
            payload.status || 'Idle';

          setRunningState(
            payload.isRunning
          );
        }
      }


      // --------------------------------------------------------
      // Log Update
      // --------------------------------------------------------

      if (action === 'LOG_EVENT') {

        if (payload?.logs) {

          renderLogs(
            payload.logs
          );

        } else if (payload?.entry) {

          appendLog(
            payload.entry
          );
        }
      }
    }
  );


  // ============================================================
  // Update Entire Agent UI
  // ============================================================

  function updateUI(state) {

    statusText.textContent =
      state.status || 'Idle';

    goalInput.value =
      state.userGoal || '';

    serverUrlInput.value =
      state.serverUrl ||
      'http://127.0.0.1:8000';

    setRunningState(
      state.isRunning
    );

    if (state.logs) {

      renderLogs(
        state.logs
      );
    }
  }


  // ============================================================
  // Render Logs
  // ============================================================

  function renderLogs(logs) {

    logsContainer.innerHTML = '';

    logs.forEach((log) => {
      appendLog(log);
    });
  }


  // ============================================================
  // Append Single Log
  // ============================================================

  function appendLog(text) {

    const div =
      document.createElement('div');

    div.className =
      'log-entry';

    div.textContent =
      text;

    logsContainer.appendChild(
      div
    );

    logsContainer.scrollTop =
      logsContainer.scrollHeight;
  }

});