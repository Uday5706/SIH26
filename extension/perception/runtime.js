/**
 * Perception Runtime — ML Model Orchestrator
 * 
 * Manages the lifecycle of WebGPU/WASM machine learning models running in Web Workers.
 * Routes tasks to the appropriate model (OCR, NER, Vision) and handles Web Worker IPC.
 * 
 * Part of the PRIVAGENT LocalPerceptionEngine.
 */

export class PerceptionRuntime {
  constructor() {
    this.workers = {
      ocr: null,
      ner: null,
      vision: null
    };
    
    this.pendingTasks = new Map();
    this.taskIdCounter = 0;
    this.modelsLoading = new Map(); // Tracks loading promises
  }

  /**
   * Initializes a specific worker type if not already loaded.
   */
  async ensureWorker(type) {
    if (this.workers[type]) return this.workers[type];

    // Prevent concurrent initialization of the same worker type
    if (this.modelsLoading.has(type)) {
      return this.modelsLoading.get(type);
    }

    const initPromise = new Promise((resolve, reject) => {
      try {
        chrome.runtime.sendMessage({
          action: 'ML_WORKER_TASK',
          type: type,
          payload: { action: 'init' }
        }, (response) => {
          if (chrome.runtime.lastError) {
            reject(new Error(chrome.runtime.lastError.message));
            return;
          }
          if (response && response.status === 'ready') {
            this.workers[type] = true; // Mark as ready
            console.log(`[PerceptionRuntime] ${type} worker ready (Offscreen Proxy).`);
            resolve(true);
          } else {
            reject(new Error(response ? response.error : 'Unknown init error'));
          }
        });
      } catch (err) {
        reject(err);
      }
    });

    this.modelsLoading.set(type, initPromise);

    try {
      await initPromise;
    } finally {
      this.modelsLoading.delete(type);
    }
  }

  /**
   * Execute a specific ML task using the offscreen worker proxy.
   */
  async executeTask(workerType, action, payload = {}) {
    await this.ensureWorker(workerType);

    return new Promise((resolve, reject) => {
      const taskId = String(++this.taskIdCounter);
      
      chrome.runtime.sendMessage({
        action: 'ML_WORKER_TASK',
        type: workerType,
        payload: { taskId, action, payload }
      }, (response) => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
          return;
        }
        
        if (response && response.status === 'success') {
          resolve(response.result);
        } else {
          reject(new Error(response ? response.error : 'Unknown task error'));
        }
      });
    });
  }

  /**
   * Preloads models in the background.
   */
  preloadModels(types = ['ner']) { // Default preload just NER (fastest), delay OCR/Vision until needed
    types.forEach(type => {
      this.ensureWorker(type).catch(e => console.warn(`Preload failed for ${type}:`, e));
    });
  }

  /**
   * Universal message handler for all workers.
   */
  _handleWorkerMessage(e) {
    const { taskId, status, result, error } = e.data;
    
    if (taskId && this.pendingTasks.has(taskId)) {
      const task = this.pendingTasks.get(taskId);
      this.pendingTasks.delete(taskId);
      
      if (status === 'success') {
        task.resolve(result);
      } else {
        task.reject(new Error(error || 'Worker execution failed'));
      }
    }
  }

  terminateAll() {
    Object.keys(this.workers).forEach(type => {
      if (this.workers[type]) {
        this.workers[type].terminate();
        this.workers[type] = null;
      }
    });
    this.pendingTasks.forEach(task => task.reject(new Error('Runtime terminated')));
    this.pendingTasks.clear();
  }
}
