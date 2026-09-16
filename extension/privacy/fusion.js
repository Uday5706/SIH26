/**
 * Privacy Fusion — Multi-detector result merging and deduplication
 * 
 * Combines detection results from all sources (DOM, regex, OCR, NER, vision)
 * into a unified format. Deduplicates overlapping detections on the same region
 * and applies the privacy policy to make final redaction decisions.
 * 
 * Produces the final sanitized state that can be sent over the network.
 * 
 * Part of the PRIVAGENT privacy firewall layer.
 */

window.SentraPrivacyFusion = (function () {
  'use strict';

  // ── Unified Detection Format ───────────────────────────────────────
  // All detectors must produce results in this format (or be adapted to it)

  /**
   * @typedef {Object} Detection
   * @property {string} type - PII category (EMAIL, PHONE, PERSON, FACE, etc.)
   * @property {string} source - Detector source (DOM, REGEX, OCR, NER, VISION, FACE)
   * @property {string} [value] - The detected value (may be absent for visual detections)
   * @property {number[]} [bbox] - Bounding box [x, y, width, height] in viewport coords
   * @property {number} confidence - Detection confidence [0, 1]
   * @property {boolean} sensitive - Whether this is sensitive
   * @property {string} sensitivity - Sensitivity level (HIGH, MODERATE, LOW, NONE)
   * @property {string} [elementId] - Associated element ID if from DOM
   * @property {string} [selector] - CSS selector if from DOM
   * @property {Object} [metadata] - Additional detector-specific metadata
   */

  // ── Deduplication ──────────────────────────────────────────────────

  /**
   * Check if two bounding boxes overlap significantly (IoU > threshold).
   */
  function bboxOverlap(bbox1, bbox2, threshold = 0.5) {
    if (!bbox1 || !bbox2 || bbox1.length < 4 || bbox2.length < 4) return false;

    const [x1, y1, w1, h1] = bbox1;
    const [x2, y2, w2, h2] = bbox2;

    const overlapX = Math.max(0, Math.min(x1 + w1, x2 + w2) - Math.max(x1, x2));
    const overlapY = Math.max(0, Math.min(y1 + h1, y2 + h2) - Math.max(y1, y2));
    const overlapArea = overlapX * overlapY;

    const area1 = w1 * h1;
    const area2 = w2 * h2;
    const unionArea = area1 + area2 - overlapArea;

    if (unionArea <= 0) return false;
    return (overlapArea / unionArea) >= threshold;
  }

  /**
   * Check if two detections are duplicates (same region + same or compatible type).
   */
  function isDuplicate(d1, d2) {
    // Same value
    if (d1.value && d2.value && d1.value === d2.value) return true;

    // Same element
    if (d1.elementId && d2.elementId && d1.elementId === d2.elementId) return true;

    // Overlapping bboxes with compatible types
    if (d1.bbox && d2.bbox && bboxOverlap(d1.bbox, d2.bbox)) {
      // Same or compatible category
      if (d1.type === d2.type) return true;
      // Both are PII-text types
      const textTypes = new Set(['EMAIL', 'PHONE', 'NAME', 'ADDRESS', 'PII_TEXT']);
      if (textTypes.has(d1.type) && textTypes.has(d2.type)) return true;
    }

    return false;
  }

  /**
   * Merge two duplicate detections into one, keeping the higher-confidence one
   * and combining metadata from both.
   */
  function mergeDetections(d1, d2) {
    const primary = d1.confidence >= d2.confidence ? d1 : d2;
    const secondary = d1.confidence >= d2.confidence ? d2 : d1;

    return {
      ...primary,
      // Boost confidence when multiple detectors agree
      confidence: Math.min(1.0, primary.confidence + (secondary.confidence * 0.1)),
      // Track all sources
      sources: [...new Set([
        ...(primary.sources || [primary.source]),
        ...(secondary.sources || [secondary.source])
      ])],
      // Use the more specific type
      type: getMoreSpecificType(primary.type, secondary.type),
      // Use higher sensitivity
      sensitivity: getHigherSensitivity(primary.sensitivity, secondary.sensitivity),
      metadata: {
        ...(secondary.metadata || {}),
        ...(primary.metadata || {}),
        mergedFrom: [primary.source, secondary.source]
      }
    };
  }

  function getMoreSpecificType(t1, t2) {
    const specificity = {
      'PII_TEXT': 0, 'GENERAL': 0,
      'NAME': 1, 'ADDRESS': 1, 'LOCATION': 1,
      'EMAIL': 2, 'PHONE': 2, 'DOB': 2,
      'GOVT_ID': 3, 'CREDIT_CARD': 3,
      'PASSWORD': 4, 'CVV': 4, 'OTP': 4, 'PIN': 4,
      'API_KEY': 5, 'TOKEN': 5, 'PRIVATE_KEY': 5,
      'FACE': 6
    };
    return (specificity[t1] || 0) >= (specificity[t2] || 0) ? t1 : t2;
  }

  function getHigherSensitivity(s1, s2) {
    const levels = { 'NONE': 0, 'LOW': 1, 'MODERATE': 2, 'HIGH': 3 };
    return (levels[s1] || 0) >= (levels[s2] || 0) ? s1 : s2;
  }

  // ── Fusion Pipeline ────────────────────────────────────────────────

  /**
   * Fuse detections from multiple sources into a deduplicated, policy-applied result.
   * 
   * @param {Detection[]} detections - Raw detections from all sources
   * @returns {Object} Fused result with detections, tokens, and statistics
   */
  function fuse(detections) {
    if (!detections || detections.length === 0) {
      return {
        detections: [],
        tokenized: [],
        statistics: { total: 0, deduplicated: 0, tokenized: 0, redacted: 0, passed: 0 }
      };
    }

    // 1. Normalize all detections
    const normalized = detections.map(normalizeDetection);

    // 2. Deduplicate overlapping/duplicate detections
    const deduplicated = deduplicateDetections(normalized);

    // 3. Apply privacy policy to each detection
    const withDecisions = deduplicated.map(det => {
      const decision = window.SentraPrivacyPolicy
        ? window.SentraPrivacyPolicy.decide(det)
        : defaultDecide(det);
      return { ...det, decision };
    });

    // 4. Tokenize values that should be tokenized
    const tokenized = [];
    const vault = window.SentraTokenVault;

    withDecisions.forEach(det => {
      if (det.decision.tokenize && det.value && vault) {
        const token = vault.tokenize(det.type, det.value, {
          elementId: det.elementId,
          selector: det.selector,
          sensitivity: det.sensitivity
        });
        tokenized.push({
          ...det,
          token,
          originalValue: det.value,
          sanitizedValue: token
        });
      } else {
        tokenized.push({
          ...det,
          token: null,
          sanitizedValue: det.value
        });
      }
    });

    // 5. Compile statistics
    const statistics = {
      total: detections.length,
      deduplicated: deduplicated.length,
      tokenized: tokenized.filter(t => t.token !== null).length,
      redacted: withDecisions.filter(d => d.decision.redact).length,
      passed: withDecisions.filter(d => d.decision.action === 'PASS').length,
      byCategory: {},
      bySource: {},
      bySensitivity: { HIGH: 0, MODERATE: 0, LOW: 0, NONE: 0 }
    };

    tokenized.forEach(t => {
      statistics.byCategory[t.type] = (statistics.byCategory[t.type] || 0) + 1;
      statistics.bySource[t.source] = (statistics.bySource[t.source] || 0) + 1;
      if (statistics.bySensitivity[t.sensitivity] !== undefined) {
        statistics.bySensitivity[t.sensitivity]++;
      }
    });

    return { detections: tokenized, statistics };
  }

  /**
   * Normalize a detection to the standard format.
   */
  function normalizeDetection(det) {
    return {
      type: (det.type || det.category || 'GENERAL').toUpperCase(),
      source: (det.source || 'UNKNOWN').toUpperCase(),
      value: det.value || null,
      bbox: det.bbox || null,
      confidence: det.confidence !== undefined ? det.confidence : 0.5,
      sensitive: det.sensitive !== undefined ? det.sensitive : true,
      sensitivity: det.sensitivity || 'MODERATE',
      elementId: det.elementId || det.element_id || null,
      selector: det.selector || null,
      metadata: det.metadata || {}
    };
  }

  /**
   * Deduplicate a list of detections by merging overlapping ones.
   */
  function deduplicateDetections(detections) {
    const result = [];
    const merged = new Set();

    for (let i = 0; i < detections.length; i++) {
      if (merged.has(i)) continue;

      let current = detections[i];
      for (let j = i + 1; j < detections.length; j++) {
        if (merged.has(j)) continue;
        if (isDuplicate(current, detections[j])) {
          current = mergeDetections(current, detections[j]);
          merged.add(j);
        }
      }
      result.push(current);
    }

    return result;
  }

  /**
   * Default policy decision when SentraPrivacyPolicy is not available.
   * Fail-closed: treat everything as sensitive.
   */
  function defaultDecide(det) {
    return {
      action: det.sensitive ? 'TOKENIZE' : 'PASS',
      reason: 'Default fail-closed policy',
      tokenize: det.sensitive,
      redact: det.sensitive,
      visualRedaction: det.sensitivity === 'HIGH' ? 'opaque_mask' : 'blur',
      sensitivity: det.sensitivity,
      needsVerification: false
    };
  }

  // ── Adapter Functions ──────────────────────────────────────────────
  // Convert outputs from existing scanners to the unified Detection format

  /**
   * Adapt DOM scanner bounding boxes to Detection format.
   */
  function adaptDOMBoundingBoxes(boundingBoxes) {
    return (boundingBoxes || []).map(bb => ({
      type: bb.category || 'PII_TEXT',
      source: 'DOM',
      value: bb.dummyValue || null, // The original value is in the vault
      bbox: [bb.x, bb.y, bb.width, bb.height],
      confidence: 0.95, // DOM detection is high confidence
      sensitive: true,
      sensitivity: bb.sensitivity || 'MODERATE',
      metadata: { reason: bb.reason, placeholder: bb.placeholder }
    }));
  }

  /**
   * Adapt text scanner bounding boxes to Detection format.
   */
  function adaptTextBoundingBoxes(boundingBoxes) {
    return (boundingBoxes || []).map(bb => ({
      type: bb.category || 'PII_TEXT',
      source: 'REGEX',
      value: null, // Text scanner doesn't capture the value, just bbox
      bbox: [bb.x, bb.y, bb.width, bb.height],
      confidence: 0.90,
      sensitive: true,
      sensitivity: bb.sensitivity || 'MODERATE',
      metadata: { reason: bb.reason, placeholder: bb.placeholder }
    }));
  }

  /**
   * Adapt page extractor elements to Detection format.
   * Only includes sensitive elements.
   */
  function adaptPageElements(elements) {
    return (elements || [])
      .filter(el => el.sensitive)
      .map(el => ({
        type: el.category,
        source: 'DOM',
        value: el.value || null,
        bbox: el.bbox,
        confidence: el.confidence || 0.92,
        sensitive: true,
        sensitivity: el.sensitivity,
        elementId: el.id,
        selector: el.selector,
        metadata: { label: el.label, role: el.role, tag: el.tag }
      }));
  }

  /**
   * Adapt OCR results to Detection format.
   * OCR produces text + bbox; sensitivity comes from regex/NER post-processing.
   */
  function adaptOCRResults(ocrResults) {
    return (ocrResults || []).map(ocr => ({
      type: ocr.piiType || 'OCR_TEXT',
      source: 'OCR',
      value: ocr.text,
      bbox: ocr.bbox,
      confidence: ocr.confidence || 0.80,
      sensitive: ocr.sensitive !== undefined ? ocr.sensitive : false,
      sensitivity: ocr.sensitivity || 'NONE',
      metadata: { rawOCRConfidence: ocr.ocrConfidence }
    }));
  }

  /**
   * Adapt face detection results to Detection format.
   */
  function adaptFaceResults(faceResults) {
    return (faceResults || []).map(face => ({
      type: 'FACE',
      source: 'FACE',
      value: null,
      bbox: face.bbox,
      confidence: face.confidence || 0.90,
      sensitive: true,
      sensitivity: 'HIGH',
      metadata: {}
    }));
  }

  return {
    fuse,
    normalizeDetection,
    deduplicateDetections,

    // Adapters
    adaptDOMBoundingBoxes,
    adaptTextBoundingBoxes,
    adaptPageElements,
    adaptOCRResults,
    adaptFaceResults,

    // Utilities
    bboxOverlap,
    isDuplicate,
    mergeDetections
  };
})();
