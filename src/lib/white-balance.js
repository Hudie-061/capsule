// Colour calibration of the palette selfie with a white sheet of paper held next to the face.
// A camera under warm indoor light makes everyone look "warm"; the sheet shows how the camera tints a
// known white, and the same correction applied to the face brings skin, hair and eyes back to their
// real colours (the grey-card trick of photographers). Runs on the phone, no AI call.
//
// Pure functions on RGBA pixel arrays, so they are tested without a browser.

const luminance = (r, g, b) => 0.2126 * r + 0.7152 * g + 0.0722 * b;

// Find the sheet: the brightest large, nearly uniform, nearly neutral patch with a compact (rectangle-
// like) shape. `data` is a small copy of the photo (about 160 px on the long side).
// Returns { box: { x0, y0, x1, y1 } in 0…1, avg: [r, g, b], share } or null.
export function findWhiteSheet(data, width, height) {
  const n = width * height;
  const lum = new Float32Array(n);
  for (let i = 0; i < n; i += 1) lum[i] = luminance(data[i * 4], data[i * 4 + 1], data[i * 4 + 2]);
  const sorted = Float32Array.from(lum).sort();
  const threshold = Math.max(150, sorted[Math.floor(n * 0.82)]);

  const candidate = new Uint8Array(n);
  for (let i = 0; i < n; i += 1) {
    const r = data[i * 4]; const g = data[i * 4 + 1]; const b = data[i * 4 + 2];
    const max = Math.max(r, g, b); const min = Math.min(r, g, b);
    // bright, and only slightly tinted (paper under warm light is cream, skin is much more saturated)
    if (lum[i] >= threshold && max > 0 && (max - min) / max < 0.3) candidate[i] = 1;
  }

  const seen = new Uint8Array(n);
  const stack = new Int32Array(n);
  let best = null;
  for (let start = 0; start < n; start += 1) {
    if (!candidate[start] || seen[start]) continue;
    let top = 0; stack[top++] = start; seen[start] = 1;
    let area = 0; let sr = 0; let sg = 0; let sb = 0; let sl = 0;
    let x0 = width; let y0 = height; let x1 = 0; let y1 = 0;
    while (top) {
      const i = stack[--top];
      const x = i % width; const y = (i - x) / width;
      area += 1; sr += data[i * 4]; sg += data[i * 4 + 1]; sb += data[i * 4 + 2]; sl += lum[i];
      if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
      for (const j of [i - 1, i + 1, i - width, i + width]) {
        if (j < 0 || j >= n || seen[j] || !candidate[j]) continue;
        if ((j === i - 1 && x === 0) || (j === i + 1 && x === width - 1)) continue;
        seen[j] = 1; stack[top++] = j;
      }
    }
    const share = area / n;
    const fill = area / ((x1 - x0 + 1) * (y1 - y0 + 1));
    if (share < 0.02 || fill < 0.55) continue; // too small, or not sheet-shaped (a blown-out sky through a window, hair highlights)
    const score = (sl / area) * Math.sqrt(area);
    if (!best || score > best.score) {
      best = { score, share, avg: [sr / area, sg / area, sb / area], box: { x0: x0 / width, y0: y0 / height, x1: (x1 + 1) / width, y1: (y1 + 1) / height } };
    }
  }
  if (!best) return null;
  return { box: best.box, avg: best.avg.map((v) => Math.round(v)), share: best.share };
}

// The sheet where the person tapped: the average of a small square around the point (0…1).
export function sampleAt(data, width, height, x, y, size = 0.06) {
  const half = Math.max(2, Math.round((Math.min(width, height) * size) / 2));
  const cx = Math.round(x * (width - 1)); const cy = Math.round(y * (height - 1));
  let r = 0; let g = 0; let b = 0; let count = 0;
  for (let yy = Math.max(0, cy - half); yy <= Math.min(height - 1, cy + half); yy += 1) {
    for (let xx = Math.max(0, cx - half); xx <= Math.min(width - 1, cx + half); xx += 1) {
      const i = (yy * width + xx) * 4;
      r += data[i]; g += data[i + 1]; b += data[i + 2]; count += 1;
    }
  }
  return {
    box: { x0: Math.max(0, (cx - half) / width), y0: Math.max(0, (cy - half) / height), x1: Math.min(1, (cx + half + 1) / width), y1: Math.min(1, (cy + half + 1) / height) },
    avg: [r / count, g / count, b / count].map((v) => Math.round(v)),
    share: count / (width * height),
  };
}

// Channel gains that turn the sheet neutral without changing the overall brightness. Limited to ±40 %:
// a stronger cast means the tapped spot was not white paper. Null when the patch cannot be a sheet
// (too dark, or a strongly coloured surface).
export function whiteGains(avg) {
  const [r, g, b] = avg;
  const mean = (r + g + b) / 3;
  if (mean < 90) return null;
  const gains = [mean / Math.max(1, r), mean / Math.max(1, g), mean / Math.max(1, b)];
  if (gains.some((k) => k < 0.6 || k > 1.4)) return null;
  return gains;
}

export function applyGains(data, gains) {
  for (let i = 0; i < data.length; i += 4) {
    data[i] = Math.min(255, Math.round(data[i] * gains[0]));
    data[i + 1] = Math.min(255, Math.round(data[i + 1] * gains[1]));
    data[i + 2] = Math.min(255, Math.round(data[i + 2] * gains[2]));
  }
  return data;
}
