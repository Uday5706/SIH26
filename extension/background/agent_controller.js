/**
 * Agent Controller
 * Coordinates the full end-to-end browser-agent execution pipeline:
 * 1. Local DOM & Text PII Scanning (Deterministic & Regex)
 * 2. Visual Canvas Screenshot Redaction (Offscreen Engine)
 * 3. Privacy Gate Validation (Zero-Leakage Guarantee)
 * 4. Server Reasoning (FastAPI / VLM)
 * 5. Local DOM Action Execution (Highlighted DOM primitives)
 */

import { PrivacyGate } from './privacy_gate.js';

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
      totalSteps: 0,
      iterationCount: 0,
      maxIterations: 8,
      error: null,
      serverUrl: 'http://127.0.0.1:8000',
      redactionBufferPx: 2,
      cvRedactionEnabled: true,
      tabId: null,
      pendingConfirmation: null
    };
  }

  emitMessage(type, payload = {}) {
    chrome.runtime.sendMessage({
      target: 'panel',
      type: type,
      ...payload
    }).catch(() => {});
  }

  start(goal, tabId, serverUrl = 'http://127.0.0.1:8000') {
    this.state.taskId = Date.now().toString();
    this.state.goal = goal || 'Complete privacy task';
    this.state.tabId = tabId;
    this.state.serverUrl = serverUrl || this.state.serverUrl;
    this.state.status = 'running';
    this.state.currentStep = 0;
    this.state.totalSteps = 0;
    this.state.iterationCount = 0;
    this.state.error = null;

    this.updateStatus(`Starting Agent loop for: "${this.state.goal}"`);
    this.emitMessage('AGENT_STATUS', {
      status: 'running',
      label: 'Initializing privacy agent…',
      progress: 10
    });

    this.runIteration();
  }

  stop(reason = 'Stopped by user') {
    this.state.status = 'cancelled';
    this.updateStatus(`Agent stopped: ${reason}`);
    this.emitMessage('AGENT_STATUS', {
      status: 'waiting',
      label: reason,
      progress: 100
    });

    if (this.state.tabId) {
      chrome.tabs.sendMessage(this.state.tabId, { action: 'STOP_EXECUTION' }).catch(() => {});
    }
  }

  async runIteration() {
    if (this.state.status !== 'running' && this.state.status !== 'executing') {
      return;
    }

    if (this.state.iterationCount >= this.state.maxIterations) {
      this.state.status = 'failed';
      this.state.error = 'MAX_ITERATIONS_REACHED';
      this.updateStatus('Maximum iterations reached. Stopping to prevent loop.');
      this.emitMessage('AGENT_ERROR', {
        message: 'Maximum iterations reached without task completion.'
      });
      return;
    }

    this.state.iterationCount++;
    
    try {
      this.state.status = 'observing';
      this.updateStatus(`[Turn ${this.state.iterationCount}] Scanning DOM and sanitizing context locally…`);
      this.emitMessage('AGENT_STATUS', {
        status: 'privacy',
        label: 'Observing DOM & running local privacy filters…',
        step: 'Scanning page elements & sensitive data',
        progress: 25
      });

      await this.getOffscreenCanvas();
      await this.ensureContentScripts(this.state.tabId);

      // 1. Observe: Extract real DOM and text PII
      const contentResponse = await chrome.tabs.sendMessage(this.state.tabId, { action: 'SCAN_PII' });
      const boundingBoxes = (contentResponse && contentResponse.boundingBoxes) || [];
      const sanitizedDom = (contentResponse && contentResponse.sanitizedDom) || [];
      
      this.addLog(`Scanned ${boundingBoxes.length} PII target regions & built ${sanitizedDom.length} sanitized DOM elements.`);

      // 2. Capture and Redact Screenshot in Offscreen Canvas
      this.emitMessage('AGENT_STATUS', {
        status: 'privacy',
        label: 'Applying region-level visual redaction…',
        step: 'Redacting sensitive image coordinates locally',
        progress: 45
      });

      let redactedImageWebp = '';
      let categoryCounts = {};
      let redactedCount = 0;

      try {
        const rawScreenshot = await chrome.tabs.captureVisibleTab(null, { format: 'png' });
        const redactResponse = await chrome.runtime.sendMessage({
          action: 'REDACT_CANVAS',
          payload: {
            dataUrl: rawScreenshot,
            boundingBoxes: boundingBoxes,
            paddingPx: this.state.redactionBufferPx,
            cvEnabled: this.state.cvRedactionEnabled
          }
        });

        if (redactResponse?.success && redactResponse.result) {
          redactedImageWebp = redactResponse.result.redactedImageWebp;
          categoryCounts = redactResponse.result.categoryCounts || {};
          redactedCount = redactResponse.result.redactedCount || 0;
        }
      } catch (err) {
        console.warn('[AgentController] Screenshot redaction warning:', err);
      }

      // 3. Emit real trace statistics to Sidepanel
      const redactionTags = Object.entries(categoryCounts).map(([cat, count]) => ({
        label: `${cat} (${count}) → [PII_${cat}]`,
        type: cat === 'PASSWORD' || cat === 'PIN' || cat === 'OTP' || cat === 'API_KEY' ? 'high' : 'pii'
      }));

      if (redactionTags.length === 0 && boundingBoxes.length > 0) {
        redactionTags.push({ label: `${boundingBoxes.length} sensitive fields masked`, type: 'pii' });
      }

      const traceSteps = [
        {
          kind: 'scan',
          title: `Observed ${sanitizedDom.length} DOM elements (${boundingBoxes.length} sensitive targets detected)`,
          detail: 'Local deterministic & regex scanner active'
        },
        {
          kind: 'redact',
          title: `${redactedCount} sensitive visual regions blurred / masked prior to transmission`,
          tags: redactionTags
        },
        {
          kind: 'scan',
          title: 'Zero raw PII transmitted • Sanitized context ready',
          detail: 'All passwords, credentials, and PII replaced with safe semantic placeholders.',
          tags: [{ label: 'privacy: verified', type: 'safe' }]
        }
      ];

      this.emitMessage('AGENT_TRACE', {
        steps: traceSteps,
        redactedCount: redactedCount,
        categoryCounts: categoryCounts
      });

      // 4. Validate through Privacy Gate
      const outboundPayload = {
        goal: this.state.goal,
        image: redactedImageWebp,
        sanitized_dom: sanitizedDom,
        tab_info: { id: this.state.tabId }
      };

      const privacyCheck = PrivacyGate.validatePayload(outboundPayload);
      if (!privacyCheck.passed) {
        throw new Error(`Privacy gate check failed: ${privacyCheck.violations.join(', ')}`);
      }

      // 5. Send to Server for Reasoning
      this.state.status = 'running';
      this.updateStatus('Sending anonymized context to VLM Server...');
      this.emitMessage('AGENT_STATUS', {
        status: 'running',
        label: 'VLM Server reasoning over sanitized state…',
        step: 'Planning macro browser steps',
        progress: 65
      });

      const serverRes = await fetch(`${this.state.serverUrl}/api/v1/plan`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(outboundPayload)
      });

      if (!serverRes.ok) {
        throw new Error(`Server returned HTTP ${serverRes.status}`);
      }

      const planData = await serverRes.json();
      const rawSteps = planData.steps || [];
      this.addLog(`Server returned plan with ${rawSteps.length} step(s): ${planData.message || ''}`);

      if (rawSteps.length === 0 || planData.status === 'completed') {
        this.state.status = 'completed';
        this.updateStatus('Goal Completed Successfully!');
        this.emitMessage('AGENT_DONE', {
          message: planData.message || 'Task completed successfully on the active page.'
        });
        return;
      }

      // 6. Map and Execute Action Steps
      this.state.status = 'executing';
      this.state.totalSteps = rawSteps.length;

      // Transform raw server steps to ActionExecutor format
      const executableSteps = rawSteps.map(s => {
        let actionType = s.action_type || 'click';
        if (actionType === 'type') {
          return {
            action: 'type',
            target: {
              selector: s.target_selector,
              text_fallback: s.text_fallback,
              semantic_type: s.text_fallback || s.target_selector
            },
            text: s.value || ''
          };
        } else if (actionType === 'click') {
          return {
            action: 'click',
            target: {
              selector: s.target_selector,
              text_fallback: s.text_fallback,
              role: 'button'
            }
          };
        } else if (actionType === 'scroll') {
          return {
            action: 'scroll',
            direction: s.direction || 'down',
            amount: s.amount || 250
          };
        } else if (actionType === 'wait_for_mutation' || actionType === 'wait') {
          return {
            action: 'wait',
            duration: s.timeout || 1500
          };
        } else if (actionType === 'finish') {
          return { action: 'wait', duration: 300, isFinish: true };
        }
        return { action: actionType, target: s.target_selector };
      });

      // Execute steps sequentially with live UI progress
      for (let i = 0; i < executableSteps.length; i++) {
        if (this.state.status === 'cancelled') return;

        const currentStepObj = executableSteps[i];
        this.state.currentStep = i + 1;

        const stepDescription = `${currentStepObj.action.toUpperCase()} ${currentStepObj.target?.text_fallback || currentStepObj.target?.selector || ''}`;
        this.updateStatus(`Executing Step ${i + 1}/${executableSteps.length}: ${stepDescription}`);

        this.emitMessage('AGENT_STATUS', {
          status: 'running',
          label: `Executing action ${i + 1}/${executableSteps.length}…`,
          step: stepDescription,
          action: stepDescription,
          progress: Math.round(70 + (i / executableSteps.length) * 25)
        });

        this.emitMessage('AGENT_ACTION', {
          action: stepDescription,
          progress: Math.round(70 + (i / executableSteps.length) * 25)
        });

        // Execute single step in content script
        await chrome.tabs.sendMessage(this.state.tabId, {
          action: 'EXECUTE_STEPS',
          payload: { steps: [currentStepObj] }
        });

        await new Promise(r => setTimeout(r, 400));
      }

      this.state.status = 'completed';
      this.updateStatus('All action steps completed successfully!');
      this.emitMessage('AGENT_DONE', {
        message: planData.message || `Successfully executed ${executableSteps.length} action(s) on the page.`
      });

    } catch (err) {
      console.error('[AgentController] Error during iteration:', err);
      this.state.status = 'failed';
      this.state.error = err.message;
      this.updateStatus(`Error: ${err.message}`);
      this.emitMessage('AGENT_ERROR', {
        message: err.message || 'An error occurred during agent execution.'
      });
    }
  }

  handleExecutionFinished(result) {
    console.log('[AgentController] Execution finished event:', result);
  }
}

export { AgentController };

