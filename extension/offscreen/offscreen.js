/**
 * Offscreen Document Canvas Obfuscator & Merger Engine
 * Performs precision region-level redaction:
 * - HIGH Sensitivity (Password, PIN, OTP, API Key): Tight solid opaque mask
 * - LOW/MODERATE Sensitivity (Email, Phone, Name, Address): Tight localized canvas blur
 * Preserves all surrounding webpage structure, layout, borders, and labels.
 */

(function () {
  console.log('[Privacy Vision Agent] Offscreen Document active.');

  const canvas = document.getElementById('redactionCanvas');
  const ctx = canvas.getContext('2d');

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.action === 'REDACT_CANVAS') {
      const { dataUrl, boundingBoxes, paddingPx = 2, cvEnabled = true } = message.payload;

      processImageAndRedact(dataUrl, boundingBoxes, paddingPx, cvEnabled)
        .then((result) => sendResponse({ success: true, result }))
        .catch((err) => sendResponse({ success: false, error: err.message }));

      return true; // Keep channel open for async response
    }
  });

  async function processImageAndRedact(dataUrl, clientBoxes, paddingPx, cvEnabled) {
    const img = await loadImage(dataUrl);

    canvas.width = img.width;
    canvas.height = img.height;
    ctx.drawImage(img, 0, 0);

    const allBoxes = [...clientBoxes];

    // Tier 3: Run Visual CV Redactor inside Offscreen Canvas if enabled
    if (cvEnabled && window.CVRedactor) {
      try {
        const cvBoxes = window.CVRedactor.detect(canvas);
        allBoxes.push(...cvBoxes);
      } catch (e) {
        console.warn('Tier 3 CV redaction error:', e);
      }
    }

    let redactedCount = 0;
    const categoryCounts = {};

    // 1. Process MODERATE/LOW PII (Localized Blur) first
    allBoxes.filter(b => b.sensitivity !== 'HIGH').forEach((box) => {
      const paddedX = Math.max(0, box.x - paddingPx);
      const paddedY = Math.max(0, box.y - paddingPx);
      const paddedW = Math.min(canvas.width - paddedX, box.width + paddingPx * 2);
      const paddedH = Math.min(canvas.height - paddedY, box.height + paddingPx * 2);

      // Perform localized canvas blur
      ctx.save();
      ctx.beginPath();
      ctx.rect(paddedX, paddedY, paddedW, paddedH);
      ctx.clip();
      ctx.filter = 'blur(10px)';
      ctx.drawImage(canvas, 0, 0);
      ctx.restore();

      // Draw subtle boundary indicator box for visibility in test bench
      ctx.strokeStyle = 'rgba(56, 189, 248, 0.4)';
      ctx.lineWidth = 1;
      ctx.strokeRect(paddedX, paddedY, paddedW, paddedH);

      redactedCount++;
      const cat = box.category || 'PII_TEXT';
      categoryCounts[cat] = (categoryCounts[cat] || 0) + 1;
    });

    // 2. Process HIGH PII (Complete Opaque Masking)
    allBoxes.filter(b => b.sensitivity === 'HIGH').forEach((box) => {
      const paddedX = Math.max(0, box.x - paddingPx);
      const paddedY = Math.max(0, box.y - paddingPx);
      const paddedW = Math.min(canvas.width - paddedX, box.width + paddingPx * 2);
      const paddedH = Math.min(canvas.height - paddedY, box.height + paddingPx * 2);

      ctx.fillStyle = '#0f172a';
      ctx.fillRect(paddedX, paddedY, paddedW, paddedH);

      // Draw high-security badge outline
      ctx.strokeStyle = '#ef4444';
      ctx.lineWidth = 1.5;
      ctx.strokeRect(paddedX, paddedY, paddedW, paddedH);

      redactedCount++;
      const cat = box.category || 'SECRET';
      categoryCounts[cat] = (categoryCounts[cat] || 0) + 1;
    });

    const redactedWebpDataUrl = canvas.toDataURL('image/webp', 0.85);

    return {
      redactedImageWebp: redactedWebpDataUrl,
      redactedCount: redactedCount,
      categoryCounts: categoryCounts,
      boxSummary: allBoxes.map((b) => ({ type: b.type, sensitivity: b.sensitivity, category: b.category }))
    };
  }

  function loadImage(src) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = (err) => reject(err);
      img.src = src;
    });
  }
})();

