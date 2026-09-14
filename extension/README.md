# Sentra — Sidebar UI Prototype

A Chrome (Manifest V3) side panel + on-page popup UI for your privacy-preserving
vision agent, styled independently of ChatGPT's extension but following the
same docked-sidebar interaction pattern.

## Load it

1. Open `chrome://extensions`.
2. Enable **Developer mode** (top right).
3. Click **Load unpacked** and select this folder.
4. Click the Sentra icon in the toolbar — the side panel opens docked to the browser.

Firefox: use `about:debugging` → *This Firefox* → *Load Temporary Add-on*, pointing
at `manifest.json` (Firefox's `sidebar_action` API differs slightly from Chrome's
`side_panel` — see the note below if you need cross-browser support).

## What's wired up vs. stubbed

- **`sidepanel.html/css/js`** — the chat-style thread, collapsible scan → redact → act
  trace cards, redaction settings drawer, and composer. Fully working UI.
- **`content.js/css`** — the on-page popup that confirms an action was taken,
  isolated under `#__sentra_popup` so it won't collide with host page styles.
- **`background.js`** — opens the panel and relays messages between the panel and
  the active tab's content script.
- **`runLocalScan()` in `sidepanel.js`** — this is the seam where your real
  ONNX Runtime Web / Transformers.js pipeline plugs in. Right now it returns
  mocked detections after a short delay; replace its body with the actual
  local inference + redaction call and keep the same return shape
  (`elements`, `faces`, `textFields`, `redactions`, `action`, `actionPayload`, `followUp`).
- **Server call** — not included here; add a `callServer(sanitizedPayload)`
  function that posts your scene graph (never raw pixels/text) to your VLM
  backend, and use its response to build the `steps` passed to `addTraceCard`.

## Cross-browser note

Chrome's `sidePanel` API and Firefox's `sidebar_action` are not identical.
For a single codebase across both, keep all UI logic in `sidepanel.js` as done
here, and maintain two thin manifests (`manifest.json` for Chrome,
`manifest.firefox.json` using `sidebar_action`) pointing at the same HTML/CSS/JS.
