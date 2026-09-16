// Face Detection Worker (MediaPipe FaceDetector / BlazeFace equivalent)
// Strictly constrained to output bounding box and confidence only. NO identity tracking.

importScripts('https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision/vision_bundle.js');

const { FaceDetector, FilesetResolver } = self.Math ? self.mediapipe.tasks.vision : {};

let faceDetector = null;
let isInitializing = false;
let initPromise = null;

async function initializeModel(delegate = "GPU") {
  if (faceDetector) return faceDetector;
  if (isInitializing) return initPromise;

  isInitializing = true;
  initPromise = (async () => {
    try {
      console.log(`[FaceWorker] Loading MediaPipe Vision Tasks (WASM)... Delegate: ${delegate}`);
      const vision = await FilesetResolver.forVisionTasks(
        "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision/wasm"
      );
      
      console.log(`[FaceWorker] Initializing FaceDetector...`);
      faceDetector = await FaceDetector.createFromOptions(vision, {
        baseOptions: {
          modelAssetPath: `https://storage.googleapis.com/mediapipe-models/face_detector/blaze_face_short_range/float16/1/blaze_face_short_range.tflite`,
          delegate: delegate
        },
        runningMode: "IMAGE"
      });
      console.log(`[FaceWorker] Initialization complete.`);
      return faceDetector;
    } catch (error) {
      console.error(`[FaceWorker] Init failed with delegate ${delegate}:`, error);
      // Fallback to CPU if GPU fails
      if (delegate === "GPU") {
        console.log(`[FaceWorker] Retrying with CPU delegate...`);
        return initializeModel("CPU");
      }
      throw error;
    } finally {
      isInitializing = false;
    }
  })();

  return initPromise;
}

self.onmessage = async function(e) {
  const { id, type, payload } = e.data;

  try {
    if (type === 'INIT') {
      const detector = await initializeModel(payload?.delegate || "GPU");
      self.postMessage({ id, status: 'initialized', backend: detector ? (payload?.delegate || "GPU") : "CPU" });
      return;
    }

    if (type === 'DETECT') {
      const detector = await initializeModel();
      const { imageData, width, height } = payload;
      
      // Ensure privacy: The image data lives strictly in this local worker memory
      // and is garbage collected after inference.
      
      const detections = detector.detect(imageData);
      
      // Map to strictly privacy-preserving format (bounding box & confidence only)
      const results = (detections.detections || []).map(d => {
        return {
          confidence: d.categories[0].score,
          bbox: {
            x: d.boundingBox.originX,
            y: d.boundingBox.originY,
            width: d.boundingBox.width,
            height: d.boundingBox.height
          }
        };
      });

      self.postMessage({
        id,
        status: 'success',
        results: results
      });
    }
  } catch (error) {
    self.postMessage({ id, status: 'error', error: error.message });
  }
};
