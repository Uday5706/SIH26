/**
 * Region Analyzer — Visual segmentation for targeted ML
 * 
 * Instead of running ML (OCR/Vision) over the entire screenshot, this module
 * segments the screen into focused regions based on DOM bounding boxes and
 * visual heuristics, drastically reducing WebGPU execution time.
 * 
 * Part of the PRIVAGENT LocalPerceptionEngine.
 */

export class RegionAnalyzer {
  /**
   * Generates optimal crop regions for ML models based on the DOM state.
   * Groups nearby elements into unified regions to minimize the number of ML calls.
   * 
   * @param {Array} elements - DOM elements extracted by PageExtractor
   * @param {Object} viewport - Viewport dimensions { width, height }
   * @returns {Array} List of regions { x, y, width, height, elements[] }
   */
  static segment(elements, viewport) {
    if (!elements || elements.length === 0) return [];

    const regions = [];
    const MAX_REGION_SIZE = 800; // Max WebGPU texture size for fast processing
    const CLUSTER_DISTANCE = 100; // Max distance to cluster elements together

    // Sort elements vertically, then horizontally
    const sorted = [...elements].sort((a, b) => {
      if (Math.abs(a.bbox[1] - b.bbox[1]) < 20) {
        return a.bbox[0] - b.bbox[0]; // Sort horizontally if on same line
      }
      return a.bbox[1] - b.bbox[1]; // Sort vertically
    });

    for (const el of sorted) {
      if (!el.bbox || el.bbox[2] <= 0 || el.bbox[3] <= 0) continue;

      let addedToRegion = false;

      // Try to add to an existing nearby region
      for (const region of regions) {
        const isNearbyX = Math.max(0, Math.max(region.x, el.bbox[0]) - Math.min(region.x + region.width, el.bbox[0] + el.bbox[2])) <= CLUSTER_DISTANCE;
        const isNearbyY = Math.max(0, Math.max(region.y, el.bbox[1]) - Math.min(region.y + region.height, el.bbox[1] + el.bbox[3])) <= CLUSTER_DISTANCE;

        if (isNearbyX && isNearbyY) {
          // Calculate proposed new region size
          const newX = Math.min(region.x, el.bbox[0]);
          const newY = Math.min(region.y, el.bbox[1]);
          const newWidth = Math.max(region.x + region.width, el.bbox[0] + el.bbox[2]) - newX;
          const newHeight = Math.max(region.y + region.height, el.bbox[1] + el.bbox[3]) - newY;

          // Only cluster if it doesn't exceed max model processing size
          if (newWidth <= MAX_REGION_SIZE && newHeight <= MAX_REGION_SIZE) {
            region.x = newX;
            region.y = newY;
            region.width = newWidth;
            region.height = newHeight;
            region.elements.push(el);
            addedToRegion = true;
            break;
          }
        }
      }

      // Create new region if it doesn't fit in existing ones
      if (!addedToRegion) {
        // Add some padding
        const padding = 20;
        const x = Math.max(0, el.bbox[0] - padding);
        const y = Math.max(0, el.bbox[1] - padding);
        const width = Math.min(viewport.width - x, el.bbox[2] + (padding * 2));
        const height = Math.min(viewport.height - y, el.bbox[3] + (padding * 2));

        regions.push({
          x: Math.round(x),
          y: Math.round(y),
          width: Math.round(width),
          height: Math.round(height),
          elements: [el]
        });
      }
    }

    return regions;
  }

  /**
   * Crops an ImageData object to a specific bounding box.
   */
  static cropImageData(imageData, bbox) {
    const [sx, sy, sw, sh] = bbox;
    const canvas = new OffscreenCanvas(sw, sh);
    const ctx = canvas.getContext('2d');
    
    // We need an intermediate canvas to handle the crop natively
    const tempCanvas = new OffscreenCanvas(imageData.width, imageData.height);
    const tempCtx = tempCanvas.getContext('2d');
    tempCtx.putImageData(imageData, 0, 0);

    ctx.drawImage(tempCanvas, sx, sy, sw, sh, 0, 0, sw, sh);
    return ctx.getImageData(0, 0, sw, sh);
  }
}
