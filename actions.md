# Actions Log — SIH26171 Privacy-Preserving Vision Agent

> Running changelog of all development actions taken on this project, in reverse chronological order (newest first).

---

## Session: 2026-09-12

### 23:46 — Created `actions.md`
- Created this running action log file to track all future development activities.

---

### 23:36 — Created `AI.md` (Agent Context Document)
- Wrote comprehensive AI onboarding document covering full architecture, data flows, API contracts, conventions, gotchas, and future targets.
- Any AI agent reading `AI.md` can immediately understand and contribute to the project.

---

### 23:34 — Created `.gitignore`
- Added `.gitignore` excluding Python caches, virtual envs, generated proof snapshots (`server/public/snapshots/*`), audit logs, `.env` files, IDE configs, and OS files.
- Added `server/public/snapshots/.gitkeep` to preserve directory structure in Git.

---

### 23:20 — Dynamic Custom Goal Parsing & Native Input Execution
- **Problem**: User typed "fill uday in name" but the agent was filling hardcoded "John Doe" instead of the user's custom value.
- **Fix**: Added `parse_custom_user_details(goal)` NLP regex parser in `server/mock_vlm.py` that extracts custom field values from natural language goal prompts.
- **Fix**: Upgraded `extension/content/macro_executor.js` `type` action to use `HTMLInputElement.prototype.value` native setter for React/Angular/Vue framework compatibility.
- **Tested**: Verified `"fill uday in name and uday@privacy.org in email"` correctly parses to `{ name: "uday", email: "uday@privacy.org" }`.

---

### 23:14 — VLM Trial-and-Error Engine, Proof Snapshots & Flat 2D UI
- **Created** `server/agent_memory.py` — multi-turn session memory tracking action history, failed selectors, and trial-and-error fallback reasoning.
- **Updated** `server/mock_vlm.py` — integrated stateful trial-and-error reasoning into plan generation.
- **Updated** `server/main.py` — added proof snapshot saver (decodes base64 WebP → saves to `server/public/snapshots/latest_redacted_frame.png` + timestamped copies) and payload audit JSON exporter (`server/public/payload_audit.json`). Mounted `/public` as static file route.
- **Redesigned** `extension/popup/popup.css` — replaced glassmorphism gradients with solid flat 2D professional corporate colors (`#0f172a`, `#2563eb`, `#dc2626`, `#059669`).
- **Updated** `extension/popup/popup.html` — added **📷 View Redacted Proof Image** button.
- **Updated** `extension/popup/popup.js` — wired proof button to open `http://127.0.0.1:8000/public/snapshots/latest_redacted_frame.png` in new tab.
- **Verified**: API test returned 200 OK, proof snapshot saved to disk, audit JSON exported.

---

### 23:06 — Fixed "Could not establish connection" Error
- **Problem**: `chrome.tabs.sendMessage` failed because content scripts weren't injected on tabs opened before extension load.
- **Fix**: Added `ensureContentScriptInjected(tabId)` helper in `service_worker.js` that sends a `PING` and dynamically injects scripts via `chrome.scripting.executeScript` if no response.
- **Fix**: Added `PING` action handler in `content_script.js`.

---

### 23:04 — Fixed Offscreen Document `reasons` Enum Error
- **Problem**: `chrome.offscreen.createDocument` threw error because `'DOM_PARSING'` is not a valid enum value.
- **Fix**: Changed to `chrome.offscreen.Reason.DOM_PARSER` in `service_worker.js`.
- **Fix**: Wrapped offscreen creation in try/catch for "Only a single offscreen document" edge case.

---

### 22:46 — Initial Full Project Build (Phase 1)
- **Created** complete modular project structure across `extension/`, `server/`, and `demo/`.
- **Extension files created**:
  - `manifest.json` — MV3 declarations, permissions, content scripts, offscreen spec.
  - `shared/constants.js` — message types, action types, default settings.
  - `background/service_worker.js` — orchestrator, offscreen lifecycle, tab capture, server fetch.
  - `content/pii_dom_scanner.js` — Tier 1 deterministic DOM input scanner.
  - `content/pii_text_scanner.js` — Tier 2 regex + Luhn text node scanner.
  - `content/macro_executor.js` — macro step executor with MutationObserver & fuzzy fallback.
  - `content/content_script.js` — message router between background & scanners.
  - `offscreen/offscreen.html` — canvas host page.
  - `offscreen/offscreen.js` — canvas obfuscator (+5px buffer) & WebP encoder.
  - `offscreen/cv_redactor.js` — Tier 3 visual CV face/avatar detector.
  - `popup/popup.html`, `popup.css`, `popup.js` — extension dashboard UI.
- **Server files created**:
  - `main.py` — FastAPI app with CORS and `/api/v1/plan` endpoint.
  - `config.py` — server settings (HOST, PORT, VLM_BACKEND_TYPE, OLLAMA_URL/MODEL).
  - `schemas.py` — Pydantic models for ActionStep, PlanRequest, PlanResponse.
  - `vlm_engine.py` — Ollama/vLLM connector with mock fallback.
  - `mock_vlm.py` — intelligent offline rule engine.
  - `requirements.txt` — Python dependencies.
- **Demo**: `demo/test_form.html` — synthetic test page with PII fields.
- **Docs**: `README.md` — project documentation & setup guide.
- **Verified**: FastAPI server imported successfully, VLM plan generation returned valid 5-step form-filling plan.
