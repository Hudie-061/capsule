# pose_landmarker_full.task — MediaPipe Pose Landmarker (full)

- Source: https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_full/float16/latest/pose_landmarker_full.task
  (downloaded 16.11.2026, 9 398 198 bytes, SHA-256 `4eaa5eb7a98365221087693fcc286334cf0858e2eb6e15b506aa4a7ecdcec4ad`;
  the file is a zip with `pose_detector.tflite` and `pose_landmarks_detector.tflite`).
- Model card «MediaPipe BlazePose GHUM 3D» (Google, 2021): https://storage.googleapis.com/mediapipe-assets/Model%20Card%20BlazePose%20GHUM%203D.pdf
- License: **Apache License, Version 2.0** (stated in the model card, «Licensed under»).
- Runtime: npm package `@mediapipe/tasks-vision` 1.2.0 (Google, Apache-2.0). Only
  `vision_wasm_internal.js` / `.wasm` are shipped (the SIMD build; every current Android WebView,
  Chrome and Safari support WebAssembly SIMD).

Used by `src/photo-measure.jsx` («Мерки по фото»): the model runs on the phone, the photo never
leaves the device. The model card lists surveillance and identity recognition as out of scope; the
app uses only the body outline and joints to measure the user's own body.
