const fs = require('fs');
const path = require('path');

// Load PrivacyGate
const code = fs.readFileSync(path.join(__dirname, '../extension/background/privacy_gate.js'), 'utf-8');
const scriptWithoutExport = code.replace(/export\s+\{\s*PrivacyGate\s*\}\s*;/g, '');
const PrivacyGate = eval(scriptWithoutExport + '\nPrivacyGate;');

console.log('--- 1. Verification: Privacy Boundary (Outbound Gate) ---');

const rawPayload = {
  goal: "Test privacy boundary",
  dom_snapshot: "<div>Email: alexander.hamilton@example.com, Credit Card: 4532 8921 3401 9921</div>",
  session_id: "sess_12345",
  sensitive_data: {
    apiKey: "dummy_key_do_not_use_12345",
    aadhaar: "2345 6789 1234",
    ssn: "123-45-6789"
  }
};

const result = PrivacyGate.validatePayload(rawPayload);

let passed = true;

// Check Credit Card
if (result.sanitizedPayload.dom_snapshot.includes("4532 8921 3401 9921")) {
  console.error('❌ FAILED: Raw Credit Card leaked through Outbound Gate!');
  passed = false;
} else if (result.sanitizedPayload.dom_snapshot.includes("[BLOCKED_CREDIT_CARD]")) {
  console.log('✅ SUCCESS: Credit Card properly blocked in payload.');
}

// Check API Key
if (result.sanitizedPayload.sensitive_data.apiKey.includes("sk_live_")) {
  console.error('❌ FAILED: Raw API Key leaked through Outbound Gate!');
  passed = false;
} else if (result.sanitizedPayload.sensitive_data.apiKey.includes("[BLOCKED_API_KEY]")) {
  console.log('✅ SUCCESS: API Key properly blocked in payload.');
}

// Check Aadhaar
if (result.sanitizedPayload.sensitive_data.aadhaar.includes("2345 6789 1234")) {
  console.error('❌ FAILED: Raw Aadhaar leaked through Outbound Gate!');
  passed = false;
} else if (result.sanitizedPayload.sensitive_data.aadhaar.includes("[BLOCKED_AADHAAR]")) {
  console.log('✅ SUCCESS: Aadhaar properly blocked in payload.');
}

// Check SSN
if (result.sanitizedPayload.sensitive_data.ssn.includes("123-45-6789")) {
  console.error('❌ FAILED: Raw SSN leaked through Outbound Gate!');
  passed = false;
} else if (result.sanitizedPayload.sensitive_data.ssn.includes("[BLOCKED_SSN]")) {
  console.log('✅ SUCCESS: SSN properly blocked in payload.');
}

console.log(`\nGate Modifications count: ${result.modifications}`);

if (passed) {
  console.log('\n🎉 OUTBOUND GATE VERIFICATION: PASSED.');
  process.exit(0);
} else {
  console.log('\n❌ OUTBOUND GATE VERIFICATION: FAILED.');
  process.exit(1);
}
