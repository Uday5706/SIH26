/**
 * Model Manager & Infrastructure Tester
 * 
 * Handles offline model caching via IndexedDB, capability testing 
 * (WebGPU vs WASM fallback), and explicit preloading.
 * 
 * Part of the PRIVAGENT LocalPerceptionEngine.
 */

export class ModelManager {
  constructor() {
    this.capabilities = {
      webgpu: false,
      wasm: true, // Generally assumed true in modern browsers
      webgl: false
    };
  }

  /**
   * Tests the browser environment for WebGPU and WebGL capabilities.
   * This helps the runtime decide which backend to force if necessary.
   */
  async testCapabilities() {
    // Check WebGPU
    if (navigator.gpu) {
      try {
        const adapter = await navigator.gpu.requestAdapter();
        if (adapter) {
          this.capabilities.webgpu = true;
          console.log('[ModelManager] WebGPU is supported and available.');
        } else {
          console.warn('[ModelManager] navigator.gpu exists, but no adapter found.');
        }
      } catch (e) {
        console.warn('[ModelManager] WebGPU requestAdapter failed:', e);
      }
    } else {
      console.log('[ModelManager] WebGPU is NOT supported in this browser.');
    }

    // Check WebGL fallback
    try {
      const canvas = new OffscreenCanvas(1, 1);
      const gl = canvas.getContext('webgl2') || canvas.getContext('webgl');
      if (gl) {
        this.capabilities.webgl = true;
        console.log('[ModelManager] WebGL is available as a fallback.');
      }
    } catch (e) {
      console.warn('[ModelManager] WebGL check failed:', e);
    }

    return this.capabilities;
  }

  /**
   * Configures Transformers.js environment based on capabilities.
   * Note: This must be called inside the Web Worker before pipeline initialization.
   */
  configureEnvironment(env) {
    // Prefer WebGPU if available, fallback to WASM
    // ONNX Runtime Web defaults to WASM, but can be forced to WebGPU
    env.allowLocalModels = false; // We use CDN for now, cached in IndexedDB
    
    // Default caching is handled by Transformers.js via Cache API / IndexedDB
    env.useBrowserCache = true;
    
    if (this.capabilities.webgpu) {
      // Future-proofing for when Transformers.js fully supports WebGPU backend selection easily
      // env.backends.onnx.wasm.proxy = true;
      console.log('[ModelManager] Environment configured preferring WebGPU.');
    } else {
      env.backends.onnx.wasm.numThreads = Math.min(4, navigator.hardwareConcurrency || 1);
      console.log(`[ModelManager] Environment configured for WASM fallback with ${env.backends.onnx.wasm.numThreads} threads.`);
    }
  }

  /**
   * Explicitly clear the model cache if it gets corrupted or needs an update.
   */
  async clearCache() {
    try {
      const cacheKeys = await caches.keys();
      for (const key of cacheKeys) {
        if (key.includes('transformers-cache')) {
          await caches.delete(key);
          console.log(`[ModelManager] Deleted cache: ${key}`);
        }
      }
      return true;
    } catch (e) {
      console.error('[ModelManager] Failed to clear cache:', e);
      return false;
    }
  }

  /**
   * Estimate the size of the cached models (requires StorageManager API).
   */
  async getCacheUsage() {
    if (navigator.storage && navigator.storage.estimate) {
      const estimate = await navigator.storage.estimate();
      return {
        usageMB: (estimate.usage / (1024 * 1024)).toFixed(2),
        quotaMB: (estimate.quota / (1024 * 1024)).toFixed(2)
      };
    }
    return null;
  }
}
