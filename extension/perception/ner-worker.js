/**
 * NER Worker — Named Entity Recognition via Transformers.js
 * 
 * Runs a lightweight BERT/MiniLM model in WebAssembly to detect entities
 * like Persons, Organizations, and Locations from raw text (typically from OCR).
 * 
 * Part of the PRIVAGENT LocalPerceptionEngine.
 */

// Import Transformers.js from CDN (in a real extension, this would be bundled)
import { pipeline, env } from 'https://cdn.jsdelivr.net/npm/@xenova/transformers@2.17.1';
import { ModelManager } from './model-manager.js';

const manager = new ModelManager();

let nerPipeline = null;

async function initModel() {
  if (nerPipeline) return;
  console.log('[NER Worker] Initializing Xenova/bert-base-NER...');
  
  try {
    // Configure environment based on capabilities (WebGPU vs WASM)
    await manager.testCapabilities();
    manager.configureEnvironment(env);
    const exactBackend = manager.capabilities.webgpu ? 'WebGPU' : 'WASM';
    nerPipeline = await pipeline('token-classification', 'Xenova/bert-base-NER', {
      device: manager.capabilities.webgpu ? 'webgpu' : 'wasm'
    });
    console.log(`[NER Worker] Model initialized successfully on backend: ${exactBackend}`);
  } catch (error) {
    console.error('[NER Worker] Model initialization failed:', error);
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

    if (action === 'analyze') {
      if (!nerPipeline) await initModel();
      
      const text = payload.text || '';
      if (!text.trim()) {
        self.postMessage({ taskId, status: 'success', result: [] });
        return;
      }

      // Run inference
      const out = await nerPipeline(text);
      
      // The model returns entities grouped by word chunks.
      // We process them to return clean { entity_group, score, word } objects.
      const result = out.map(entity => ({
        entity_group: entity.entity_group || entity.entity,
        score: entity.score,
        word: entity.word.replace(/##/g, '') // Clean subword tokens
      }));

      self.postMessage({ taskId, status: 'success', result });
    }
  } catch (error) {
    self.postMessage({ taskId, status: 'error', error: error.message || String(error) });
  }
});
