# SIH'26 Privacy-Preserving Browser Agent - Implementation Details

This document outlines the architecture, file structure, and implementation details of the privacy-preserving browser agent. It serves as a record of all milestones completed to date.

## Core Architectural Principles
1. **Visual-First, DOM-Assisted**: We use a hybrid approach combining visual screenshots and sanitized DOM data.
2. **Local Privacy Processing**: **"RAW BROWSER DATA NEVER GOES DIRECTLY TO SERVER."** All PII detection and redaction happens completely locally on the client's device.
3. **Context Preservation**: Redaction is tightly localized to preserve surrounding webpage structure, layout, and styling for the VLM.

---

## 🛡️ Phase 1: Privacy Engine & Local Sanitization
**Goal:** Prevent sensitive user data (PII) from ever leaving the browser, while preserving webpage structure for AI analysis.

### Features Built:
- **Multi-Tier PII Classification**: 
  - `HIGH Sensitivity` (Passwords, Credit Cards, PINs, OTPs, API Keys) - Forcefully masked.
  - `MODERATE Sensitivity` (Emails, Names, Addresses, Phones) - Blurred.
- **Pixel-Perfect Canvas Redaction**: We capture the DOM using `html2canvas` and apply visual redaction via an Offscreen Canvas context. High PII gets a solid opaque mask (`#0f172a`) with a red security border. Moderate PII gets a localized frosted blur effect.
- **Semantic DOM Sanitization**: `pii_dom_scanner.js` generates a `sanitized_dom` JSON payload where sensitive text values are preemptively replaced with placeholders like `[PII_CREDIT_CARD]`.
- **Privacy Gate (`privacy_gate.js`)**: A strict, recursive JSON payload auditor acting as a final firewall in the service worker. It deep-scrubs all outgoing network payloads using regex and Luhn checks to ensure no raw PII leaks.

### Test Bench:
- **`demo/test_form.html`**: A highly dynamic "Synthetic Privacy Test Bench" featuring randomized scenarios (E-commerce, Healthcare, DevOps). It provides real-time visual previews of how the DOM scanners and canvas redaction obscure sensitive fields locally.

---

## 🤖 Phase 2: Local Agent Controller & Modular Action Executor
**Goal:** Create a reliable, decoupled pipeline for the browser agent to observe the page and execute actions on the local DOM without LLM integration yet.

### Features Built:
- **Agent Controller (`background/agent_controller.js`)**: 
  - Orchestrates the main execution loop (Observing → Requesting Action → Executing).
  - Manages the task state machine (`idle`, `running`, `observing`, `executing`, `failed`, `completed`).
  - Includes a **Mock Action Provider** configured to execute a hardcoded test sequence ("Compiler Design Search").
- **Modular Action Executor (`content/actions/`)**: 
  - `executor.js`: The central dispatcher injected into the content script. Uses a deterministic scoring algorithm (matching tag, role, text, semantic type, visibility) to perfectly identify elements in the real DOM.
  - `click.js`, `type.js`, `scroll.js`, `keypress.js`, `wait.js`: Isolated action handlers that safely interact with the DOM, dispatch native browser events, and provide smooth visual highlighting/scrolling.
- **Privacy Isolation**: The local Action Executor interacts with the real, unredacted DOM to perform tasks. However, the observation layer ALWAYS passes state through the Privacy Engine and Privacy Gate before handing it back to the Controller.

### Test Bench:
- **`demo/action_test.html`**: A dedicated test page for the Action Executor. It features a mock library search form and a hidden privacy regression test (containing real PII) to verify that the Agent can type/click successfully while the Privacy Gate still blocks any accidental data leakage.

---

## 📁 Key File Structure
- `extension/manifest.json` (V3 configuration, ES Modules enabled)
- `extension/background/`
  - `service_worker.js` (Orchestrator entry point)
  - `agent_controller.js` (State machine & Mock Provider)
  - `privacy_gate.js` (JSON payload firewall)
- `extension/content/`
  - `content_script.js` (Message router)
  - `pii_dom_scanner.js` & `pii_text_scanner.js` (Local Privacy Scanners)
  - `actions/` (Action Executor Modules: `executor.js`, `click.js`, `type.js`, `scroll.js`, `keypress.js`, `wait.js`)
- `demo/`
  - `test_form.html` (Privacy Redaction Test Bench)
  - `action_test.html` (Agent Action & Regression Test Bench)

---

## 🚀 Future Milestones
- **ServerAgent / GeminiAdapter**: Replacing the Mock Provider with a live VLM backend connection to dynamically generate action JSON.
- **Visual AI / ONNX**: Enhancing the fallback observation mechanisms for complex canvas/shadow-dom elements.
