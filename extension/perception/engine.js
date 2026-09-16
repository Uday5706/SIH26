/**
 * Local Perception Engine — Unified ML Perception API
 * 
 * Orchestrates the full perception cascade:
 * 1. Segments the screen via RegionAnalyzer
 * 2. Checks PerceptionCache for visual stability
 * 3. Dispatches tasks to PerceptionRuntime (OCR, NER, Vision)
 * 4. Merges results back into a unified privacy context
 * 
 * Part of the PRIVAGENT privacy firewall layer.
 */

import { RegionAnalyzer } from './region-analyzer.js';
import { PerceptionCache } from './cache.js';
import { PerceptionRuntime } from './runtime.js';

export class LocalPerceptionEngine {
  constructor() {
    this.cache = new PerceptionCache();
    this.runtime = new PerceptionRuntime();
    
    // Preload fast models (NER) in background
    this.runtime.preloadModels(['ner']);
  }

  /**
   * Process a page state and screenshot to detect ML-level privacy risks.
   * 
   * @param {Object} pageState - Structured state from PageExtractor
   * @param {Object} imageData - Raw ImageData of the full viewport screenshot
   * @returns {Array} List of high-confidence ML detections to fuse with DOM rules
   */
  async process(pageState, imageData) {
    if (!pageState || !pageState.elements || !imageData) {
      return [];
    }

    const detections = [];
    const elements = pageState.elements;
    
    // 1. Segment the screen into processable regions
    const viewport = pageState.meta?.viewport || { width: imageData.width, height: imageData.height };
    const regions = RegionAnalyzer.segment(elements, viewport);
    
    console.log(`[PerceptionEngine] Segmented page into ${regions.length} ML processing regions.`);

    // 2. Process each region (in parallel where possible)
    const regionPromises = regions.map(async (region) => {
      const regionDetections = [];
      
      try {
        // Crop image for this specific region
        const regionBbox = [region.x, region.y, region.width, region.height];
        const croppedImageData = RegionAnalyzer.cropImageData(imageData, regionBbox);
        
        // Generate a visual hash to check cache
        const hash = await this.cache.generateImageHash(croppedImageData);
        
        // ------------- OCR PIPELINE -------------
        let textResults = this.cache.get(hash, 'ocr');
        if (!textResults) {
          // Send to OCR worker
          // Pass image data. In a real app, passing ImageBitmap is faster, 
          // but we use ImageData here for simplicity in this stub
          textResults = await this.runtime.executeTask('ocr', 'extract', { 
            imageData: croppedImageData,
            width: region.width,
            height: region.height
          }).catch(e => {
            console.warn('[PerceptionEngine] OCR failed:', e);
            return [];
          });
          this.cache.set(hash, 'ocr', textResults);
        }

        // Adjust OCR bboxes back to absolute viewport coordinates
        const absoluteTextResults = textResults.map(tr => ({
          ...tr,
          bbox: [
            tr.bbox[0] + region.x,
            tr.bbox[1] + region.y,
            tr.bbox[2],
            tr.bbox[3]
          ]
        }));
        
        // ------------- NER PIPELINE -------------
        // Run Named Entity Recognition on any raw text extracted by OCR
        // (DOM text is already handled by pii_dom_scanner/page-extractor, 
        //  but OCR finds text baked into images)
        if (absoluteTextResults.length > 0) {
          const combinedText = absoluteTextResults.map(tr => tr.text).join(' ');
          
          let nerResults = this.cache.get(hash, 'ner');
          if (!nerResults) {
             nerResults = await this.runtime.executeTask('ner', 'analyze', { text: combinedText }).catch(e => {
               console.warn('[PerceptionEngine] NER failed:', e);
               return [];
             });
             this.cache.set(hash, 'ner', nerResults);
          }

          // Map NER results (entities) back to the original OCR bounding boxes
          // (Simplified logic: if entity text matches OCR text, assign that bbox)
          nerResults.forEach(entity => {
             const matchedOcr = absoluteTextResults.find(tr => tr.text.includes(entity.word));
             if (matchedOcr) {
               regionDetections.push({
                 type: entity.entity_group, // e.g. 'PER', 'LOC', 'ORG'
                 source: 'NER',
                 value: entity.word,
                 bbox: matchedOcr.bbox,
                 confidence: entity.score,
                 sensitive: true,
                 sensitivity: this._mapEntityToSensitivity(entity.entity_group)
               });
             }
          });
        }

        // ------------- FACE DETECTION PIPELINE -------------
        // Only run face detection if heuristics flag this region as a photo/image
        if (region.type === 'image' || region.isPhoto) {
          let faceResults = this.cache.get(hash, 'face');
          if (!faceResults) {
             faceResults = await this.runtime.executeTask('face', 'DETECT', { 
               imageData: croppedImageData,
               width: region.width,
               height: region.height
             }).catch(e => {
               console.warn('[PerceptionEngine] Face detection failed:', e);
               return { results: [] };
             });
             this.cache.set(hash, 'face', faceResults.results || []);
             faceResults = faceResults.results || [];
          }

          faceResults.forEach(face => {
            regionDetections.push({
              type: 'FACE',
              source: 'VISION',
              bbox: [
                face.bbox.x + region.x,
                face.bbox.y + region.y,
                face.bbox.width,
                face.bbox.height
              ],
              confidence: face.confidence,
              sensitive: true,
              sensitivity: 'HIGH'
            });
          });
        }

        // ------------- VISION PIPELINE -------------
        // Run specific visual detectors (Credit Cards, general objects) if required
        let visionResults = this.cache.get(hash, 'vision');
        if (!visionResults) {
           visionResults = await this.runtime.executeTask('vision', 'detect', { 
             imageData: croppedImageData,
             width: region.width,
             height: region.height
           }).catch(e => {
             // Vision model might not be loaded if we rely mostly on DOM/OCR
             return [];
           });
           this.cache.set(hash, 'vision', visionResults);
        }

        visionResults.forEach(vr => {
          regionDetections.push({
            type: vr.class, // e.g., 'FACE'
            source: 'VISION',
            bbox: [
              vr.bbox[0] + region.x,
              vr.bbox[1] + region.y,
              vr.bbox[2],
              vr.bbox[3]
            ],
            confidence: vr.score,
            sensitive: true,
            sensitivity: 'HIGH' // Visual PII is usually high sensitivity
          });
        });

      } catch (err) {
        console.error(`[PerceptionEngine] Failed to process region at ${region.x},${region.y}:`, err);
      }
      
      return regionDetections;
    });

    const results = await Promise.all(regionPromises);
    // Flatten array of arrays
    results.forEach(res => detections.push(...res));
    
    return detections;
  }

  /**
   * Translates HuggingFace NER entity groups to Sentra sensitivity levels.
   */
  _mapEntityToSensitivity(entityGroup) {
    switch (entityGroup) {
      case 'PER': return 'MODERATE'; // Person Name
      case 'LOC': return 'MODERATE'; // Location
      case 'ORG': return 'MODERATE'; // Organization
      case 'MISC': return 'LOW'; 
      default: return 'MODERATE';
    }
  }
}
