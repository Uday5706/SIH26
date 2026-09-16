const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

console.log('--- 3. Verification: DOM State & Delta System ---');

// 1. Setup JSDOM
const dom = new JSDOM(`
  <!DOCTYPE html>
  <html>
  <body>
    <div id="container">
      <input type="text" id="email" value="alexander.hamilton@example.com" />
      <button id="submit">Submit</button>
    </div>
  </body>
  </html>
`, { runScripts: 'dangerously', resources: 'usable' });

const window = dom.window;
const document = window.document;
global.window = window;
global.document = document;

window.Element.prototype.getBoundingClientRect = () => ({ width: 100, height: 20, top: 10, left: 10, bottom: 30, right: 110 });

// 2. Load dependencies in order
const extDir = path.join(__dirname, '../extension');

const loadScript = (relPath) => {
  try {
    const code = fs.readFileSync(path.join(extDir, relPath), 'utf-8');
    window.eval(code);
  } catch (e) {
    console.error('Error loading', relPath, e);
    process.exit(1);
  }
};

loadScript('privacy/token-vault.js');
loadScript('content/pii_dom_scanner.js');
loadScript('content/page-extractor.js');
loadScript('content/dom-observer.js');

let passed = true;

const observer = window.SentraDOMObserver;
const extractor = window.SentraPageExtractor;

// 3. Initialize Observer
observer.start();

// Give it a moment to initialize and do the first full sweep
setTimeout(() => {
  const fullState = observer.forceRefresh();
  
  if (observer.getRevision() !== 1) {
    console.error(`❌ FAILED: Initial revision should be 1. Got ${observer.getRevision()}`);
    passed = false;
  } else {
    console.log(`✅ SUCCESS: Initial full state captured. Revision is ${observer.getRevision()}`);
  }

  // Check stable IDs
  const emailInput = document.getElementById('email');
  const sentraId = emailInput.getAttribute('data-sentra-id');
  if (!sentraId) {
    console.error('❌ FAILED: Stable data-sentra-id was not assigned to input element.');
    passed = false;
  } else {
    console.log(`✅ SUCCESS: Stable data-sentra-id (${sentraId}) successfully assigned.`);
  }

  // 4. Trigger a mutation
  console.log('Triggering DOM mutation...');
  const newEl = document.createElement('div');
  newEl.textContent = 'New dynamic content';
  document.getElementById('container').appendChild(newEl);

  // Modify existing element
  emailInput.value = 'updated@example.com';
  emailInput.dispatchEvent(new window.Event('input', { bubbles: true }));

  // Wait for debounce (observer has a 300ms debounce usually)
  setTimeout(() => {
    // peekDelta returns the current delta
    const deltaState = observer.peekDelta();
    
    // revision increments automatically inside the debounce handler
    if (observer.getRevision() <= 1) {
      console.error(`❌ FAILED: Revision did not increment after mutation. Got ${observer.getRevision()}`);
      passed = false;
    } else {
      console.log(`✅ SUCCESS: Revision incremented to ${observer.getRevision()} after mutation.`);
    }

    if (!deltaState.added && !deltaState.updated && deltaState.hasChanges === false) {
      console.error('❌ FAILED: No deltas were captured.');
      passed = false;
    } else {
      const deltaCount = deltaState.added.length + deltaState.updated.length + deltaState.removed.length;
      console.log(`✅ SUCCESS: Captured ${deltaCount} element deltas without resending full DOM.`);
    }

    if (passed) {
      console.log('\n🎉 DOM DELTA SYSTEM VERIFICATION: PASSED.');
      process.exit(0);
    } else {
      console.log('\n❌ DOM DELTA SYSTEM VERIFICATION: FAILED.');
      process.exit(1);
    }
  }, 500); // Wait 500ms for debounce
}, 100);
