const fs = require('fs');
const path = require('path');

// Mock browser globals
global.window = global;
global.window.location = { href: 'http://localhost/test' };
global.window.getComputedStyle = (el) => el._style || { visibility: 'visible', display: 'block', opacity: '1' };

const mockElements = {
  'btn-valid': { getBoundingClientRect: () => ({ width: 100, height: 20 }), getAttribute: () => null, tagName: 'BUTTON', disabled: false },
  'btn-disabled': { getBoundingClientRect: () => ({ width: 100, height: 20 }), getAttribute: () => null, tagName: 'BUTTON', disabled: true },
  'btn-invisible': { getBoundingClientRect: () => ({ width: 100, height: 20 }), getAttribute: () => null, tagName: 'BUTTON', disabled: false, _style: { display: 'none' } },
  'btn-aria-disabled': { getBoundingClientRect: () => ({ width: 100, height: 20 }), getAttribute: (attr) => attr === 'aria-disabled' ? 'true' : null, tagName: 'BUTTON', disabled: false }
};

global.document = {
  querySelector: (sel) => {
    if (sel.includes('btn-valid')) return mockElements['btn-valid'];
    if (sel.includes('btn-disabled')) return mockElements['btn-disabled'];
    if (sel.includes('btn-invisible')) return mockElements['btn-invisible'];
    if (sel.includes('btn-aria-disabled')) return mockElements['btn-aria-disabled'];
    return null; // deleted / not found
  }
};

// Load dependencies
const vaultCode = fs.readFileSync(path.join(__dirname, '../extension/privacy/token-vault.js'), 'utf-8');
eval(vaultCode);

const actionGuardCode = fs.readFileSync(path.join(__dirname, '../extension/agent/action-guard.js'), 'utf-8');
eval(actionGuardCode);

console.log('--- 7. Verification: Action Guard Robustness ---');

const actionGuard = window.SentraActionGuard;
let passed = true;

const validateTest = (desc, action, options, expectedCode) => {
  const result = actionGuard.validate(action, options);
  if (expectedCode === 'VALID' && result.valid) {
    console.log(`✅ SUCCESS: ${desc}`);
  } else if (!result.valid && result.code === expectedCode) {
    console.log(`✅ SUCCESS: ${desc} properly rejected (${result.code}).`);
  } else {
    console.error(`❌ FAILED: ${desc}. Expected ${expectedCode}, Got ${result.valid ? 'VALID' : result.code}`);
    passed = false;
  }
};

// Test 1: Valid element
validateTest('Valid element action', { action: 'click', selector: '#btn-valid' }, {}, 'VALID');

// Test 2: Deleted element
validateTest('Deleted/missing element', { action: 'click', selector: '#btn-missing' }, {}, 'ELEMENT_NOT_FOUND');

// Test 3: Stale revision
validateTest('Stale revision', { action: 'click', selector: '#btn-valid', revision: 4 }, { currentRevision: 10 }, 'STALE_REVISION');

// Test 4: Invisible element
validateTest('Invisible element', { action: 'click', selector: '#btn-invisible' }, {}, 'ELEMENT_NOT_FOUND');

// Test 5: Disabled element
validateTest('Disabled element', { action: 'click', selector: '#btn-disabled' }, {}, 'ELEMENT_NOT_INTERACTABLE');

// Test 6: ARIA-disabled element
validateTest('ARIA-disabled element', { action: 'click', selector: '#btn-aria-disabled' }, {}, 'ELEMENT_NOT_INTERACTABLE');

// Test 7: Destructive action rejection (ActionGuard currently allows clicks, let's test a token resolution)
const secretEmail = 'secret@example.com';
const token = window.SentraTokenVault.tokenize('EMAIL', secretEmail);
const resultToken = actionGuard.validate({ action: 'type', selector: '#btn-valid', value_token: token }, {});

if (resultToken.valid && resultToken.resolvedValue === secretEmail) {
  console.log(`✅ SUCCESS: Token typing properly desanitizes to original value strictly locally.`);
} else {
  console.error(`❌ FAILED: Token typing did not desanitize properly.`);
  passed = false;
}

if (passed) {
  console.log('\n🎉 ACTION GUARD VERIFICATION: PASSED.');
  process.exit(0);
} else {
  console.log('\n❌ ACTION GUARD VERIFICATION: FAILED.');
  process.exit(1);
}
