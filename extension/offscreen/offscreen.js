/**
 * Offscreen Document Canvas Obfuscator & Merger Engine
 * Combines 3-Tier bounding boxes with +5px padding buffer, paints solid black blackout masks,
 * and encodes final WebP image payload.
 */

(function () {
  console.log('[Privacy Vision Agent] Offscreen Document active.');

  const canvas = document.getElementById('redactionCanvas');
  const ctx = canvas.getContext('2d');

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.action === 'REDACT_CANVAS') {
      const { dataUrl, boundingBoxes, paddingPx = 5, cvEnabled = true } = message.payload;

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

    // Apply Solid Black Masking with +5px Buffer
    ctx.fillStyle = '#000000';
    let redactedCount = 0;

    allBoxes.forEach((box) => {
      const paddedX = Math.max(0, box.x - paddingPx);
      const paddedY = Math.max(0, box.y - paddingPx);
      const paddedW = Math.min(canvas.width - paddedX, box.width + paddingPx * 2);
      const paddedH = Math.min(canvas.height - paddedY, box.height + paddingPx * 2);

      ctx.fillRect(paddedX, paddedY, paddedW, paddedH);
      redactedCount++;
    });

    const redactedWebpDataUrl = canvas.toDataURL('image/webp', 0.85);

    return {
      redactedImageWebp: redactedWebpDataUrl,
      redactedCount: redactedCount,
      boxSummary: allBoxes.map((b) => ({ type: b.type, reason: b.reason }))
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
