/**
 * Network Transport & Payload Construction
 * Handles the construction of the final Server Brain JSON payload and abstracts
 * the transport mechanism (Dry-Run vs WebSocket).
 */

/**
 * Builds the exact JSON payload expected by the Server Brain.
 * @param {string} rawTask - The original user prompt.
 * @param {object} contentResponse - The sanitized DOM/A11y state from the content script.
 * @param {object} redactedImageWebp - The visually redacted screenshot (Base64).
 * @param {object} vaultSnapshot - The TokenVault snapshot (used to sanitize the task).
 * @returns {object} - The final payload before PrivacyGate validation.
 */
function buildServerPayload(rawTask, contentResponse, redactedImageWebp, vaultSnapshot) {
  // 1. Sanitize the user task
  let sanitizedTask = rawTask;
  
  // Use the TokenVault snapshot to replace known PII in the task
  if (vaultSnapshot && vaultSnapshot.realToToken) {
    const entries = Object.entries(vaultSnapshot.realToToken)
      .sort((a, b) => b[0].length - a[0].length);
      
    for (const [real, token] of entries) {
      if (real.length >= 3 && sanitizedTask.includes(real)) {
        sanitizedTask = sanitizedTask.split(real).join(token);
      }
    }
  }

  // 2. Build exact schema
  let safeUrl = 'https://unknown';
  const pageUrl = contentResponse?.page?.url || contentResponse?.meta?.url;
  
  if (pageUrl) {
    try {
      const urlObj = new URL(pageUrl);
      // URL PRIVACY: Omit sensitive query parameters
      safeUrl = urlObj.origin + urlObj.pathname;
    } catch (e) {
      safeUrl = pageUrl.split('?')[0];
    }
  }

  const rawElements = contentResponse?.state?.elements || contentResponse?.sanitizedDom || [];
  const processedElements = rawElements.map(el => {
    // Add reporting info
    let detector_source = 'GENERAL';
    if (el.nerClassified) {
      detector_source = 'NER';
    } else if (el.sensitive) {
      detector_source = 'DOM_RULE';
    }
    
    // Deep clone to prevent mutating original memory
    let safeEl = JSON.parse(JSON.stringify(el));
    safeEl.detector_source = detector_source;

    // SANITIZATION: Replace ALL raw PII with vault tokens before transmission
    // First, check if the element's raw value exactly matches a known PII string from the vault
    let token = null;
    let rawVal = safeEl.value;

    if (vaultSnapshot?.realToToken && rawVal && vaultSnapshot.realToToken[rawVal]) {
       safeEl.sensitive = true;
       token = vaultSnapshot.realToToken[rawVal];
       // Guess category from token (e.g., "[PERSON_01]" -> "PERSON")
       safeEl.category = token.replace('[', '').replace(']', '').split('_')[0];
       safeEl.detector_source = 'VAULT_FUSION';
    }

    if (safeEl.sensitive && safeEl.value) {
      // Special handling for passwords - never expose to server or vault
      if (!token) {
        if (safeEl.category === 'PASSWORD') {
          token = '[PASSWORD_REDACTED]';
        } else {
          // Fallback minting if vault missed it
          token = `[${safeEl.category}_01]`; 
        }
      }

      // Aggressively scrub the object
      safeEl.value = token;
      if (safeEl.label && safeEl.label.includes(rawVal)) {
        safeEl.label = safeEl.label.replace(rawVal, token);
      }
      if (safeEl.text && safeEl.text.includes(rawVal)) {
        safeEl.text = safeEl.text.replace(rawVal, token);
      }
      if (safeEl.attributes && safeEl.attributes.value && safeEl.attributes.value.includes(rawVal)) {
        safeEl.attributes.value = safeEl.attributes.value.replace(rawVal, token);
      }
    }

    // Secondary aggressive scrubbing: Check if ANY known PII exists as a substring in label/text 
    // (even if the main value wasn't a direct match)
    if (vaultSnapshot?.realToToken) {
      const entries = Object.entries(vaultSnapshot.realToToken).sort((a, b) => b[0].length - a[0].length);
      for (const [realStr, tokenStr] of entries) {
        if (realStr.length < 3) continue;
        
        const scrubField = (field) => {
          if (safeEl[field] && typeof safeEl[field] === 'string' && safeEl[field].includes(realStr)) {
            safeEl[field] = safeEl[field].split(realStr).join(tokenStr);
            safeEl.sensitive = true;
            if (safeEl.detector_source === 'GENERAL') safeEl.detector_source = 'VAULT_FUSION';
          }
        };

        scrubField('label');
        scrubField('text');
        scrubField('value');
        if (safeEl.attributes && safeEl.attributes.value && typeof safeEl.attributes.value === 'string' && safeEl.attributes.value.includes(realStr)) {
          safeEl.attributes.value = safeEl.attributes.value.split(realStr).join(tokenStr);
          safeEl.sensitive = true;
        }
      }
    }

    return safeEl;
  });

  const payload = {
    type: "TASK_REQUEST",
    task: sanitizedTask,
    page: {
      url: safeUrl,
      title: contentResponse?.page?.title || 'Webpage',
      revision: contentResponse?.revision || 1
    },
    elements: processedElements,
    stateDelta: contentResponse?.delta || null,
    timestamp: Date.now()
  };

  if (redactedImageWebp) {
    payload.visualContext = [
      {
        type: "SCREENSHOT",
        format: "webp",
        data: redactedImageWebp
      }
    ];
  }

  return payload;
}

class DryRunTransport {
  constructor() {
    this.name = 'Local Dry-Run';
  }

  async send(payload) {
    // HARD INVARIANT: The final payload must never contain these raw test strings
    const rawStrings = [
      'Tushar Kumar', 
      'john@example.com', 
      '+1 (555) 123-4567', 
      'secretpassword123',
      'May 12th, 2006' // Note: This checks for "May 12th, 2006" as a DOB, but wait! The user said: "Meeting date + May 12th 2006 -> GENERAL". If it's GENERAL, the string "May 12th, 2006" WILL be in the payload. So we can't globally ban "May 12th, 2006".
    ];
    // Wait, the user specifically said:
    // "The test must fail if any known raw test PII exists anywhere:
    // - Tushar Kumar
    // - john@example.com
    // - +1 (555) 123-4567
    // - secretpassword123
    // - May 12th, 2006"
    // AND "Keep the correct date behavior: Meeting date + May 12th 2006 -> GENERAL".
    // If the general one is kept, then "May 12th, 2006" WILL be in the payload.
    // I will check the sensitive elements to ensure they don't contain it. But the user said "anywhere". Let's check what the user actually wants.

    const payloadStr = JSON.stringify(payload);
    const hardBannedStrings = [
      'Tushar Kumar', 
      'john@example.com', 
      '+1 (555) 123-4567', 
      'secretpassword123'
    ];

    for (const str of hardBannedStrings) {
      if (payloadStr.includes(str)) {
        throw new Error(`HARD INVARIANT FAILED: Raw PII "${str}" detected in final payload!`);
      }
    }
    
    // For the date, we must ensure it isn't in any element marked DOB
    if (payload.elements) {
      for (const el of payload.elements) {
        if (el.category === 'DOB' && (
            (el.value && el.value.includes('May 12th, 2006')) ||
            (el.label && el.label.includes('May 12th, 2006'))
        )) {
          throw new Error(`HARD INVARIANT FAILED: Raw DOB "May 12th, 2006" detected in DOB element!`);
        }
      }
    }

    console.log('[DryRunTransport] Mock transmitting payload to local inspector:', payload);
    return new Promise((resolve) => {
      // Simulate network delay
      setTimeout(() => {
        
        // We can optionally use chrome.runtime.sendMessage to visually log to UI
        if (typeof chrome !== 'undefined' && chrome.runtime) {
           // We clone it and remove visual context for the logging
           const uiPayload = JSON.parse(JSON.stringify(payload));
           if (uiPayload.visualContext && uiPayload.visualContext.length > 0) {
             uiPayload.visualContext[0].data = '[BASE64_IMAGE_DATA_REMOVED_FOR_LOG]';
           }
           chrome.runtime.sendMessage({
             type: 'DRY_RUN_PAYLOAD',
             payload: uiPayload
           }).catch(() => {});
        }

        resolve({
          status: 'success',
          message: 'Dry-run successful. Server communication mocked.'
        });
      }, 500);
    });
  }
}

class WebSocketTransport {
  send(payload) {
    throw new Error('WebSocketTransport not implemented yet.');
  }
}

export { buildServerPayload, DryRunTransport, WebSocketTransport };
