// MediaPipe Pose Landmarker (@mediapipe/tasks-vision, Google, Apache-2.0; model pose_landmarker_full.task,
// Apache-2.0, see src/assets/MEDIAPIPE-LICENSE.md). Two instances share the same model file:
// - photos: one image at a time, with the person's outline (mask) for measuring;
// - live: the camera video, joints only, for the spoken hints while the person gets into pose.
// The library (~15 MB) and the model (~9 MB) load only on «Мерки по фото», once.
import poseModelUrl from "../assets/pose_landmarker_full.task?url";
import wasmLoaderUrl from "@mediapipe/tasks-vision/vision_wasm_internal.js?url";
import wasmBinaryUrl from "@mediapipe/tasks-vision/vision_wasm_internal.wasm?url";

const absolute = (url) => new URL(url, document.baseURI).href;

function create(options) {
  return import("@mediapipe/tasks-vision").then(({ PoseLandmarker }) => PoseLandmarker.createFromOptions(
    { wasmLoaderPath: absolute(wasmLoaderUrl), wasmBinaryPath: absolute(wasmBinaryUrl) },
    { baseOptions: { modelAssetPath: absolute(poseModelUrl), delegate: "CPU" }, ...options },
  ));
}

let photoPromise = null;
export function loadPhotoLandmarker() {
  photoPromise ??= create({ runningMode: "IMAGE", numPoses: 2, outputSegmentationMasks: true })
    .catch((error) => { photoPromise = null; throw error; });
  return photoPromise;
}

let livePromise = null;
export function loadLiveLandmarker() {
  livePromise ??= create({ runningMode: "VIDEO", numPoses: 1, outputSegmentationMasks: false })
    .catch((error) => { livePromise = null; throw error; });
  return livePromise;
}
