// Browser replacement for the sharp-based image pipeline of the original server.
// Same algorithms (crop with padding, chroma-key removal with spill suppression,
// framing on a square transparent canvas), implemented on canvas ImageData.

function makeCanvas(width, height) {
  if (typeof OffscreenCanvas !== "undefined") return new OffscreenCanvas(width, height);
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  return canvas;
}

async function canvasToBlob(canvas, type = "image/png", quality) {
  if (canvas.convertToBlob) return canvas.convertToBlob({ type, quality });
  return new Promise((resolve) => canvas.toBlob(resolve, type, quality));
}

export async function loadBitmap(blob) {
  return createImageBitmap(blob, { imageOrientation: "from-image" });
}

// Upright sRGB PNG, longest side capped (keeps uploads and API payloads reasonable).
export async function normalizeImage(blob, maxSide = 2048) {
  const bitmap = await loadBitmap(blob);
  const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height));
  const width = Math.max(1, Math.round(bitmap.width * scale));
  const height = Math.max(1, Math.round(bitmap.height * scale));
  const canvas = makeCanvas(width, height);
  canvas.getContext("2d").drawImage(bitmap, 0, 0, width, height);
  bitmap.close?.();
  return canvasToBlob(canvas);
}

export async function imageSize(blob) {
  const bitmap = await loadBitmap(blob);
  const size = { width: bitmap.width, height: bitmap.height };
  bitmap.close?.();
  return size;
}

// box: { x, y, width, height } normalised to a 1000x1000 grid.
export async function cropDetectedItem(blob, box) {
  const bitmap = await loadBitmap(blob);
  const { width, height } = bitmap;
  const rawLeft = (box.x / 1000) * width;
  const rawTop = (box.y / 1000) * height;
  const rawWidth = (box.width / 1000) * width;
  const rawHeight = (box.height / 1000) * height;
  const padding = Math.max(12, Math.round(Math.max(rawWidth, rawHeight) * 0.08));
  const left = Math.max(0, Math.floor(rawLeft - padding));
  const top = Math.max(0, Math.floor(rawTop - padding));
  const right = Math.min(width, Math.ceil(rawLeft + rawWidth + padding));
  const bottom = Math.min(height, Math.ceil(rawTop + rawHeight + padding));
  const w = Math.max(1, right - left);
  const h = Math.max(1, bottom - top);
  const canvas = makeCanvas(w, h);
  canvas.getContext("2d").drawImage(bitmap, left, top, w, h, 0, 0, w, h);
  bitmap.close?.();
  return canvasToBlob(canvas);
}

export async function blobToBase64(blob) {
  const buffer = new Uint8Array(await blob.arrayBuffer());
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < buffer.length; i += chunk) binary += String.fromCharCode(...buffer.subarray(i, i + chunk));
  return btoa(binary);
}

export function base64ToBlob(base64, mime = "image/png") {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return new Blob([bytes], { type: mime });
}

export function dataUrlToBlob(dataUrl) {
  const match = String(dataUrl).match(/^data:([^;]+);base64,(.+)$/s);
  if (!match) throw new Error("Expected an image data URL");
  return base64ToBlob(match[2], match[1]);
}

const HEX = /^#[0-9a-f]{6}$/i;

export function chooseChromaKey(primary = "#808080") {
  const value = HEX.test(primary) ? primary : "#808080";
  const source = [1, 3, 5].map((o) => Number.parseInt(value.slice(o, o + 2), 16));
  const candidates = [[0, 255, 0], [255, 0, 255], [0, 255, 255]];
  const distance = (c) => c.reduce((t, ch, i) => t + ((ch - source[i]) ** 2), 0);
  const selected = candidates.sort((a, b) => distance(b) - distance(a))[0];
  return `#${selected.map((c) => c.toString(16).padStart(2, "0")).join("")}`;
}

export function cleanupTolerance(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(18, Math.min(110, Math.round(parsed))) : 46;
}

function keyChannels(key) {
  const target = [1, 3, 5].map((o) => Number.parseInt(key.slice(o, o + 2), 16));
  return {
    target,
    keyed: target.map((c, i) => (c > 200 ? i : null)).filter((i) => i !== null),
    neutral: target.map((c, i) => (c < 55 ? i : null)).filter((i) => i !== null),
  };
}

function removeKeyedSpill(data, index, keyed, neutralLevel) {
  let remaining = Math.ceil(keyed.reduce((t, c) => t + data[index + c], 0) - (neutralLevel * keyed.length));
  let active = keyed.filter((c) => data[index + c] > 0);
  while (remaining > 0 && active.length) {
    const share = Math.ceil(remaining / active.length);
    const next = [];
    for (const c of active) {
      const reduction = Math.min(data[index + c], share, remaining);
      data[index + c] -= reduction;
      remaining -= reduction;
      if (data[index + c] > 0) next.push(c);
    }
    active = next;
  }
}

const level = (data, index, channels) => channels.reduce((t, c) => t + data[index + c], 0) / channels.length;

// Pure function on RGBA pixels so it can be unit-tested outside the browser.
export function keyPixels(data, key, tolerance) {
  const { target, keyed, neutral } = keyChannels(key);
  const feather = 80;
  for (let i = 0; i < data.length; i += 4) {
    const distance = Math.sqrt(((data[i] - target[0]) ** 2) + ((data[i + 1] - target[1]) ** 2) + ((data[i + 2] - target[2]) ** 2));
    if (distance <= tolerance) {
      data[i] = data[i + 1] = data[i + 2] = data[i + 3] = 0;
      continue;
    }
    if (distance < tolerance + feather) data[i + 3] = Math.round(data[i + 3] * ((distance - tolerance) / feather));
    const spill = Math.max(0, level(data, i, keyed) - level(data, i, neutral));
    if (spill > 0) {
      data[i + 3] = Math.round(data[i + 3] * Math.max(0, 1 - (Math.max(0, spill - 4) / 150)));
      removeKeyedSpill(data, i, keyed, level(data, i, neutral));
    }
    if (data[i + 3] <= 8) data[i] = data[i + 1] = data[i + 2] = data[i + 3] = 0;
  }
  despill(data, key);
  return data;
}

export function despill(data, key) {
  const { keyed, neutral } = keyChannels(key);
  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3] === 0) continue;
    const neutralLevel = level(data, i, neutral);
    if (level(data, i, keyed) - neutralLevel > 0) removeKeyedSpill(data, i, keyed, neutralLevel);
  }
  return data;
}

export function spillReport(data, key) {
  const { keyed, neutral } = keyChannels(key);
  let contaminatedPixels = 0;
  let maxSpill = 0;
  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3] === 0) continue;
    const spill = Math.max(0, level(data, i, keyed) - level(data, i, neutral));
    maxSpill = Math.max(maxSpill, spill);
    if (spill > 1.5) contaminatedPixels += 1;
  }
  return { contaminatedPixels, maxSpill };
}

export function alphaBounds(data, width, height) {
  let minX = width; let minY = height; let maxX = -1; let maxY = -1;
  for (let i = 0, p = 0; i < data.length; i += 4, p += 1) {
    if (data[i + 3] <= 8) continue;
    const x = p % width; const y = Math.floor(p / width);
    if (x < minX) minX = x; if (y < minY) minY = y;
    if (x > maxX) maxX = x; if (y > maxY) maxY = y;
  }
  return maxX < minX ? null : { minX, minY, maxX, maxY };
}

// Trim to the visible garment and centre it on a square transparent canvas.
export async function frameTransparent(canvasIn, size = 1024, occupancy = 0.88) {
  const ctx = canvasIn.getContext("2d");
  const { width, height } = canvasIn;
  const image = ctx.getImageData(0, 0, width, height);
  const bounds = alphaBounds(image.data, width, height);
  if (!bounds) throw new Error("Background removal did not leave a visible garment");
  const w = bounds.maxX - bounds.minX + 1;
  const h = bounds.maxY - bounds.minY + 1;
  const target = Math.round(size * Math.max(0.5, Math.min(0.96, occupancy)));
  const scale = target / Math.max(w, h);
  const out = makeCanvas(size, size);
  const octx = out.getContext("2d");
  octx.imageSmoothingQuality = "high";
  const dw = Math.round(w * scale); const dh = Math.round(h * scale);
  octx.drawImage(canvasIn, bounds.minX, bounds.minY, w, h, Math.floor((size - dw) / 2), Math.floor((size - dh) / 2), dw, dh);
  return out;
}

export async function processChromaBackground(blob, key, options = {}) {
  const tolerance = cleanupTolerance(options.tolerance);
  const bitmap = await loadBitmap(blob);
  const canvas = makeCanvas(bitmap.width, bitmap.height);
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  ctx.drawImage(bitmap, 0, 0);
  bitmap.close?.();
  const image = ctx.getImageData(0, 0, canvas.width, canvas.height);
  keyPixels(image.data, key, tolerance);
  ctx.putImageData(image, 0, 0);
  const framed = await frameTransparent(canvas);
  const fctx = framed.getContext("2d", { willReadFrequently: true });
  const framedImage = fctx.getImageData(0, 0, framed.width, framed.height);
  despill(framedImage.data, key);
  fctx.putImageData(framedImage, 0, 0);
  const verification = spillReport(framedImage.data, key);
  return { blob: await canvasToBlob(framed), verification, tolerance };
}

export async function removeChromaBackground(blob, key, options = {}) {
  const result = await processChromaBackground(blob, key, options);
  // Gemini outputs are noisier than gpt-image chroma plates, so tolerate a few hundred stray pixels.
  if (options.strict !== false && result.verification.contaminatedPixels > 300) {
    throw new Error(`Фон убрался не полностью: осталось ${result.verification.contaminatedPixels} цветных пикселей. Подкрути чистку вручную.`);
  }
  return result.blob;
}

export { makeCanvas, canvasToBlob };
