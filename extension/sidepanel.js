/**
 * Sentra Privacy Browser Agent — Sidepanel Controller
 * Integrated directly with the 3-Tier Local Redaction Engine and FastAPI VLM Server.
 */

const thread = document.getElementById("thread");
const input = document.getElementById("composerInput");
const sendBtn = document.getElementById("sendBtn");
const captureBtn = document.getElementById("captureBtn");
const profileBtn = document.getElementById("profileBtn");
const newTaskBtn = document.getElementById("newTaskBtn");
const sessionLabel = document.getElementById("sessionLabel");


const agentFlow = document.getElementById("agentFlow");
const welcomeBox = document.getElementById("welcomeBox");

const flowSubtitle = document.getElementById("flowSubtitle");
const statusPill = document.getElementById("statusPill");
const progressBar = document.getElementById("progressBar");

const stageTask = document.getElementById("stageTask");
const stageStatus = document.getElementById("stageStatus");
const stageStep = document.getElementById("stageStep");
const stageElapsed = document.getElementById("stageElapsed");
const stageAction = document.getElementById("stageAction");
const stageConfirmation = document.getElementById("stageConfirmation");

const taskValue = document.getElementById("taskValue");
const statusValue = document.getElementById("statusValue");
const stepValue = document.getElementById("stepValue");
const elapsedValue = document.getElementById("elapsedValue");
const actionValue = document.getElementById("actionValue");

const confirmationText = document.getElementById("confirmationText");
const confirmBtn = document.getElementById("confirmBtn");
const denyBtn = document.getElementById("denyBtn");
const stopBtn = document.getElementById("stopBtn");

let timerId = null;
let taskStartedAt = null;
let activeTask = false;
let pendingConfirmation = null;
let currentServerUrl = "http://127.0.0.1:8000";
const urlParams = new URLSearchParams(window.location.search);
const queryTabId = urlParams.get("tabId") ? parseInt(urlParams.get("tabId"), 10) : null;
let boundTabId = queryTabId;

function updateHeaderForTab(tab) {
  if (!tab) return;
  if (tab.url && !tab.url.startsWith("chrome") && !tab.url.startsWith("edge") && !tab.url.startsWith("about")) {
    try {
      const urlObj = new URL(tab.url);
      sessionLabel.textContent = urlObj.hostname || tab.title || "Active Tab";
    } catch {
      sessionLabel.textContent = tab.title || "Active Tab";
    }
  } else {
    sessionLabel.textContent = tab.title || "Active Tab";
  }
}

async function getValidTargetTab() {
  // 1. ALWAYS query the currently active tab first to prevent getting stuck on old tabs
  try {
    const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    const normalTab = tabs.find(t => t && t.url && !t.url.startsWith("chrome-extension://") && !t.url.startsWith("chrome://"));
    if (normalTab) {
      boundTabId = normalTab.id; // forcefully update boundTabId
      return normalTab;
    }
  } catch (e) {}

  // 2. If bound to a query tabId, check if it's still alive
  if (boundTabId) {
    try {
      const tab = await chrome.tabs.get(boundTabId);
      if (tab && tab.url && !tab.url.startsWith("chrome-extension://") && !tab.url.startsWith("chrome://")) {
        return tab;
      }
    } catch (e) {
      boundTabId = null;
    }
  }

  // 3. Fallback: Query all active tabs across windows
  try {
    const allTabs = await chrome.tabs.query({ active: true });
    const normalTab = allTabs.find(t => t.url && !t.url.startsWith("chrome-extension://") && !t.url.startsWith("chrome://"));
    if (normalTab) return normalTab;
  } catch (e) {}

  return null;
}

async function initBoundTab() {
  const tab = await getValidTargetTab();
  if (tab && tab.id) {
    boundTabId = tab.id;
    updateHeaderForTab(tab);
  }
}
initBoundTab();

chrome.tabs.onActivated.addListener(async (activeInfo) => {
  try {
    const tab = await chrome.tabs.get(activeInfo.tabId);
    // Ignore viewer.html or internal extension tabs so we don't accidentally switch focus to the audit viewer
    if (tab && tab.url && !tab.url.startsWith("chrome-extension://") && !tab.url.startsWith("chrome://")) {
      boundTabId = tab.id;
      updateHeaderForTab(tab);
    }
  } catch {}
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (tab && tab.active && tab.url && !tab.url.startsWith("chrome-extension://") && !tab.url.startsWith("chrome://")) {
    boundTabId = tab.id;
    updateHeaderForTab(tab);
  }
});

/* -------------------------------------------------------------------------- */
/* Sequential stage controller                                                */
/* -------------------------------------------------------------------------- */

const stages = [
  stageTask,
  stageStatus,
  stageStep,
  stageElapsed,
  stageAction,
  stageConfirmation
];

function showStage(stageElement) {
  if (!stageElement) return;
  ensureFlowVisible();
  stageElement.classList.remove("hidden");
  stageElement.scrollIntoView({ behavior: "smooth", block: "nearest" });
}

function hideStage(stageElement) {
  if (!stageElement) return;
  stageElement.classList.add("hidden");
}

function ensureFlowVisible() {
  if (agentFlow) {
    agentFlow.classList.remove("hidden");
    agentFlow.hidden = false;
    agentFlow.style.display = "block";
  }
  if (welcomeBox) {
    welcomeBox.style.display = "none";
  }
}

function resetStages() {
  for (const stage of stages) hideStage(stage);

  if (agentFlow) {
    agentFlow.classList.add("hidden");
    agentFlow.hidden = true;
    agentFlow.style.display = "none";
  }

  if (welcomeBox) {
    welcomeBox.style.display = "flex";
  }

  taskValue.textContent = "Waiting for task…";
  statusValue.textContent = "Ready";
  stepValue.textContent = "—";
  elapsedValue.textContent = "00:00.00";
  actionValue.textContent = "—";

  flowSubtitle.textContent = "Ready for a task";
  statusPill.className = "status-pill ready";
  statusPill.textContent = "READY";
  setProgress(0);

  stageConfirmation.classList.add("hidden");
  
  if (stopBtn) {
    stopBtn.hidden = true;
    stopBtn.classList.add("hidden");
    stopBtn.style.display = "none";
  }
}

function revealStatus(statusText) {
  showStage(stageStatus);
  statusValue.textContent = statusText || "Agent is working…";
}

function revealStep(stepText) {
  showStage(stageStep);
  stepValue.textContent = stepText || "Processing…";
}

function revealElapsed() {
  showStage(stageElapsed);
  startTimer();
}

function revealAction(actionText) {
  showStage(stageAction);
  actionValue.textContent = actionText || "Executing action…";
}

function revealConfirmation(message) {
  showStage(stageConfirmation);
  confirmationText.textContent =
    message || "The agent needs your confirmation before continuing.";
}

function setAgentState(state, subtitle, pillText) {
  flowSubtitle.textContent = subtitle || "Agent is working…";
  statusPill.className = `status-pill ${state}`;
  statusPill.textContent = pillText || "RUNNING";
}

function setProgress(value) {
  const safe = Math.max(0, Math.min(100, Number(value) || 0));
  progressBar.style.width = `${safe}%`;
}

if (profileBtn) {
  profileBtn.addEventListener("click", () => {
    // Future: handle profile/account menu
  });
}



// Bind suggestion chips
document.querySelectorAll(".suggestion-chip").forEach((chip) => {
  chip.addEventListener("click", () => {
    const prompt = chip.getAttribute("data-prompt") || chip.textContent.trim();
    handleSend(prompt);
  });
});

newTaskBtn.addEventListener("click", () => {
  resetAgent();
  thread.innerHTML = "";
  if (welcomeBox) {
    thread.appendChild(welcomeBox);
    welcomeBox.style.display = "flex";
  }
  sessionLabel.textContent = "Privacy Browser Agent";
  initBoundTab();
  input.focus();
});

input.addEventListener("input", () => {
  input.style.height = "auto";
  input.style.height = Math.min(input.scrollHeight, 90) + "px";
});

input.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.shiftKey) {
    e.preventDefault();
    handleSend();
  }
});

sendBtn.addEventListener("click", handleSend);
if (captureBtn) {
  captureBtn.addEventListener("click", () => {
    handleSend("Scan page and fill form securely");
  });
}

confirmBtn.addEventListener("click", () => {
  if (!pendingConfirmation) return;

  const action = pendingConfirmation;
  pendingConfirmation = null;
  hideStage(stageConfirmation);

  revealAction("Executing confirmed action…");
  setAgentState("running", "Confirmation received", "RUNNING");
  setProgress(90);

  chrome.runtime.sendMessage({
    target: "content",
    type: "CONFIRM_ACTION",
    action
  }).catch(() => {});

  addAgentText("Confirmation received — executing action.");
});

denyBtn.addEventListener("click", () => {
  pendingConfirmation = null;
  hideStage(stageConfirmation);
  stopCurrentTask("Action cancelled by user");
});

stopBtn.addEventListener("click", () => stopCurrentTask("Stopped by user"));

/* -------------------------------------------------------------------------- */
/* Backend -> Sidepanel Message Router                                        */
/* -------------------------------------------------------------------------- */

chrome.runtime.onMessage.addListener((message) => {
  if (!message) return;

  if (message.type === "AGENT_STATUS") {
    ensureFlowVisible();
    revealStatus(message.label || "Agent is working…");
    revealElapsed();
    
    if (message.step) revealStep(message.step);
    if (message.action) revealAction(message.action);
    if (message.progress != null) setProgress(message.progress);

    const stateKey = message.status || "running";
    setAgentState(
      stateKey,
      message.label || "Agent is working…",
      ({
        running: "RUNNING",
        privacy: "PRIVACY",
        waiting: "WAITING",
        success: "DONE",
        error: "ERROR"
      })[stateKey] || "RUNNING"
    );

    if (message.confirmation) {
      revealConfirmation(message.confirmation);
    }
    return;
  }

  if (message.type === "AGENT_TRACE") {
    if (message.steps) {
      addTraceCard(message.steps, formatDuration(taskStartedAt));
    }
    return;
  }

  if (message.type === "AGENT_STEP") {
    ensureFlowVisible();
    revealStep(message.step || "Processing…");
    if (message.progress != null) setProgress(message.progress);
    return;
  }

  if (message.type === "AGENT_ACTION") {
    ensureFlowVisible();
    revealAction(message.action || "Executing browser action…");
    setAgentState("running", "Action in progress", "RUNNING");
    if (message.progress != null) setProgress(message.progress);
    return;
  }

  if (message.type === "AGENT_CONFIRM") {
    ensureFlowVisible();
    revealConfirmation(message.message);
    pendingConfirmation = message.action;
    setAgentState("waiting", "Waiting for your confirmation", "WAITING");
    setProgress(message.progress ?? 78);
    return;
  }

  if (message.type === "AGENT_DONE") {
    finishTask(message.message || "Task completed successfully on the page.");
    return;
  }

  if (message.type === "AGENT_ERROR") {
    failTask(message.message || "The agent could not complete this task.");
    return;
  }

  if (message.type === "DRY_RUN_PAYLOAD") {
    ensureFlowVisible();
    const stageDryRun = document.getElementById("stageDryRun");
    const dryRunPayloadElem = document.getElementById("dryRunPayload");
    if (stageDryRun && dryRunPayloadElem) {
      showStage(stageDryRun);
      dryRunPayloadElem.textContent = JSON.stringify(message.payload, null, 2);
    }
    return;
  }
});

/* -------------------------------------------------------------------------- */
/* Task Lifecycle                                                             */
/* -------------------------------------------------------------------------- */

function handleSend(customText) {
  const text = (customText || input.value).trim();
  if (!text) return;

  addUserMessage(text);
  input.value = "";
  input.style.height = "auto";

  runAgentTask(text);
}

function startTask(taskText) {
  activeTask = true;
  taskStartedAt = performance.now();
  pendingConfirmation = null;

  resetStages();
  ensureFlowVisible();
  showStage(stageTask);

  // Stage 1: Task text
  taskValue.textContent = taskText || "Execute privacy-preserving workflow";
  sessionLabel.textContent = "Current task";

  setAgentState("running", "Task initiated", "RUNNING");
  if (stopBtn) {
    stopBtn.hidden = false;
    stopBtn.classList.remove("hidden");
    stopBtn.style.display = "flex";
  }
  setProgress(10);
}

async function runAgentTask(taskText) {
  if (activeTask) {
    addAgentText("A task is already running. Click STOP before starting a new task.");
    return;
  }

  const validTab = await getValidTargetTab();
  if (validTab && validTab.id) {
    boundTabId = validTab.id;
    updateHeaderForTab(validTab);
  } else if (!boundTabId) {
    addAgentText("Please switch to a webpage tab to run the privacy agent.");
    return;
  }

  startTask(taskText);

  // Send start command to Background Service Worker restricted to current tab
  chrome.runtime.sendMessage({
    action: "START_AGENT",
    payload: {
      goal: taskText,
      serverUrl: currentServerUrl,
      tabId: boundTabId
    }
  }, (response) => {
    if (chrome.runtime.lastError) {
      console.warn("Could not reach background service worker directly:", chrome.runtime.lastError.message);
    }
  });
}

function finishTask(message) {
  stopTimer();
  activeTask = false;
  pendingConfirmation = null;
  if (stopBtn) {
    stopBtn.hidden = true;
    stopBtn.classList.add("hidden");
    stopBtn.style.display = "none";
  }

  setAgentState("success", "Task completed", "DONE");
  revealAction("Completed");
  revealStep("Finished");
  setProgress(100);

  addAgentText(message);
}

function failTask(message) {
  stopTimer();
  activeTask = false;
  pendingConfirmation = null;
  if (stopBtn) {
    stopBtn.hidden = true;
    stopBtn.classList.add("hidden");
    stopBtn.style.display = "none";
  }

  setAgentState("error", "Agent stopped with an error", "ERROR");
  revealStep("Needs attention");
  revealAction("Not completed");
  setProgress(100);

  addAgentText(message);
}

function stopCurrentTask(reason = "Stopped by user") {
  if (!activeTask) return;

  stopTimer();
  activeTask = false;
  pendingConfirmation = null;
  if (stopBtn) {
    stopBtn.hidden = true;
    stopBtn.classList.add("hidden");
    stopBtn.style.display = "none";
  }

  setAgentState("waiting", reason, "STOPPED");
  revealStep("Agent execution cancelled");
  revealAction("Stopped");
  setProgress(100);

  addAgentText("Task stopped. No further browser actions will be executed.");

  chrome.runtime.sendMessage({
    action: "STOP_AGENT"
  }).catch(() => {});
}

function resetAgent() {
  stopTimer();
  activeTask = false;
  taskStartedAt = null;
  pendingConfirmation = null;
  stopBtn.hidden = true;
  resetStages();
}

/* -------------------------------------------------------------------------- */
/* Timer                                                                      */
/* -------------------------------------------------------------------------- */

function startTimer() {
  if (timerId) return;
  if (taskStartedAt == null) taskStartedAt = performance.now();

  updateElapsed();
  timerId = setInterval(updateElapsed, 47);
}

function stopTimer() {
  if (timerId) clearInterval(timerId);
  timerId = null;
}

function updateElapsed() {
  if (taskStartedAt == null) return;

  const elapsed = Math.max(0, performance.now() - taskStartedAt);
  const totalSeconds = elapsed / 1000;
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = Math.floor(totalSeconds % 60);
  const hundredths = Math.floor((elapsed % 1000) / 10);

  elapsedValue.textContent =
    `${String(minutes).padStart(2, "0")}:` +
    `${String(seconds).padStart(2, "0")}.` +
    `${String(hundredths).padStart(2, "0")}`;
}

/* -------------------------------------------------------------------------- */
/* Chat Thread & Trace Card Rendering                                        */
/* -------------------------------------------------------------------------- */

function addUserMessage(text) {
  const el = document.createElement("div");
  el.className = "msg msg-user";

  const bubble = document.createElement("div");
  bubble.className = "bubble";
  bubble.textContent = text;

  el.appendChild(bubble);
  thread.appendChild(el);
  scrollToBottom();
}

function addAgentText(text) {
  const el = document.createElement("div");
  el.className = "msg msg-agent";

  const bubble = document.createElement("div");
  bubble.className = "bubble";
  bubble.textContent = text;

  el.appendChild(bubble);
  thread.appendChild(el);
  scrollToBottom();
  return el;
}

function addTraceCard(steps, durationLabel) {
  const wrap = document.createElement("div");
  wrap.className = "msg msg-agent";

  const trace = document.createElement("div");
  trace.className = "trace open";

  const head = document.createElement("div");
  head.className = "trace-head";
  head.innerHTML = `
    <svg class="chev" width="12" height="12" viewBox="0 0 24 24" fill="none">
      <path d="M9 6l6 6-6 6" stroke="currentColor" stroke-width="2"
            stroke-linecap="round" stroke-linejoin="round"/>
    </svg>
    <span>🔒 Privacy Trace • ${durationLabel}</span>
  `;
  head.addEventListener("click", () => trace.classList.toggle("open"));

  const body = document.createElement("div");
  body.className = "trace-body";

  const icons = {
    scan: `<svg class="step-icon scan" viewBox="0 0 24 24" fill="none">
      <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7z"
            stroke="currentColor" stroke-width="1.8"/>
      <circle cx="12" cy="12" r="3" stroke="currentColor" stroke-width="1.8"/>
    </svg>`,
    redact: `<svg class="step-icon redact" viewBox="0 0 24 24" fill="none">
      <rect x="3" y="3" width="18" height="18" rx="3"
            stroke="currentColor" stroke-width="1.8"/>
      <path d="M7 12h10" stroke="currentColor" stroke-width="2.5"/>
    </svg>`,
    act: `<svg class="step-icon act" viewBox="0 0 24 24" fill="none">
      <path d="M13 2L4 14h6l-1 8 9-12h-6l1-8z"
            stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/>
    </svg>`
  };

  for (const s of steps) {
    const row = document.createElement("div");
    row.className = "step";

    const bodyEl = document.createElement("div");
    bodyEl.className = "step-body";

    const title = document.createElement("div");
    title.className = "step-title";
    title.textContent = s.title;
    bodyEl.appendChild(title);

    if (s.detail) {
      const detail = document.createElement("div");
      detail.className = "step-detail";
      detail.textContent = s.detail;
      bodyEl.appendChild(detail);
    }

    if (s.tags?.length) {
      const tagWrap = document.createElement("div");
      for (const t of s.tags) {
        const tag = document.createElement("span");
        tag.className = `tag ${t.type || ""}`;
        tag.textContent = t.label;
        tagWrap.appendChild(tag);
      }
      bodyEl.appendChild(tagWrap);
    }

    row.innerHTML = icons[s.kind] || icons.scan;
    row.appendChild(bodyEl);
    body.appendChild(row);
  }

  trace.appendChild(head);
  trace.appendChild(body);
  wrap.appendChild(trace);
  thread.appendChild(wrap);
  scrollToBottom();
  return trace;
}

function scrollToBottom() {
  thread.scrollTop = thread.scrollHeight;
}

function formatDuration(start) {
  if (typeof start !== "number") return "00:00.00";

  const elapsed = Math.max(0, performance.now() - start);
  const totalSeconds = elapsed / 1000;
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = Math.floor(totalSeconds % 60);
  const hundredths = Math.floor((elapsed % 1000) / 10);

  return `${String(minutes).padStart(2, "0")}:` +
         `${String(seconds).padStart(2, "0")}.` +
         `${String(hundredths).padStart(2, "0")}`;
}

resetAgent();

