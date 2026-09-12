# SIH26171 Privacy-Preserving Vision Agent

A hybrid, privacy-first browser extension and FastAPI server system built for Smart India Hackathon (**Problem Statement SIH26171**). The system redacts PII locally on the client using a 3-tier engine (DOM + Text/Luhn + Visual CV via MV3 Offscreen Document) before transmitting obfuscated screen states to a server-side Vision-Language Model (VLM).

---

## Architecture Overview

```
+-----------------------------------------------------------------------------------+
| CHROME EXTENSION (MANIFEST V3)                                                    |
|                                                                                   |
|  [Popup UI] <---> [Service Worker] <===================> [Backend FastAPI Server] |
|                        |   ^                                (VLM Engine)          |
|                        v   |                                                      |
|               [Offscreen Document]                                                |
|               - Canvas Obfuscator (+5px buffer)                                   |
|               - ONNX/WebGPU Visual CV Redaction                                   |
|                        ^                                                          |
|                        | (Redacted Canvas WebP Payload)                           |
|                        v                                                          |
|               [Content Script Engine]                                             |
|               - Tier 1: Deterministic DOM Input Scanner                           |
|               - Tier 2: Text/NLP Redactor (Regex, Luhn, SSN, Aadhaar, Email)     |
|               - Tier 3: Macro-Micro Step Executor (MutationObserver)              |
+-----------------------------------------------------------------------------------+
```

---

## 3-Tier Local PII Redaction Pipeline

1. **Tier 1 (Deterministic DOM)**: Scans `<input>`, `<textarea>`, `[contenteditable]` elements checking `type="password"`, `autocomplete="cc-*"`, ARIA roles, and sensitive attribute patterns (`cvv`, `ssn`, `card`, `password`). Computes precise `getBoundingClientRect()`.
2. **Tier 2 (Probabilistic Text/NLP)**: Traverses visible DOM text nodes using Regex + **Luhn Algorithm** validation for Credit Cards, Emails, Indian Aadhaar numbers (`\b[2-9]\d{3}\s?\d{4}\s?\d{4}\b`), SSNs, and Phone numbers.
3. **Tier 3 (Offscreen Visual CV)**: Runs inside a Chrome Manifest V3 Offscreen Document on Canvas/WebGPU ImageData to detect faces and profile avatars.
4. **Canvas Obfuscator**: Merges all bounding boxes with a **`+5px` safety padding buffer**, paints solid black blackout masks, and encodes WebP payload.

---

## Project Folder Structure

```
SIH26/
├── extension/                       # Chrome Extension (Manifest V3)
│   ├── manifest.json                # MV3 Declarations & Permissions
│   ├── shared/constants.js          # Shared Event & Message Constants
│   ├── background/service_worker.js # Background Orchestrator & Server API Client
│   ├── content/
│   │   ├── content_script.js        # Content Script Controller
│   │   ├── pii_dom_scanner.js       # Tier 1 DOM Input Redactor
│   │   ├── pii_text_scanner.js      # Tier 2 Regex + Luhn NLP Redactor
│   │   └── macro_executor.js        # Macro Step Executor & MutationObserver
│   ├── offscreen/
│   │   ├── offscreen.html           # Canvas DOM Host
│   │   ├── offscreen.js             # Canvas Obfuscator (+5px buffer) & WebP Exporter
│   │   └── cv_redactor.js           # Tier 3 Visual CV Detector
│   └── popup/
│       ├── popup.html               # Glassmorphism UI
│       ├── popup.css                # Premium Dark Glass Tokens
│       └── popup.js                 # Dashboard Controller
├── server/                          # FastAPI Backend
│   ├── main.py                      # FastAPI Routes & CORS
│   ├── config.py                    # Server Configuration
│   ├── schemas.py                   # Pydantic Request/Response Models
│   ├── vlm_engine.py                # Ollama / vLLM Connector
│   ├── mock_vlm.py                  # Intelligent Offline Rule Engine
│   └── requirements.txt             # Python Dependencies
├── demo/
│   └── test_form.html               # Synthetic Test Bench Page
└── README.md                        # Project Guide
```

---

## Quick Start Guide

### 1. Start FastAPI Backend Server
```bash
cd server
pip install -r requirements.txt
python main.py
```
*Server will run at `http://127.0.0.1:8000` with interactive docs at `http://127.0.0.1:8000/docs`.*

### 2. Load Chrome Extension
1. Open Google Chrome and navigate to `chrome://extensions`.
2. Enable **Developer mode** (top right toggle).
3. Click **Load unpacked** and select the `extension/` directory.

### 3. Run Privacy Test Bench
1. Open `demo/test_form.html` in Chrome.
2. Click the **Vision Agent** extension icon in the toolbar.
3. Type your Goal Prompt (e.g., `Fill out registration form and click submit`).
4. Click **▶ Run Privacy Agent**.
5. Observe live redaction logs and step executions in the popup dashboard!
