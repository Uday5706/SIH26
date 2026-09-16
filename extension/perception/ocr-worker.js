/**
 * OCR Worker — Optical Character Recognition
 * 
 * Runs OCR to extract text from image regions. Useful for finding PII
 * baked into images or rendered in canvas elements where DOM extraction fails.
 * 
 * Part of the PRIVAGENT LocalPerceptionEngine.
 */

// Using Tesseract.js via CDN for browser-based OCR
importScripts('https://cdn.jsdelivr.net/npm/tesseract.js@5/dist/tesseract.min.js');

let ocrWorker = null;

async function initModel() {
  if (ocrWorker) return;
  console.log('[OCR Worker] Initializing Tesseract.js...');
  
  try {
    ocrWorker = await Tesseract.createWorker('eng', 1, {
      workerPath: 'https://cdn.jsdelivr.net/npm/tesseract.js@5/dist/worker.min.js',
      corePath: 'https://cdn.jsdelivr.net/npm/tesseract.js-core@5.0.0',
      logger: m => {} // suppress progress logs for speed
    });
    console.log('[OCR Worker] Model initialized successfully.');
  } catch (error) {
    console.error('[OCR Worker] Model initialization failed:', error);
    throw error;
  }
}

self.addEventListener('message', async (e) => {
  const { taskId, action, payload } = e.data;

  try {
    if (action === 'init') {
      await initModel();
      self.postMessage({ status: 'ready' });
      return;
    }

    if (action === 'extract') {
      if (!ocrWorker) await initModel();
      
      const imageData = payload.imageData;
      if (!imageData) {
        self.postMessage({ taskId, status: 'success', result: [] });
        return;
      }

      // Run inference
      const { data } = await ocrWorker.recognize(imageData);
      
      // Map Tesseract words to our format
      const result = data.words.map(w => ({
        text: w.text,
        confidence: w.confidence / 100, // Normalize 0-1
        bbox: [
          w.bbox.x0,
          w.bbox.y0,
          w.bbox.x1 - w.bbox.x0, // width
          w.bbox.y1 - w.bbox.y0  // height
        ]
      }));

      self.postMessage({ taskId, status: 'success', result });
    }
  } catch (error) {
    self.postMessage({ taskId, status: 'error', error: error.message || String(error) });
  }
});
