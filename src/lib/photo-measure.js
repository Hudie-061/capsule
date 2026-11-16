// Measurements from full-body photos (front, and optionally side), computed on the phone.
// MediaPipe Pose (src/photo-measure.jsx) gives a person mask and body landmarks; everything here is
// plain math, so it runs in tests on synthetic silhouettes:
// 1. scale: the user's height over the silhouette height, from the top of the head to the floor
//    under the body. With the phone at waist height 2–3 m away the toes point at the camera and
//    reach lower in the photo than the floor under the heels, so the floor is taken 1.5 % of the
//    silhouette above its lowest point (checked on rendered photos of the 3D body);
// 2. the width (front) and depth (side) of the torso at the heights where the 3D body
//    (body-model.js) takes each measurement, as shares of height;
// 3. girth = the 3D body's tape girth × ellipse(photo width, depth) / ellipse(body width, depth):
//    the shape of the cross-section comes from a realistic body, the size from the photo.
//    Without a side photo the depth grows with the width (less exact, and we say so);
// 4. inside leg: from the top of the gap between the legs to the floor;
// 5. shoulders: the estimate scaled by the photo's shoulder width over the 3D body's.
// Neck and foot are not measured: hair hides the neck and feet are foreshortened from the front.
import { fitBody, torsoSection } from "./body-model.js";

const ON = 0.5; // mask confidence that counts as the person
const P = { nose: 0, lShoulder: 11, rShoulder: 12, lElbow: 13, rElbow: 14, lWrist: 15, rWrist: 16, lHip: 23, rHip: 24, lAnkle: 27, rAnkle: 28 };

// Ramanujan's approximation of an ellipse perimeter from its width and depth.
export function ellipse(width, depth) {
  const a = width / 2; const b = depth / 2;
  const h = ((a - b) / (a + b)) ** 2;
  return Math.PI * (a + b) * (1 + (3 * h) / (10 + Math.sqrt(4 - 3 * h)));
}

// The person in one photo: mask { data, width, height } (values 0…1, row by row) and
// MediaPipe's normalised landmarks (may be empty).
export function silhouette(mask, landmarks = []) {
  const { data, width, height } = mask;
  const on = (x, y) => x >= 0 && y >= 0 && x < width && y < height && data[y * width + x] > ON;
  const speck = Math.max(2, Math.round(width * 0.004));
  let top = -1; let bottom = -1; let sumX = 0; let count = 0;
  for (let y = 0; y < height; y += 1) {
    let row = 0;
    for (let x = 0; x < width; x += 1) if (data[y * width + x] > ON) { row += 1; sumX += x; }
    count += row;
    if (row >= speck) { if (top < 0) top = y; bottom = y; }
  }
  if (top < 0 || bottom - top < 50) return null;
  const pt = (i) => {
    const l = landmarks[i];
    return l ? { x: l.x * width, y: l.y * height, seen: (l.visibility ?? 1) > 0.5 } : null;
  };
  const mid = (a, b) => (a && b ? { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 } : null);
  const shoulders = mid(pt(P.lShoulder), pt(P.rShoulder));
  const hips = mid(pt(P.lHip), pt(P.rHip));
  const middle = sumX / count;
  const centerAt = (y) => {
    if (!shoulders || !hips || hips.y <= shoulders.y) return middle;
    const t = Math.min(1, Math.max(0, (y - shoulders.y) / (hips.y - shoulders.y)));
    return shoulders.x + t * (hips.x - shoulders.x);
  };
  // the run of person pixels through the middle of the body on one row
  const run = (y) => {
    const c = Math.round(centerAt(y));
    let start = -1;
    for (let d = 0; d <= Math.round(width * 0.03) && start < 0; d += 1) {
      if (on(c - d, y)) start = c - d; else if (on(c + d, y)) start = c + d;
    }
    if (start < 0) return null;
    let l = start; let r = start;
    while (on(l - 1, y)) l -= 1;
    while (on(r + 1, y)) r += 1;
    return [l, r];
  };
  const floor = bottom - 0.015 * (bottom - top); // see 1. above: the toes reach below the floor line
  const px = floor - top;
  const value = (x, y) => (x >= 0 && y >= 0 && x < width && y < height ? data[y * width + x] : 0);
  return { width, height, top, bottom, floor, px, on, value, run, pt, shoulders, hips, centerAt };
}

const rowAt = (s, share) => Math.round(s.floor - share * s.px);
const shareAt = (s, y) => (s.floor - y) / s.px;

// Average run width (px) over a thin band around a height.
function widthAt(s, share, band = 0.004) {
  const y0 = rowAt(s, share + band); const y1 = rowAt(s, share - band);
  let sum = 0; let rows = 0;
  for (let y = y0; y <= y1; y += 1) { const r = s.run(y); if (r) { sum += r[1] - r[0] + 1; rows += 1; } }
  return rows > (y1 - y0 + 1) / 2 ? sum / rows : null;
}

// The narrowest or widest smoothed run between two heights: { share, width }.
function extreme(s, from, to, pick) {
  let best = null;
  for (let y = rowAt(s, to); y <= rowAt(s, from); y += 1) {
    const w = widthAt(s, shareAt(s, y));
    if (w && (!best || pick(w, best.width))) best = { share: shareAt(s, y), width: w };
  }
  return best;
}

// Top of the gap between the legs, as a share of height (null when the legs touch). The mask is
// soft where the thighs nearly meet, so the gap starts where it is no longer certainly the person.
export function crotchShare(s) {
  const cx = Math.round(s.hips ? s.hips.x : s.centerAt(s.bottom));
  const reach = Math.max(2, Math.round(0.012 * s.px));
  const open = (y) => { for (let x = cx - reach; x <= cx + reach; x += 1) if (s.value(x, y) < 0.8) return true; return false; };
  let gap = 0;
  for (let y = rowAt(s, 0.62); y <= rowAt(s, 0.15); y += 1) {
    gap = open(y) ? gap + 1 : 0;
    if (gap >= 3) return shareAt(s, y - 3);
  }
  return null;
}

// The armpits: going up from the waist, the first row where the arms join the torso and the run
// suddenly widens (share of height, or null). Close to the armpits the arms may touch the bust in
// the photo, so the chest is read a little lower.
function armpitShare(s, from, to) {
  const step = Math.max(1, Math.round(s.px * 0.005));
  for (let y = rowAt(s, from); y >= rowAt(s, to); y -= 1) {
    const a = s.run(y); const b = s.run(y + step);
    if (a && b && a[1] - a[0] > (b[1] - b[0]) * 1.12) return shareAt(s, y);
  }
  return null;
}

// An arm touching the body on this row: with the arms held away, each arm is its own run beside
// the torso until the wrist.
function armTouches(s, share) {
  const y = rowAt(s, share);
  const r = s.run(y);
  if (!r) return false;
  const free = (from, to, step) => { let n = 0; for (let x = from; x !== to; x += step) { n = s.on(x, y) ? n + 1 : 0; if (n >= 3) return true; } return false; };
  for (const [wrist, side] of [[s.pt(P.lWrist), 1], [s.pt(P.rWrist), -1]]) {
    if (!wrist || !wrist.seen || wrist.y <= y) continue;
    const outward = (wrist.x - s.centerAt(y)) * side >= 0 ? side : -side;
    const found = outward > 0 ? free(r[1] + 1, s.width, 1) : free(r[0] - 1, -1, -1);
    if (!found) return true;
  }
  return false;
}

// Problems with the photo before measuring: { error } stops, { warnings } are shown with results.
export function checkPhoto(s, view, people = 1) {
  if (!s) return { error: "Не вижу человека. Нужно фото в полный рост." };
  if (people > 1) return { error: "В кадре больше одного человека — сфотографируйся один." };
  if (s.top <= 1) return { error: "Голова не поместилась в кадр — отойди чуть дальше." };
  if (s.bottom >= s.height - 2) return { error: "Стопы не поместились в кадр — нужно всё тело, от макушки до пола." };
  const ankles = [s.pt(P.lAnkle), s.pt(P.rAnkle)];
  if (ankles.every((a) => a && !a.seen)) return { error: "Не видно стоп — нужно всё тело, от макушки до пола." };
  const warnings = [];
  const l = s.pt(P.lShoulder); const r = s.pt(P.rShoulder);
  if (l && r) {
    const spread = Math.abs(l.x - r.x) / s.px;
    if (view === "front" && spread < 0.09) return { error: "Похоже, это фото сбоку. Здесь нужно встать лицом к камере." };
    if (view === "side" && spread > 0.1) return { error: "Похоже, это фото спереди. Здесь нужно повернуться боком." };
    if (view === "front" && Math.abs(l.y - r.y) / s.px > 0.03) warnings.push("Плечи на фото наклонены — держи телефон ровно.");
  }
  if (s.px < 0.45 * s.height) warnings.push("Ты далеко от камеры — точность ниже. Лучше, чтобы тело занимало почти весь кадр.");
  return { warnings };
}

// The reference 3D body for this height, weight and gender (and current measurements).
export function referenceBody(model, m) {
  const fit = fitBody(model, m);
  const H = m.height;
  const tip = (fit.shoulders[0][1] + fit.shoulders[1][1]) / 2;
  return {
    m,
    section: (share) => torsoSection(fit.positions, model.body, share * H),
    levels: {
      chest: fit.rings.chest.y / H,
      waist: fit.rings.waist.y / H,
      hips: fit.rings.hips.y / H,
      shoulders: tip / H - 0.015, // just below the shoulder tips, across the deltoids
    },
  };
}

// One pass: photos + reference body → measurements. `front` and `side` are silhouettes.
export function measureOnce({ front, side, height, ref }) {
  const k = height / front.px; // cm per pixel
  const ks = side ? height / side.px : 0;
  const lv = ref.levels;
  const values = {}; const lines = { front: [], side: [] }; const skipped = [];
  const line = (s, list, id, share) => { const y = rowAt(s, share); const r = s.run(y); if (r) list.push({ id, y, x1: r[0], x2: r[1] }); };

  // `at` is where the front width is read (the chest may be read a little lower, see armpitShare);
  // the width there relative to the 3D body's scales the 3D body's width at the measuring level
  const girth = (id, share, depthBand, at = share) => {
    if (armTouches(front, at)) { skipped.push(id); return; }
    const w = widthAt(front, at);
    const body = ref.section(share); const near = at === share ? body : ref.section(at);
    if (!w || !body || !near) { skipped.push(id); return; }
    const wp = body.width * ((w * k) / near.width);
    let dp = body.depth * (wp / body.width);
    if (side) {
      const d = depthBand ? extreme(side, share - depthBand, share + depthBand, (a, b) => a > b) : { share, width: widthAt(side, share) };
      if (d?.width) { dp = d.width * ks; line(side, lines.side, id, d.share); }
    }
    values[id] = body.girth * (ellipse(wp, dp) / ellipse(body.width, body.depth));
    line(front, lines.front, id, at);
  };

  const pit = armpitShare(front, lv.waist, lv.shoulders);
  girth("chest", lv.chest, 0.02, pit && pit - 0.012 < lv.chest ? pit - 0.012 : lv.chest);
  // the natural waist: the narrowest place near the 3D body's waist (if it is not at the edge of
  // the search, where a fuller body simply keeps narrowing towards the ribs)
  const waist = extreme(front, lv.waist - 0.03, lv.waist + 0.03, (a, b) => a < b);
  girth("waist", waist && Math.abs(waist.share - lv.waist) < 0.026 ? waist.share : lv.waist, 0);
  girth("hips", lv.hips, 0.02);

  const shoulderWidth = widthAt(front, lv.shoulders);
  const bodyShoulders = ref.section(lv.shoulders);
  if (shoulderWidth && bodyShoulders) {
    values.shoulders = ref.m.shoulders * ((shoulderWidth * k) / bodyShoulders.width);
    line(front, lines.front, "shoulders", lv.shoulders);
  } else skipped.push("shoulders");

  const crotch = crotchShare(front);
  if (crotch) {
    values.inseam = crotch * height;
    const cx = Math.round(front.hips ? front.hips.x : front.centerAt(front.bottom));
    lines.front.push({ id: "inseam", x: cx, y1: rowAt(front, crotch), y2: Math.round(front.floor) });
  } else skipped.push("inseam");
  return { values, lines, skipped };
}

const LIMITS = { chest: [0.7, 1.45], waist: [0.65, 1.6], hips: [0.7, 1.45], shoulders: [0.8, 1.25], inseam: [0.85, 1.15] };
const NAMES = { chest: "грудь", waist: "талию", hips: "бёдра", shoulders: "плечи", inseam: "внутренний шов" };
const roundTo = (v, step) => Math.round(v / step) * step;

// Full measurement: two passes, so the reference body already has the photo's girths and its
// cross-sections match the person better. `estimates` are the height/weight estimates (sizes.js).
export function measureFromPhotos({ model, front, side, gender, height, weight, estimates }) {
  let m = { gender, height, weight, ...estimates, shouldersEstimate: estimates.shoulders };
  let result = null;
  for (let pass = 0; pass < 2; pass += 1) {
    result = measureOnce({ front, side, height, ref: referenceBody(model, m) });
    const { shoulders, ...girths } = result.values;
    m = { ...m, ...girths };
    if (pass === 0 && shoulders) m = { ...m, shoulders, shouldersEstimate: estimates.shoulders };
  }
  // values far from what this height and weight allow mean a bad pose or loose clothes
  const values = {}; const dropped = [...result.skipped];
  for (const [id, v] of Object.entries(result.values)) {
    const [lo, hi] = LIMITS[id];
    const ratio = v / estimates[id];
    if (ratio < lo || ratio > hi) dropped.push(id);
    else values[id] = roundTo(v, id === "shoulders" || id === "inseam" ? 0.5 : 1);
  }
  const warnings = [];
  if (dropped.length) warnings.push(`Не получилось измерить: ${dropped.map((id) => NAMES[id]).join(", ")}. Проверь позу: руки чуть в стороны, ноги на ширине бёдер, одежда в обтяжку.`);
  return { values, lines: result.lines, dropped, warnings, withSide: Boolean(side) };
}
