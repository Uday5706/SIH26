const fs = require('fs');
const path = require('path');

// Mock browser globals
global.window = global;
global.window.location = { href: 'http://localhost/test' };
global.document = { title: 'Test Page' };

// Load TokenVault
const code = fs.readFileSync(path.join(__dirname, '../extension/privacy/token-vault.js'), 'utf-8');
eval(code);

console.log('--- 2. Verification: Semantic Tokenization Pipeline ---');

const vault = window.SentraTokenVault;
let passed = true;

const testCases = [
  { category: 'EMAIL', value: 'alexander.hamilton@example.com' },
  { category: 'PHONE', value: '+1-555-019-8372' },
  { category: 'PERSON', value: 'Alexander Hamilton' },
  { category: 'PASSWORD', value: 'SuperSecretPassword123!' },
  { category: 'CREDIT_CARD', value: '4532 8921 3401 9921' },
  { category: 'PAN', value: 'ABCDE1234F' },
  { category: 'AADHAAR', value: '1234 5678 9012' },
  { category: 'API_KEY', value: 'sk_live_1234567890abcdef' }
];

testCases.forEach(tc => {
  const token = vault.tokenize(tc.category, tc.value);
  const resolved = vault.resolve(token);
  
  if (token === tc.value) {
    console.error(`❌ FAILED: ${tc.category} was not tokenized. Return was: ${token}`);
    passed = false;
  } else if (!token.includes(tc.category)) {
    console.error(`❌ FAILED: Token for ${tc.category} does not contain category name. Got: ${token}`);
    passed = false;
  } else if (resolved !== tc.value) {
    console.error(`❌ FAILED: ${tc.category} did not resolve correctly. Expected: ${tc.value}, Got: ${resolved}`);
    passed = false;
  } else {
    console.log(`✅ SUCCESS: ${tc.category} tokenized to ${token} and resolved correctly locally.`);
  }
});

// Test Payload absence
const payload = "Hello my email is alexander.hamilton@example.com";
const sanitizedPayload = vault.sanitizeString(payload);

if (sanitizedPayload.includes('alexander.hamilton@example.com')) {
  console.error('❌ FAILED: sanitizeString leaked raw value.');
  passed = false;
} else if (sanitizedPayload.includes('[EMAIL_01]')) {
  console.log('✅ SUCCESS: Payload properly scrubbed using Token Vault mappings.');
}

if (passed) {
  console.log('\n🎉 SEMANTIC TOKENIZATION VERIFICATION: PASSED.');
  process.exit(0);
} else {
  console.log('\n❌ SEMANTIC TOKENIZATION VERIFICATION: FAILED.');
  process.exit(1);
}
