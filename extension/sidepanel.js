const thread = document.getElementById("thread");
const input = document.getElementById("composerInput");
const sendBtn = document.getElementById("sendBtn");
const captureBtn = document.getElementById("captureBtn");
const closeBtn = document.getElementById("closeBtn");
const newTaskBtn = document.getElementById("newTaskBtn");
const sessionLabel = document.getElementById("sessionLabel");

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
let abortController = null;

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
  stageElement.classList.remove("hidden");
  stageElement.scrollIntoView({ behavior: "smooth", block: "nearest" });
}

function hideStage(stageElement) {
  if (!stageElement) return;
  stageElement.classList.add("hidden");
}

/*
  Reset means only Stage 1 is visible.
  Every following stage is revealed by the agent as it reaches that step.
*/
function resetStages() {
  for (const stage of stages) hideStage(stage);

  showStage(stageTask);

  taskValue.textContent = "Waiting for task…";
  statusValue.textContent = "Starting…";
  stepValue.textContent = "—";
  elapsedValue.textContent = "00:00.00";
  actionValue.textContent = "—";

  flowSubtitle.textContent = "Ready for a task";
  statusPill.className = "status-pill ready";
  statusPill.textContent = "READY";
  setProgress(0);

  stageConfirmation.classList.add("hidden");
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

/* -------------------------------------------------------------------------- */
/* Controls                                                                    */
/* -------------------------------------------------------------------------- */

closeBtn.addEventListener("click", () => window.close());

newTaskBtn.addEventListener("click", () => {
  resetAgent();
  thread.innerHTML = "";
  sessionLabel.textContent = "Privacy Browser Agent";
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
captureBtn.addEventListener("click", () => runCaptureCycle());

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

  addAgentText("Confirmation received — continuing.");
});

denyBtn.addEventListener("click", () => {
  pendingConfirmation = null;
  hideStage(stageConfirmation);
  stopCurrentTask("Cancelled by user");
});

/* -------------------------------------------------------------------------- */
/* Backend -> frontend contract                                               */
/* -------------------------------------------------------------------------- */

chrome.runtime.onMessage.addListener((message) => {
  if (!message) return;

  if (message.type === "AGENT_STATUS") {
    /*
      Backend can send these one at a time.
      We intentionally reveal the next UI stage only when its data arrives.
    */
    revealStatus(message.label || message.status || "Agent is working…");
    setAgentState(
      message.status || "running",
      message.label || "Agent is working…",
      ({
        running: "RUNNING",
        privacy: "PRIVACY",
        waiting: "WAITING",
        success: "DONE",
        error: "ERROR"
      })[message.status] || "RUNNING"
    );

    if (message.progress != null) setProgress(message.progress);

    if (message.step) revealStep(message.step);
    if (message.showElapsed !== false) revealElapsed();
    if (message.action) revealAction(message.action);
    if (message.confirmation) revealConfirmation(message.confirmation);
    return;
  }

  if (message.type === "AGENT_STEP") {
    revealStep(message.step || "Processing…");
    if (message.progress != null) setProgress(message.progress);
    return;
  }

  if (message.type === "AGENT_ACTION") {
    revealAction(message.action || "Executing browser action…");
    setAgentState("running", "Action in progress", "RUNNING");
    if (message.progress != null) setProgress(message.progress);
    return;
  }

  if (message.type === "AGENT_CONFIRM") {
    revealConfirmation(message.message);
    pendingConfirmation = message.action;
    setAgentState("waiting", "Waiting for your confirmation", "WAITING");
    setProgress(message.progress ?? 78);
    return;
  }

  if (message.type === "AGENT_DONE") {
    finishTask(message.message || "Task completed successfully.");
    return;
  }

  if (message.type === "AGENT_ERROR") {
    failTask(message.message || "The agent could not complete this task.");
    return;
  }
});

/* -------------------------------------------------------------------------- */
/* Task lifecycle                                                             */
/* -------------------------------------------------------------------------- */

function handleSend() {
  const text = input.value.trim();
  if (!text) return;

  addUserMessage(text);
  input.value = "";
  input.style.height = "auto";

  runCaptureCycle(text);
}

// Global runtime listener for service worker updates
chrome.runtime.onMessage.addListener((message) => {
  const { action, payload } = message;
  
  if (action === 'STATUS_UPDATE') {
    revealStatus(payload.status);
    if (payload.isRunning) {
        setAgentState("running", "Agent Active", "RUNNING");
        stopBtn.hidden = false;
        if (!timerId) startTimer();
    }
  }

  if (action === 'LOG_EVENT') {
    let logText = payload.entry || "Processing...";
    if (typeof logText === 'object') {
        if (logText.type === 'API_RESPONSE') {
            logText = `Server responded: ${logText.status}`;
        } else if (logText.type === 'API_REQUEST') {
            logText = "Sending anonymized state to server...";
        } else {
            logText = JSON.stringify(logText);
        }
    }
    
    // We only update the step text if it's a short string (not a huge JSON dump)
    if (logText.length < 100) {
        revealStep(logText);
        revealAction("Working...");
    }
  }
  
  if (action === 'EXECUTION_FINISHED') {
    if (payload && payload.finished) {
      finishTask("Goal Completed Successfully!");
    }
  }
});

function startTask(taskText) {
  activeTask = true;
  taskStartedAt = performance.now();
  pendingConfirmation = null;
  abortController = new AbortController();

  resetStages();

  // Stage 1: task appears first.
  taskValue.textContent = taskText || "Scan current page";
  sessionLabel.textContent = "Current task";

  setAgentState("running", "Task received", "RUNNING");
  stopBtn.hidden = false;

  // Small delay makes the sequential UI visible even with a fast backend.
  setProgress(8);
}

async function runCaptureCycle(taskText) {
  if (activeTask) {
    addAgentText("A task is already running. Stop it before starting another.");
    return;
  }

  startTask(taskText);
  revealStatus("Initializing Agent...");
  setProgress(20);
  
  chrome.runtime.sendMessage(
    {
      action: 'START_AGENT',
      payload: { goal: taskText, serverUrl: 'http://127.0.0.1:8000' }
    },
    (response) => {
      if (response && response.success) {
        revealStep("Agent loop started in background.");
        setProgress(40);
        startTimer();
      } else {
        failTask("Failed to start agent.");
      }
    }
  );
}

/* -------------------------------------------------------------------------- */
/* Completion / cancellation                                                  */
/* -------------------------------------------------------------------------- */

function finishTask(message) {
  stopTimer();
  activeTask = false;
  pendingConfirmation = null;
  stopBtn.hidden = true;

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
  stopBtn.hidden = true;

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
  stopBtn.hidden = true;

  if (abortController) {
    abortController.abort();
    abortController = null;
  }

  setAgentState("waiting", reason, "STOPPED");
  revealStep("Agent execution cancelled");
  revealAction("Stopped");
  setProgress(100);

  addAgentText("Task stopped. No further browser actions will be executed.");

  chrome.runtime.sendMessage({ action: 'STOP_AGENT' }).catch(() => {});

  if (typeof window.SentraAgent?.onStopRequested === "function") {
    window.SentraAgent.onStopRequested();
  }
}

stopBtn.addEventListener("click", () => stopCurrentTask());

function resetAgent() {
  stopTimer();
  activeTask = false;
  taskStartedAt = null;
  pendingConfirmation = null;
  abortController = null;
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
/* Existing trace / chat UI                                                   */
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
  trace.className = "trace";

  const head = document.createElement("div");
  head.className = "trace-head";
  head.innerHTML = `
    <svg class="chev" width="12" height="12" viewBox="0 0 24 24" fill="none">
      <path d="M9 6l6 6-6 6" stroke="currentColor" stroke-width="2"
            stroke-linecap="round" stroke-linejoin="round"/>
    </svg>
    <span>Agent trace • ${durationLabel}</span>
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

/* -------------------------------------------------------------------------- */
/* Frontend seams for backend/local model integration                         */
/* -------------------------------------------------------------------------- */


function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
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

/* Optional integration namespace for the backend developer. */
window.SentraAgent = {
  revealStatus,
  revealStep,
  revealElapsed,
  revealAction,
  revealConfirmation,
  setAgentState,
  setProgress,
  finishTask,
  failTask,
  onStopRequested: null
};

resetAgent();
