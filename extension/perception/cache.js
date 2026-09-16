/**
 * Perception Cache — Region-based hashing for ML results
 * 
 * Prevents redundant ML execution (OCR, NER, Vision) by hashing image regions.
 * If a region hasn't visually changed (based on pixel hash or element properties),
 * we reuse the previous ML detection results.
 * 
 * Part of the PRIVAGENT LocalPerceptionEngine.
 */

export class PerceptionCache {
  constructor(maxEntries = 1000) {
    this.cache = new Map();
    this.maxEntries = maxEntries;
  }

  /**
   * Generate a stable hash for a specific DOM element's visual state.
   */
  generateElementHash(elementState) {
    // Basic hash based on position, size, value, and styling
    const parts = [
      elementState.id,
      Math.round(elementState.bbox[0]),
      Math.round(elementState.bbox[1]),
      Math.round(elementState.bbox[2]),
      Math.round(elementState.bbox[3]),
      elementState.value || '',
      elementState.type || '',
      elementState.label || ''
    ];
    return this._cyrb53(parts.join('|'));
  }

  /**
   * Generate a hash for an image blob or ImageData.
   * (Simplified approximation for WebGPU cache hits)
   */
  async generateImageHash(imageData) {
    // In a real implementation, we would sample pixels or use a fast perceptual hash.
    // Here we use a basic checksum of the first/last/middle bytes.
    if (!imageData || !imageData.data) return 'empty_image';
    
    const d = imageData.data;
    const len = d.length;
    if (len === 0) return 'empty_image';
    
    const sample = [
      d[0], d[1], d[2],
      d[Math.floor(len/2)], d[Math.floor(len/2)+1], d[Math.floor(len/2)+2],
      d[len-4], d[len-3], d[len-2],
      len
    ];
    
    return this._cyrb53(sample.join(','));
  }

  get(hash, taskType) {
    const key = `${taskType}_${hash}`;
    const entry = this.cache.get(key);
    if (entry) {
      entry.lastUsed = Date.now();
      return entry.result;
    }
    return null;
  }

  set(hash, taskType, result) {
    const key = `${taskType}_${hash}`;
    
    // Evict oldest if at capacity
    if (this.cache.size >= this.maxEntries) {
      let oldestKey = null;
      let oldestTime = Infinity;
      for (const [k, v] of this.cache.entries()) {
        if (v.lastUsed < oldestTime) {
          oldestTime = v.lastUsed;
          oldestKey = k;
        }
      }
      if (oldestKey) this.cache.delete(oldestKey);
    }
    
    this.cache.set(key, {
      result,
      timestamp: Date.now(),
      lastUsed: Date.now()
    });
  }

  clear() {
    this.cache.clear();
  }

  // Fast 53-bit string hash (cyrb53)
  _cyrb53(str, seed = 0) {
    let h1 = 0xdeadbeef ^ seed, h2 = 0x41c6ce57 ^ seed;
    for (let i = 0, ch; i < str.length; i++) {
      ch = str.charCodeAt(i);
      h1 = Math.imul(h1 ^ ch, 2654435761);
      h2 = Math.imul(h2 ^ ch, 1597334677);
    }
    h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507);
    h1 ^= Math.imul(h2 ^ (h2 >>> 13), 3266489909);
    h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507);
    h2 ^= Math.imul(h1 ^ (h1 >>> 13), 3266489909);
    return 4294967296 * (2097151 & h2) + (h1 >>> 0);
  }
}
