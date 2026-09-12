/**
 * Agent Controller
 * Coordinates the browser-agent execution pipeline.
 */

// Mock provider since we don't have an LLM connected yet.
// For testing, we provide a hardcoded sequence.
const MOCK_ACTIONS = [
  {
    "action": "scroll",
    "direction": "down",
    "amount": 200
  },
  {
    "action": "click",
    "target": {
      "role": "textbox",
      "semantic_type": "SEARCH"
    }
  },
  {
    "action": "type",
    "target": {
      "role": "textbox",
      "semantic_type": "SEARCH"
    },
    "text": "compiler design"
  },
  {
    "action": "keypress",
    "key": "ENTER"
  },
  {
    "action": "wait",
    "duration": 1500
  }
];

class AgentController {
  constructor(addLog, updateStatus, getOffscreenCanvas, ensureContentScripts) {
    this.addLog = addLog;
    this.updateStatus = updateStatus;
    this.getOffscreenCanvas = getOffscreenCanvas;
    this.ensureContentScripts = ensureContentScripts;

    this.state = {
      taskId: null,
      goal: '',
      status: 'idle', // idle, running, observing, executing, waiting_for_user, completed, failed, cancelled
      currentStep: 0,
      iterationCount: 0,
      maxIterations: 10,
      error: null,
      serverUrl: 'http://127.0.0.1:8000',
      redactionBufferPx: 2,
      cvRedactionEnabled: true,
      tabId: null
    };
  }

  start(goal, tabId) {
    this.state.taskId = Date.now().toString();
    this.state.goal = goal || 'Complete task';
    this.state.tabId = tabId;
    this.state.status = 'running';
    this.state.currentStep = 0;
    this.state.iterationCount = 0;
    this.state.error = null;

    this.updateStatus(`Starting Agent Loop for goal: "${goal}"`);
    this.runIteration();
  }

  stop() {
    this.state.status = 'cancelled';
    this.updateStatus('Agent execution cancelled.');
    chrome.tabs.sendMessage(this.state.tabId, { action: 'STOP_EXECUTION' }).catch(() => {});
  }

  async runIteration() {
    if (this.state.status !== 'running' && this.state.status !== 'executing') {
      return;
    }

    if (this.state.iterationCount >= this.state.maxIterations) {
      this.state.status = 'failed';
      this.state.error = 'MAX_ITERATIONS_REACHED';
      this.updateStatus('Agent failed: Maximum iterations reached. Preventing infinite loop.');
      return;
    }

    this.state.iterationCount++;
    
    try {
      this.state.status = 'observing';
      this.updateStatus(`[Iter ${this.state.iterationCount}] Scanning DOM...`);
      await this.getOffscreenCanvas();
      await this.ensureContentScripts(this.state.tabId);

      // 1. Observe (Get Sanitized State)
      const contentResponse = await chrome.tabs.sendMessage(this.state.tabId, { action: 'SCAN_PII' });
      const boundingBoxes = (contentResponse && contentResponse.boundingBoxes) || [];
      const sanitizedDom = (contentResponse && contentResponse.sanitizedDom) || [];
      
      this.addLog(`Scanned ${boundingBoxes.length} PII target regions & built ${sanitizedDom.length} sanitized DOM elements.`);

      // (Optional Screenshot capturing logic is intentionally skipped here for the local Action execution focus, 
      // but we maintain the sanitized DOM observation flow)

      // 2. Request Action from Provider (Mock)
      this.updateStatus('Requesting next action from Mock Provider...');
      
      // Delay slightly to simulate network/thinking
      await new Promise(r => setTimeout(r, 800));

      let nextAction;
      if (this.state.currentStep < MOCK_ACTIONS.length) {
        nextAction = MOCK_ACTIONS[this.state.currentStep];
        this.state.currentStep++;
      } else {
         this.state.status = 'completed';
         this.updateStatus('Goal Completed Successfully! (No more mock actions)');
         return;
      }

      // 3. Dispatch to Action Executor
      this.state.status = 'executing';
      this.updateStatus(`Executing action: ${nextAction.action}`);

      // We send the single action as a 1-step array to the content script
      await chrome.tabs.sendMessage(this.state.tabId, {
        action: 'EXECUTE_STEPS',
        payload: { steps: [nextAction] }
      });

      // The content script will reply asynchronously via 'EXECUTION_FINISHED' runtime message.
      // So we wait until it's finished to continue the loop.

    } catch (err) {
      console.error('[AgentController] Error:', err);
      this.state.status = 'failed';
      this.state.error = err.message;
      this.updateStatus(`Error: ${err.message}`);
    }
  }

  handleExecutionFinished(result) {
    if (this.state.status !== 'executing') return;

    if (!result.success) {
      this.state.status = 'failed';
      this.state.error = result.error || 'Action failed locally';
      this.updateStatus(`Agent failed during execution: ${this.state.error}`);
    } else {
      this.state.status = 'running';
      this.updateStatus('Action execution succeeded. Evaluating next step...');
      // Start next iteration
      setTimeout(() => this.runIteration(), 500);
    }
  }
}

export { AgentController };
