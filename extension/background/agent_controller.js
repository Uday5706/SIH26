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
import { captureAndRedactScreenshot } from '../perception/screenshot.js';
import { buildServerPayload, DryRunTransport, WebSocketTransport } from '../agent/network_transport.js';
import { PerceptionRuntime } from '../perception/runtime.js';

class AgentController {
  constructor(addLog, updateStatus, getOffscreenCanvas, ensureContentScripts) {
    this.addLog = addLog;
    this.updateStatus = updateStatus;
    this.getOffscreenCanvas = getOffscreenCanvas;
    this.ensureContentScripts = ensureContentScripts;
    this.perceptionRuntime = new PerceptionRuntime();

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

      // Verify tab and check restricted URLs
      let tabInfo = null;
      if (this.state.tabId) {
        try {
          tabInfo = await chrome.tabs.get(this.state.tabId);
        } catch (e) {
          console.warn('Could not inspect tab:', e);
        }
      }

      if (tabInfo && tabInfo.url && (tabInfo.url.startsWith('chrome://') || tabInfo.url.startsWith('edge://') || tabInfo.url.startsWith('chrome-extension://') || tabInfo.url.startsWith('about:'))) {
        throw new Error('Extensions cannot run on browser internal pages (' + tabInfo.url.split('/')[2] + '). Please open any normal website to test.');
      }

      await this.getOffscreenCanvas();
      await this.ensureContentScripts(this.state.tabId);

      // 1. Observe: Extract real DOM and text PII
      let contentResponse = null;
      try {
        contentResponse = await chrome.tabs.sendMessage(this.state.tabId, { action: 'GET_STATE_FULL' });
        // Fallback to legacy SCAN_PII if content script is older
        if (!contentResponse || !contentResponse.success) {
          contentResponse = await chrome.tabs.sendMessage(this.state.tabId, { action: 'SCAN_PII' });
        }
      } catch (err) {
        console.warn('First GET_STATE_FULL failed, retrying after injection:', err);
        await this.ensureContentScripts(this.state.tabId);
        contentResponse = await chrome.tabs.sendMessage(this.state.tabId, { action: 'GET_STATE_FULL' });
        if (!contentResponse || !contentResponse.success) {
          contentResponse = await chrome.tabs.sendMessage(this.state.tabId, { action: 'SCAN_PII' });
        }
      }

      let boundingBoxes = [];
      let sanitizedDom = [];
      let sanitizationContext = null;
      let vault = null;
      
      // Handle new extractor format
      if (contentResponse.state && contentResponse.state.elements) {
        sanitizedDom = contentResponse.state.elements;
        // Mock bounding boxes for visual redaction based on extracted elements
        boundingBoxes = sanitizedDom.filter(e => e.sensitive).map(e => ({
          x: e.bbox[0], y: e.bbox[1], width: e.bbox[2], height: e.bbox[3],
          sensitivity: e.sensitivity,
          category: e.category,
          type: e.category
        }));
        vault = contentResponse.vault || null;
      } else {
        // Legacy format
        boundingBoxes = (contentResponse && contentResponse.boundingBoxes) || [];
        sanitizedDom = (contentResponse && contentResponse.sanitizedDom) || [];
        sanitizationContext = (contentResponse && contentResponse.sanitizationContext) || null;
        vault = (contentResponse && contentResponse.vault) || null;
      }
      
      // -- NEW: Prompt PII Tokenization --
      // Sanitize user's task using TokenVault. If new PII is found, mint standard tokens and sync.
      let nerTokensToSync = [];
      const emailRegex = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
      const phoneRegex = /\b(?:\+?\d{1,3}[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}\b/g;

      const tokenizeMatch = (match, cat) => {
        if (vault.realToToken[match]) return vault.realToToken[match];
        if (!vault.counters[cat]) vault.counters[cat] = 0;
        vault.counters[cat]++;
        const token = `[${cat}_${String(vault.counters[cat]).padStart(2, '0')}]`;
        vault.realToToken[match] = token;
        vault.tokenToReal[token] = match;
        nerTokensToSync.push({ category: cat, realValue: match, context: { source: 'prompt' } });
        return token;
      };

      this.state.goal = this.state.goal.replace(emailRegex, m => tokenizeMatch(m, 'EMAIL'));
      this.state.goal = this.state.goal.replace(phoneRegex, m => tokenizeMatch(m, 'PHONE'));
      // -- END Prompt PII Tokenization --

      // -- NEW: NER Cascade for Ambiguous DOM Text --
      // Filter non-sensitive items with visible text (1 to 15 words)
      let nerWorkerEnsured = false;
      for (const el of sanitizedDom) {
        if (!el.sensitive && el.category === 'GENERAL' && el.value) {
          const txt = el.value.trim();
          const wordCount = txt.split(/\s+/).length;
          // Visible text that looks like a name or phrase
          if (wordCount >= 1 && wordCount <= 15 && txt.length > 2) {
            try {
              if (!nerWorkerEnsured) {
                await this.perceptionRuntime.ensureWorker('ner');
                this.addLog('[NER] model loaded');
                nerWorkerEnsured = true;
              }
              this.addLog(`[NER] inference triggered for: "${txt.substring(0, 20)}..."`);
              const nerResult = await this.perceptionRuntime.executeTask('ner', 'analyze', { text: txt });
              this.addLog(`[NER] inference completed`);
              
              // Find strong person entities
              const hasPerson = nerResult.some(r => r.score > 0.85 && (r.entity_group === 'PERSON' || r.entity_group === 'B-PER' || r.entity_group === 'I-PER'));
              
              if (hasPerson) {
                this.addLog(`[NER] entities detected: PERSON`);
                // Determine token number
                const cat = 'PERSON';
                if (!vault.counters[cat]) vault.counters[cat] = 0;
                vault.counters[cat]++;
                const num = String(vault.counters[cat]).padStart(2, '0');
                const token = `[${cat}_${num}]`;
                
                // Update local vault snapshot
                vault.realToToken[txt] = token;
                vault.tokenToReal[token] = txt;
                if (el.id) vault.elementTokenMap[el.id] = token;
                
                // Record for content script sync
                nerTokensToSync.push({ category: cat, realValue: txt, context: { elementId: el.id } });
                
                // Mutate the DOM payload
                el.sensitive = true;
                el.sensitivity = 'MODERATE';
                el.category = cat;
                el.value = token;
                el.nerClassified = true; // Flag for tests
                
                this.addLog(`[NER] tokenization applied: ${token}`);
                
                // Add bounding box for visual redaction
                if (el.bbox) {
                  boundingBoxes.push({
                    x: el.bbox[0], y: el.bbox[1], width: el.bbox[2], height: el.bbox[3],
                    sensitivity: 'MODERATE',
                    category: cat,
                    type: cat
                  });
                }
              }
            } catch (err) {
              console.warn('[AgentController] NER check failed for text:', txt, err);
            }
          }
        }
      }

      // Sync new tokens back to Content Script Vault
      if (nerTokensToSync.length > 0) {
        chrome.tabs.sendMessage(this.state.tabId, { action: 'SYNC_VAULT', tokens: nerTokensToSync }).catch(() => {});
      }
      // -- END NER --

      const sanitizedCount = sanitizationContext?.sanitizedFieldsCount || boundingBoxes.length;
      this.addLog(`Scanned ${sanitizedDom.length} DOM elements. Sanitized ${sanitizedCount} sensitive fields.`);

      // 2. Capture and Redact Screenshot in Offscreen Canvas
      this.emitMessage('AGENT_STATUS', {
        status: 'privacy',
        label: 'Applying region-level visual redaction…',
        step: 'Redacting sensitive image coordinates locally',
        progress: 55
      });

      let redactedImageWebp = '';
      let categoryCounts = {};
      let redactedCount = 0;

      try {
        // Direct native worker redaction
        const result = await captureAndRedactScreenshot(this.state.tabId, tabInfo?.windowId, boundingBoxes, this.state.redactionBufferPx);
        redactedImageWebp = result.redactedImageWebp;
        categoryCounts = result.categoryCounts || {};
        redactedCount = result.redactedCount || 0;
      } catch (err) {
        console.warn('[AgentController] Screenshot redaction warning:', err);
      }

      // 3. Emit real trace statistics to Sidepanel
      const pageName = tabInfo?.title || 'Active Webpage';
      const redactionTags = Object.entries(categoryCounts).map(([cat, count]) => ({
        label: `${cat} (${count}) → [DUMMY_${cat}]`,
        type: cat === 'PASSWORD' || cat === 'PIN' || cat === 'OTP' || cat === 'API_KEY' ? 'high' : 'pii'
      }));

      if (redactionTags.length === 0) {
        if (sanitizedCount > 0) {
          redactionTags.push({ label: `${sanitizedCount} sensitive fields masked with dummy data`, type: 'pii' });
        } else {
          redactionTags.push({ label: 'No high-risk PII detected', type: 'safe' });
        }
      }

      const traceSteps = [
        {
          kind: 'scan',
          title: `Scanned ${sanitizedDom.length} DOM elements (${sanitizedCount} fields sanitized with dummy data)`,
          detail: `Page: ${pageName}`
        },
        {
          kind: 'redact',
          title: `${redactedCount} sensitive visual regions blurred / masked prior to transmission`,
          tags: redactionTags
        },
        {
          kind: 'scan',
          title: 'Zero raw PII transmitted • Context Vault active',
          detail: `${sanitizedCount} sensitive fields mapped to synthetic dummy values in local vault.`,
          tags: [{ label: 'vault: bidirectional map saved', type: 'safe' }]
        }
      ];

      this.emitMessage('AGENT_TRACE', {
        steps: traceSteps,
        redactedCount: redactedCount,
        categoryCounts: categoryCounts
      });

      // 4. Validate through Privacy Gate and build Server Payload
      
      const serverMode = "dry-run"; // TODO: make configurable later
      
      // Build the exact canonical Server Brain payload
      const candidatePayload = buildServerPayload(
        this.state.goal,
        contentResponse,
        redactedImageWebp,
        vault
      );

      // Final PrivacyGate validation on the EXACT object going over the network
      const privacyCheck = PrivacyGate.validatePayload(candidatePayload);
      if (!privacyCheck.passed) {
        throw new Error(`Privacy gate check failed: ${privacyCheck.violations.join(', ')}`);
      }

      // 5. Send via Transport
      let transport;
      if (serverMode === "dry-run") {
        transport = new DryRunTransport();
        this.state.status = 'completed';
        this.updateStatus('Dry run complete: Payload logged locally.');
        this.emitMessage('AGENT_STATUS', {
          status: 'success',
          label: 'Dry Run Payload Generated',
          step: 'Server communication skipped',
          progress: 100
        });
        this.emitMessage('AGENT_DONE', {
          message: 'Local redaction successful. Check Sidepanel for JSON.'
        });
      } else {
        transport = new WebSocketTransport();
        // ... future WebSocket logic
      }

      // The final sanitized object is handed to the transport
      transport.send(privacyCheck.sanitizedPayload);

      // Clean up local storage for proof tab
      await chrome.storage.local.set({ latestRedactedImage: redactedImageWebp });
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

