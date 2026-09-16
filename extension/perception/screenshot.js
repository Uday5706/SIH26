/**
 * Perception Screenshot & Redaction
 * Handles capturing screenshots and drawing privacy redactions (blur/mask)
 * using OffscreenCanvas without blocking the main thread.
 */

export async function captureAndRedactScreenshot(tabId, windowId, boundingBoxes = [], paddingPx = 2) {
  let rawScreenshotDataUrl = '';
  try {
    if (windowId) {
      rawScreenshotDataUrl = await chrome.tabs.captureVisibleTab(windowId, { format: 'png' });
    }
  } catch (e) {
    console.warn('captureVisibleTab by windowId failed:', e);
  }

  if (!rawScreenshotDataUrl) {
    try {
      rawScreenshotDataUrl = await chrome.tabs.captureVisibleTab(null, { format: 'png' });
    } catch (e) {
      console.warn('captureVisibleTab with null failed:', e);
      return { redactedImageWebp: '', redactedCount: 0, categoryCounts: {} };
    }
  }

  if (!rawScreenshotDataUrl) {
    return { redactedImageWebp: '', redactedCount: 0, categoryCounts: {} };
  }

  try {
    const base64Data = rawScreenshotDataUrl.split(',')[1];
    const binaryStr = atob(base64Data);
    const len = binaryStr.length;
    const bytes = new Uint8Array(len);
    for (let i = 0; i < len; i++) {
      bytes[i] = binaryStr.charCodeAt(i);
    }
    const blob = new Blob([bytes], { type: 'image/png' });
    const imageBitmap = await createImageBitmap(blob);

    const canvas = new OffscreenCanvas(imageBitmap.width, imageBitmap.height);
    const ctx = canvas.getContext('2d');
    ctx.drawImage(imageBitmap, 0, 0);

    let redactedCount = 0;
    const categoryCounts = {};

    // 1. Moderate/Low sensitivity: localized blur
    boundingBoxes.filter(b => b.sensitivity !== 'HIGH').forEach(box => {
      const paddedX = Math.max(0, box.x - paddingPx);
      const paddedY = Math.max(0, box.y - paddingPx);
      const paddedW = Math.min(canvas.width - paddedX, box.width + paddingPx * 2);
      const paddedH = Math.min(canvas.height - paddedY, box.height + paddingPx * 2);

      ctx.save();
      ctx.beginPath();
      ctx.rect(paddedX, paddedY, paddedW, paddedH);
      ctx.clip();
      ctx.filter = 'blur(10px)';
      ctx.drawImage(canvas, 0, 0);
      ctx.restore();

      ctx.strokeStyle = 'rgba(56, 189, 248, 0.5)';
      ctx.lineWidth = 1;
      ctx.strokeRect(paddedX, paddedY, paddedW, paddedH);

      redactedCount++;
      const cat = box.category || box.type || 'PII_TEXT';
      categoryCounts[cat] = (categoryCounts[cat] || 0) + 1;
    });

    // 2. High sensitivity: solid opaque black mask
    boundingBoxes.filter(b => b.sensitivity === 'HIGH').forEach(box => {
      const paddedX = Math.max(0, box.x - paddingPx);
      const paddedY = Math.max(0, box.y - paddingPx);
      const paddedW = Math.min(canvas.width - paddedX, box.width + paddingPx * 2);
      const paddedH = Math.min(canvas.height - paddedY, box.height + paddingPx * 2);

      ctx.fillStyle = '#0f172a';
      ctx.fillRect(paddedX, paddedY, paddedW, paddedH);

      ctx.strokeStyle = '#ef4444';
      ctx.lineWidth = 1.5;
      ctx.strokeRect(paddedX, paddedY, paddedW, paddedH);

      redactedCount++;
      const cat = box.category || box.type || 'SECRET';
      categoryCounts[cat] = (categoryCounts[cat] || 0) + 1;
    });

    const outBlob = await canvas.convertToBlob({ type: 'image/webp', quality: 0.85 });
    const buffer = await outBlob.arrayBuffer();
    let binary = '';
    const outBytes = new Uint8Array(buffer);
    const outLen = outBytes.byteLength;
    for (let i = 0; i < outLen; i++) {
      binary += String.fromCharCode(outBytes[i]);
    }
    const redactedDataUrl = `data:image/webp;base64,${btoa(binary)}`;

    return {
      redactedImageWebp: redactedDataUrl,
      redactedCount,
      categoryCounts
    };
  } catch (err) {
    console.warn('Native OffscreenCanvas redaction fallback:', err);
    return {
      redactedImageWebp: rawScreenshotDataUrl,
      redactedCount: 0,
      categoryCounts: {}
    };
  }
}
