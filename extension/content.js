// On-page half of the agent UI.
// Backend/local executor can send RUN_ACTION / CONFIRM_ACTION / STOP_AGENT.

let agentExecutionStopped = false;

chrome.runtime.onMessage.addListener((message) => {
  if (!message) return;

  if (message.type === "STOP_AGENT") {
    agentExecutionStopped = true;
    showActionPopup({ message: "Sentra stopped the current task." });
    return;
  }

  if (message.type === "RUN_ACTION" || message.type === "CONFIRM_ACTION") {
    if (agentExecutionStopped && message.type === "RUN_ACTION") {
      return;
    }

    agentExecutionStopped = false;

    // Keep the current UI contract. The real action executor can replace
    // this branch with click / scroll / type / navigate logic.
    showActionPopup(message.action || { message: "Sentra applied an action." });
  }
});

function showActionPopup(action) {
  const existing = document.getElementById("__sentra_popup");
  if (existing) existing.remove();

  const popup = document.createElement("div");
  popup.id = "__sentra_popup";

  const dot = document.createElement("div");
  dot.className = "__sentra_dot";

  const text = document.createElement("div");
  text.className = "__sentra_text";
  text.textContent = action?.message || "Sentra applied an action.";

  const close = document.createElement("button");
  close.className = "__sentra_close";
  close.setAttribute("aria-label", "Dismiss");
  close.textContent = "×";

  popup.append(dot, text, close);
  document.documentElement.appendChild(popup);

  close.addEventListener("click", () => popup.remove());
  setTimeout(() => popup.remove(), 6000);
}
