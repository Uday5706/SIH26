const fs = require('fs');
const path = require('path');

// 1. Load PrivacyGate
const extDir = path.join(__dirname, '../extension');
const privacyGateCode = fs.readFileSync(path.join(extDir, 'background/privacy_gate.js'), 'utf-8');
const PrivacyGate = eval(privacyGateCode.replace(/export\s+\{\s*PrivacyGate\s*\}\s*;/g, '') + '; PrivacyGate;');

// Enable Verbose Logging temporarily for the test
PrivacyGate.setVerboseLogging(true);

const RAW_PII = {
  email: "john.doe@secret-company.com",
  phone: "+1-555-987-6543",
  creditCard: "4111-1111-1111-1111",
  ssn: "123-45-6789"
};

// 2. Construct an expected Outbound Payload (after TokenVault processing)
// Note: Normally the PageExtractor / TokenVault intercepts emails and phones
// and replaces them with semantic tokens. We'll simulate that for email and phone,
// and leave the CC/SSN raw to ensure the final PrivacyGate catches them.
const preGatePayload = {
  meta: {
    url: "https://secure-bank.example.com/checkout",
    revision: 42,
    timestamp: Date.now()
  },
  elements: [
    {
      id: "sentra-001",
      tagName: "INPUT",
      attributes: {
        type: "email",
        value: "[EMAIL_01]" // Simulated TokenVault output (replaced john.doe@secret-company.com)
      },
      bounds: { x: 10, y: 20, w: 200, h: 40 }
    },
    {
      id: "sentra-002",
      tagName: "INPUT",
      attributes: {
        type: "tel",
        value: "[PHONE_01]" // Simulated TokenVault output (replaced +1-555-987-6543)
      }
    },
    {
      id: "sentra-003",
      tagName: "INPUT",
      attributes: {
        type: "text",
        // Uh oh, this slipped past the TokenVault and is raw!
        value: RAW_PII.creditCard 
      }
    },
    {
      id: "sentra-004",
      tagName: "DIV",
      text: `Your SSN is ${RAW_PII.ssn}` // Raw SSN slipped into text
    }
  ],
  vision: [
    {
      type: "FACE",
      bbox: [100, 100, 50, 50],
      confidence: 0.99
    }
  ]
};

console.log("Running Outbound Payload Verification Test...\n");

// 3. Process through the Outbound Gate
const result = PrivacyGate.validatePayload(preGatePayload);
const serializedOutput = JSON.stringify(result.sanitizedPayload);

console.log("\n--- AUTOMATED ASSERTIONS ---");
let passed = true;

// 4. Assertions
Object.entries(RAW_PII).forEach(([key, rawValue]) => {
  if (serializedOutput.includes(rawValue)) {
    console.error(`❌ ASSERTION FAILED: Raw PII (${key}) leaked into the final outbound payload!`);
    passed = false;
  } else {
    console.log(`✅ ${key} successfully sanitized from outbound payload.`);
  }
});

if (serializedOutput.includes("[EMAIL_01]") && serializedOutput.includes("[PHONE_01]")) {
  console.log(`✅ Semantic Tokens preserved correctly.`);
} else {
  console.error(`❌ ASSERTION FAILED: Semantic tokens were incorrectly destroyed.`);
  passed = false;
}

if (!serializedOutput.includes("[BLOCKED_CREDIT_CARD]") || !serializedOutput.includes("[BLOCKED_SSN]")) {
  console.error(`❌ ASSERTION FAILED: PrivacyGate placeholders missing from payload.`);
  passed = false;
} else {
  console.log(`✅ Deep-scrub placeholders verified.`);
}

console.log("\nVerification " + (passed ? "PASSED" : "FAILED"));

// Reset logging for production readiness
PrivacyGate.setVerboseLogging(false);
process.exit(passed ? 0 : 1);
