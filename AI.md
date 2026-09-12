# AI.md — Project Context for AI Agents

> This file is written for AI coding agents. It describes the full architecture, conventions, data flows, and gotchas of this repository so any agent can onboard instantly.

---

## 1. What This Project Is

**SIH26171 Privacy-Preserving Vision Agent** — built for Smart India Hackathon (Problem Statement SIH26171).

It is a **hybrid browser extension + backend server system** that:
1. Captures the visible screen state of a Chrome tab.
2. Locally redacts all PII/sensitive content (passwords, credit cards, emails, faces) using a 3-tier client-side engine **before** any data leaves the browser.
3. Sends the anonymized (blacked-out) WebP image to a FastAPI backend running a Vision-Language Model (VLM).
4. The VLM returns a structured JSON array of macro action steps (click, type, scroll, wait).
5. The extension executes those steps locally on the DOM, monitors for page mutations, and re-queries the server only when needed.

**Key privacy guarantee**: The server never sees raw PII. All redaction happens client-side.

---

## 2. Repository Structure

```
SIH26/
├── .gitignore
├── README.md                          # User-facing docs & setup guide
├── AI.md                              # THIS FILE — agent context
│
├── extension/                         # Chrome Extension (Manifest V3)
│   ├── manifest.json                  # MV3 config — permissions, content scripts, offscreen
│   ├── shared/
│   │   └── constants.js               # Message action types, default settings
│   ├── background/
│   │   └── service_worker.js          # Orchestrator: lifecycle, tab capture, server fetch, offscreen mgmt
│   ├── content/
│   │   ├── pii_dom_scanner.js         # Tier 1: Deterministic DOM input scanner
│   │   ├── pii_text_scanner.js        # Tier 2: Regex + Luhn text node scanner
│   │   ├── macro_executor.js          # Step executor with MutationObserver & fuzzy fallback
│   │   └── content_script.js          # Message router between background & scanners
│   ├── offscreen/
│   │   ├── offscreen.html             # Host page for canvas context
│   │   ├── offscreen.js               # Canvas obfuscator (+5px buffer), WebP encoder
│   │   └── cv_redactor.js             # Tier 3: Visual CV face/avatar pixel detector
│   └── popup/
│       ├── popup.html                 # Flat 2D professional dashboard
│       ├── popup.css                  # Solid corporate color palette (no gradients)
│       └── popup.js                   # UI controller, proof snapshot viewer
│
├── server/                            # Python FastAPI Backend
│   ├── main.py                        # FastAPI app, CORS, /api/v1/plan, snapshot saver, audit logger
│   ├── config.py                      # Settings: HOST, PORT, VLM_BACKEND_TYPE, OLLAMA_URL/MODEL
│   ├── schemas.py                     # Pydantic models: ActionStep, PlanRequest, PlanResponse
│   ├── vlm_engine.py                  # Ollama/vLLM connector with mock fallback
│   ├── mock_vlm.py                    # Stateful mock VLM with goal-prompt NLP parsing
│   ├── agent_memory.py                # Multi-turn session memory, trial-and-error fallbacks
│   ├── requirements.txt               # fastapi, uvicorn, pydantic, pillow, requests, python-multipart
│   └── public/
│       ├── snapshots/                 # Saved redacted proof PNG frames (gitignored except .gitkeep)
│       │   └── .gitkeep
│       └── payload_audit.json         # Last transmission audit log (gitignored)
│
└── demo/
    └── test_form.html                 # Synthetic test page with PII fields for manual verification
```

---

## 3. Core Data Flow (End-to-End)

```
User clicks "Run Privacy Agent" in popup
  → popup.js sends START_AGENT message to service_worker.js
  → service_worker.js:
      1. Pings content script (PING); if no response, dynamically injects scripts via chrome.scripting.executeScript
      2. Creates offscreen document if needed (chrome.offscreen.createDocument)
      3. Sends SCAN_PII to content_script.js
         → content_script.js runs PIIDomScanner.scan() (Tier 1) + PIITextScanner.scan() (Tier 2)
         → Returns array of { x, y, width, height, type, reason } bounding boxes
      4. Captures visible tab screenshot via chrome.tabs.captureVisibleTab (PNG data URL)
      5. Sends REDACT_CANVAS to offscreen.js with raw image + bounding boxes
         → offscreen.js draws image on canvas
         → Runs CVRedactor.detect() for Tier 3 visual face detection
         → Merges all boxes with +5px padding, fills solid black rectangles
         → Encodes canvas as WebP data URL, returns to service worker
      6. POSTs to backend: { goal, image (redacted WebP), tab_info }
         → server/main.py:
            a. Decodes base64 image → saves to public/snapshots/latest_redacted_frame.png
            b. Writes audit metadata to public/payload_audit.json
            c. Calls VLMEngine.process_vision_plan(goal, image)
               → mock_vlm.py parses user prompt for custom values (e.g., "fill uday in name")
               → Returns PlanResponse with ActionStep[] array
         → Returns JSON: { status, message, steps[] }
      7. Sends EXECUTE_STEPS to content_script.js
         → macro_executor.js runs each step sequentially (type, click, scroll, wait_for_mutation)
         → Uses native HTMLInputElement.prototype.value setter for framework compatibility
         → Uses fuzzy text fallback if CSS selector fails
         → Reports EXECUTION_FINISHED back to service worker
```

---

## 4. The 3-Tier PII Redaction Engine

| Tier | File | Method | What It Catches |
|------|------|--------|-----------------|
| **1 — DOM** | `pii_dom_scanner.js` | Deterministic attribute inspection | `type="password"`, `autocomplete="cc-*"`, sensitive `name`/`id`/`placeholder` patterns, ARIA labels |
| **2 — Text** | `pii_text_scanner.js` | Regex + Luhn algorithm on visible text nodes | Credit cards (Luhn-validated), emails, Indian Aadhaar (`[2-9]\d{3}\s?\d{4}\s?\d{4}`), SSN, phone numbers |
| **3 — Visual CV** | `cv_redactor.js` | Pixel-level skin-tone clustering on canvas ImageData | Faces, profile avatars, visual non-text PII |

All bounding boxes are merged with a **+5px safety padding buffer** before solid black masking.

---

## 5. Server API Contract

**Base URL**: `http://127.0.0.1:8000`

### `GET /api/v1/health`
Returns: `{ "status": "ok", "backend": "mock" | "ollama" | "vllm" }`

### `POST /api/v1/plan`
**Request body** (JSON):
```json
{
  "goal": "fill uday in name and uday@example.com in email",
  "image": "data:image/webp;base64,...",
  "tab_info": { "id": 123 }
}
```

**Response body** (JSON):
```json
{
  "status": "in_progress" | "completed" | "failed",
  "message": "VLM Trial & Error Engine (Turn 1): ...",
  "steps": [
    {
      "action_type": "type" | "click" | "scroll" | "wait_for_mutation" | "finish",
      "target_selector": "input[name='fullName']",
      "text_fallback": "Full Name",
      "value": "uday",
      "coordinates": null,
      "timeout": 3000
    }
  ]
}
```

### Static Proof Assets
- `GET /public/snapshots/latest_redacted_frame.png` — Last redacted frame image
- `GET /public/payload_audit.json` — Last transmission audit metadata (not served, only on disk)

---

## 6. Key Conventions & Patterns

### Extension Messaging
All inter-component communication uses `chrome.runtime.sendMessage` / `chrome.tabs.sendMessage` with `{ action: string, payload: object }` shape. Action constants are defined in `shared/constants.js` but content scripts use raw strings since they are not ES modules.

### Content Script Injection
Content scripts are declared in `manifest.json` for automatic injection. Additionally, `service_worker.js` has `ensureContentScriptInjected(tabId)` which sends a `PING` and dynamically injects scripts if no response (handles tabs opened before extension load or `file://` URLs).

### Offscreen Document
Chrome MV3 only allows **one** offscreen document at a time. `setupOffscreenDocument()` checks existence via `clients.matchAll()` and wraps creation in try/catch for the "Only a single offscreen document" edge case.

### VLM Backend Modes
Controlled by `VLM_BACKEND_TYPE` env var (default: `"mock"`):
- `"mock"` — Uses `mock_vlm.py` rule engine with NLP prompt parsing (no GPU needed)
- `"ollama"` — Connects to local Ollama instance at `OLLAMA_URL` with `OLLAMA_MODEL`
- `"vllm"` — (Planned) vLLM inference server

### Dynamic Goal Parsing
`mock_vlm.py` contains `parse_custom_user_details(goal)` which extracts user-specified values from natural language prompts using regex patterns:
- `"fill uday in name"` → `{ name: "uday" }`
- `"fill uday in name and uday@x.com in email"` → `{ name: "uday", email: "uday@x.com" }`
- `"name: Uday Kumar, email: u@x.com"` → `{ name: "Uday Kumar", email: "u@x.com" }`

### Trial-and-Error Memory
`agent_memory.py` maintains `AgentSessionMemory` singleton tracking:
- Per-turn action history
- Failed selector counts (used for fallback reasoning)
- Auto-reset when goal changes

### Proof Snapshot Storage
Every request to `/api/v1/plan` automatically:
1. Saves decoded image to `server/public/snapshots/latest_redacted_frame.png`
2. Saves timestamped copy `redacted_frame_<unix_ts>.png`
3. Writes audit JSON to `server/public/payload_audit.json`

These files are **gitignored** to prevent sensitive data leaking to remote repos.

---

## 7. UI Design Rules

The popup uses a **flat 2D professional color palette** — no gradients, no glassmorphism.

| Token | Value | Usage |
|-------|-------|-------|
| `--bg-dark` | `#0f172a` | Body & input backgrounds |
| `--card-bg` | `#1e293b` | Card containers |
| `--border-color` | `#334155` | All borders |
| `--flat-blue` | `#2563eb` | Primary action button |
| `--flat-red` | `#dc2626` | Stop / danger button |
| `--flat-green` | `#059669` | Proof viewer button |
| `--text-main` | `#f8fafc` | Primary text |
| `--text-muted` | `#94a3b8` | Labels, timestamps |

---

## 8. How to Run

### Backend Server
```bash
cd server
pip install -r requirements.txt
python main.py
# Runs on http://127.0.0.1:8000
# API docs at http://127.0.0.1:8000/docs
```

### Chrome Extension
1. Navigate to `chrome://extensions`
2. Enable Developer mode
3. Click "Load unpacked" → select the `extension/` folder
4. For `file://` test pages: enable "Allow access to file URLs" in extension details

### Test
Open `demo/test_form.html` in Chrome, open extension popup, type a goal prompt, click **▶ Run Privacy Agent**.

---

## 9. Known Gotchas & Edge Cases

1. **Offscreen document reasons enum**: Must use `chrome.offscreen.Reason.DOM_PARSER`, not the string `"DOM_PARSING"`. The service worker wraps this in try/catch.
2. **Content script not injected**: Tabs opened before extension load won't have content scripts. The `ensureContentScriptInjected` helper handles this via dynamic injection.
3. **file:// URLs**: Chrome blocks content script injection on `file://` pages unless "Allow access to file URLs" is enabled in extension settings.
4. **Multiple selector syntax**: `target_selector` fields use comma-separated CSS selectors (e.g., `"input[name='email'], #emailInput"`). `macro_executor.js` uses `document.querySelector()` which natively supports this.
5. **React/Angular input compatibility**: The `type` action uses `Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set` to bypass framework-managed state and dispatches native `input` + `change` events.
6. **Snapshot images are gitignored**: `server/public/snapshots/*` is in `.gitignore`. The `.gitkeep` file preserves the directory structure.

---

## 10. Future Implementation Targets

- **Real VLM Integration**: Connect `vlm_engine.py` to a live Qwen2-VL-7B or Florence-2-large model via Ollama/vLLM for actual visual grounding.
- **ONNX/WebGPU Face Detection**: Replace the skin-tone heuristic in `cv_redactor.js` with a real YOLOv8n-face or MediaPipe ONNX model running on WebGPU inside the offscreen document.
- **Client NLP/NER**: Add compromise.js or quantized DistilBERT for richer text PII entity recognition beyond regex.
- **Structured DOM Snapshot**: Send a serialized DOM accessibility tree alongside the image for more precise VLM grounding.
- **Multi-tab Support**: Track agent state per tab rather than globally.
