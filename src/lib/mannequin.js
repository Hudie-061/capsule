// Draws an outfit on a mannequin from the transparent garment cutouts. Pure canvas, no AI call: free and instant.
//
// The figure is a "skeleton" of anchor points (neck, shoulders, waist, hips, knees, ankles, floor).
// Every item is fitted between the anchors of its type, so trousers end just over the shoes,
// a coat reaches the knee, a scarf sits on the neck, a cap on the head and a bag in the hand.
// Gender changes the silhouette; height and weight change the build slightly.
import { alphaBounds } from "./image.js";
import { kindOf, slotOf } from "./kinds.js";

const W = 600;
const H = 1000;
const CX = W / 2;
// Colours of the v2 tile (#EAE2D6) and mannequin body (#D3C8BA), so the board blends into the card.
const BG = "#EAE2D6";
const BODY = "#D3C8BA";
const LINE = "#BFB2A0";
const trimmedCache = new Map();

const isDress = (item) => item.part === "wholebody_up" && kindOf(item) === "dress";

// ---- body ------------------------------------------------------------------------------------
const Y = { headTop: 38, head: 94, chin: 148, neck: 178, shoulder: 194, chest: 272, knee: 735, ankle: 905, floor: 958 };

export function bodyFor({ gender = "", height = "", weight = "" } = {}) {
  const female = /жен|female|woman/i.test(gender);
  const base = female
    ? { shoulder: 100, chest: 92, waist: 70, hip: 104, waistY: 420, hipY: 492, crotch: 536 }
    : { shoulder: 118, chest: 102, waist: 88, hip: 96, waistY: 440, hipY: 500, crotch: 540 };
  // Build from BMI when both numbers are known: slimmer or broader torso, never a caricature.
  const h = Number.parseFloat(String(height).replace(",", ".")) / 100;
  const w = Number.parseFloat(String(weight).replace(",", "."));
  const bmi = h > 1.2 && h < 2.3 && w > 30 && w < 250 ? w / (h * h) : 22;
  const build = Math.min(1.22, Math.max(0.88, bmi / 22));
  const soft = 1 + (build - 1) * 0.5;
  return {
    ...base, female,
    shoulder: base.shoulder * soft, chest: base.chest * build, waist: base.waist * build, hip: base.hip * build,
    wristX: base.shoulder * soft + 14, wristY: 522,
  };
}

// A soft shadow on the floor grounds the figure.
function drawFloor(ctx) {
  const g = ctx.createRadialGradient(CX, Y.floor + 4, 10, CX, Y.floor + 4, 150);
  g.addColorStop(0, "rgba(30, 27, 24, 0.16)");
  g.addColorStop(1, "rgba(30, 27, 24, 0)");
  ctx.fillStyle = g;
  ctx.beginPath(); ctx.ellipse(CX, Y.floor + 4, 150, 22, 0, 0, Math.PI * 2); ctx.fill();
}

// A dress-form look: when a top, jacket or dress covers the upper body its sleeves are the arms,
// so the mannequin's own arms are not drawn (otherwise flat-lay sleeves and arms show side by side).
function drawBody(ctx, b, { arms = true } = {}) {
  // Light from the left: a gentle gradient instead of a flat fill.
  const shade = ctx.createLinearGradient(CX - 160, 0, CX + 160, 0);
  shade.addColorStop(0, "#DDD3C6");
  shade.addColorStop(0.55, BODY);
  shade.addColorStop(1, "#C9BDAE");
  ctx.fillStyle = shade;
  // legs
  for (const side of [-1, 1]) {
    ctx.beginPath();
    ctx.moveTo(CX + side * 6, b.crotch);
    ctx.lineTo(CX + side * b.hip, b.hipY);
    ctx.quadraticCurveTo(CX + side * (b.hip - 4), Y.knee - 120, CX + side * 62, Y.knee);
    ctx.lineTo(CX + side * 52, Y.ankle);
    ctx.lineTo(CX + side * 26, Y.ankle);
    ctx.lineTo(CX + side * 30, Y.knee);
    ctx.closePath();
    ctx.fill();
    ctx.beginPath(); ctx.ellipse(CX + side * 40, Y.floor - 18, 30, 18, 0, 0, Math.PI * 2); ctx.fill();
  }
  // torso
  ctx.beginPath();
  ctx.moveTo(CX - 22, Y.neck);
  ctx.quadraticCurveTo(CX - b.shoulder + 10, Y.shoulder - 6, CX - b.shoulder, Y.shoulder + 14);
  ctx.quadraticCurveTo(CX - b.chest - 2, Y.chest, CX - b.waist, b.waistY);
  ctx.quadraticCurveTo(CX - b.hip - 2, b.hipY - 20, CX - b.hip, b.hipY);
  ctx.lineTo(CX - b.hip + 6, b.crotch);
  ctx.lineTo(CX + b.hip - 6, b.crotch);
  ctx.lineTo(CX + b.hip, b.hipY);
  ctx.quadraticCurveTo(CX + b.hip + 2, b.hipY - 20, CX + b.waist, b.waistY);
  ctx.quadraticCurveTo(CX + b.chest + 2, Y.chest, CX + b.shoulder, Y.shoulder + 14);
  ctx.quadraticCurveTo(CX + b.shoulder - 10, Y.shoulder - 6, CX + 22, Y.neck);
  ctx.closePath();
  ctx.fill();
  // arms: shoulder → elbow → wrist, relaxed at the sides
  ctx.strokeStyle = shade; ctx.lineCap = "round"; ctx.lineJoin = "round";
  for (const side of arms ? [-1, 1] : []) {
    ctx.lineWidth = 36;
    ctx.beginPath(); ctx.moveTo(CX + side * (b.shoulder - 10), Y.shoulder + 22); ctx.lineTo(CX + side * (b.shoulder + 14), 360); ctx.stroke();
    ctx.lineWidth = 28;
    ctx.beginPath(); ctx.moveTo(CX + side * (b.shoulder + 14), 360); ctx.lineTo(CX + side * b.wristX, b.wristY); ctx.stroke();
    ctx.beginPath(); ctx.ellipse(CX + side * b.wristX, b.wristY + 26, 15, 22, 0, 0, Math.PI * 2); ctx.fill();
  }
  // neck
  ctx.beginPath(); ctx.roundRect(CX - 19, Y.chin - 14, 38, Y.neck - Y.chin + 22, 12); ctx.fill();
}

function drawHead(ctx) {
  ctx.fillStyle = BODY; ctx.strokeStyle = LINE; ctx.lineWidth = 2;
  ctx.beginPath(); ctx.ellipse(CX, Y.head, 42, 54, 0, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
}

// ---- layout: a box for every item, shared by the drawing and the callouts --------------------------
// Shoes are drawn a little larger than life so they stay readable next to the whole outfit.
const SHOE_HEIGHT = { boots: 175, loafers: 100, sneakers: 118 };

export function layoutOutfit(items, options = {}) {
  const b = bodyFor(options);
  const tuck = Boolean(options.tuck);
  const by = (part) => items.filter((item) => item.part === part);
  const dress = items.find(isDress);
  const outer = by("wholebody_up").find((item) => item !== dress);
  const top = by("upperbody")[0];
  const bottom = dress ? null : by("lowerbody")[0];
  const shoes = by("shoes")[0];
  const slots = new Map();
  for (const item of by("accessories_up")) { const slot = slotOf(item); if (!slots.has(slot)) slots.set(slot, item); }

  const shoeH = shoes ? SHOE_HEIGHT[kindOf(shoes)] || 96 : 0;
  const placed = [];
  const box = (item, role, x0, y0, x1, y1, extra = {}) => placed.push({ item, role, x0, y0, x1, y1, ...extra });

  if (shoes) box(shoes, "shoes", CX - 152, Y.floor - shoeH, CX + 152, Y.floor + 8, { align: "bottom" });
  if (bottom) {
    const k = kindOf(bottom);
    const hem = k === "shorts" ? 650 : k === "skirt" ? Y.knee : shoes ? Y.floor - shoeH + (k === "jeans" || k === "trousers" ? 22 : 18) : Y.ankle + 12;
    box(bottom, "bottom", CX - b.hip - 34, b.waistY - 10, CX + b.hip + 34, hem, { align: "top", stretch: true, cover: 2 * b.hip + 22 });
  }
  if (dress) box(dress, "dress", CX - b.hip - 80, Y.neck - 6, CX + b.hip + 80, Y.knee + 50, { align: "top" });
  if (top) {
    const k = kindOf(top);
    const long = ["hoodie", "sweater", "shirt"].includes(k);
    const span = b.shoulder + (long ? 78 : 50);
    box(top, "top", CX - span, Y.neck - 8, CX + span, b.hipY + (long ? 46 : 34), { align: "top", cropAt: tuck && bottom ? b.waistY + 14 : undefined });
  }
  if (outer) {
    const long = kindOf(outer) === "coat";
    const span = b.shoulder + 82;
    // Over a top the jacket is worn open, so the top underneath stays visible.
    box(outer, "outer", CX - span, Y.neck - 22, CX + span, long ? Y.knee + 30 : b.hipY + 70, { align: "top", open: Boolean(top) && kindOf(outer) !== "hoodie" });
  }
  const acc = (slot, x0, y0, x1, y1, align = "center") => { const item = slots.get(slot); if (item) box(item, slot, x0, y0, x1, y1, { align }); };
  acc("waist", CX - b.waist - 22, b.waistY - 18, CX + b.waist + 22, b.waistY + 18);
  const neckKind = slots.get("neck") ? kindOf(slots.get("neck")) : "";
  if (neckKind === "scarf") acc("neck", CX - 96, Y.neck - 30, CX + 96, Y.neck + 170, "top");
  else if (neckKind === "tie") acc("neck", CX - 22, Y.neck - 4, CX + 22, Y.neck + 230, "top");
  else acc("neck", CX - 62, Y.neck - 6, CX + 62, Y.neck + 110, "top");
  const headKind = slots.get("head") ? kindOf(slots.get("head")) : "";
  if (headKind === "hat") acc("head", CX - 92, Y.headTop - 26, CX + 92, Y.head + 4, "bottom");
  else acc("head", CX - 64, Y.headTop - 18, CX + 64, Y.head - 6, "bottom");
  acc("face", CX - 54, Y.head - 22, CX + 54, Y.head + 20);
  acc("hand", CX + b.wristX - 82, b.wristY + 10, CX + b.wristX + 82, b.wristY + 200, "top");
  acc("wrist", CX - b.wristX - 30, b.wristY - 26, CX - b.wristX + 30, b.wristY + 26);
  return { body: b, placed, tuck };
}

// Points for the callouts on «Сегодня», in canvas coordinates.
const ANCHOR = {
  top: (p) => [CX + (p.x1 - CX) * 0.38, p.y0 + 100],
  outer: (p) => [CX - (CX - p.x0) * 0.62, p.y0 + 150],
  dress: (p) => [CX + 44, (p.y0 + p.y1) / 2],
  bottom: (p) => [CX + (p.x1 - CX) * 0.46, (p.y0 + p.y1) / 2 + 40],
  shoes: (p) => [CX - 44, (p.y0 + p.y1) / 2],
};
export function outfitAnchors(items, options = {}) {
  const { placed } = layoutOutfit(items, options);
  const openOuter = placed.some((q) => q.role === "outer" && q.open);
  return placed.map((p) => {
    // Under an open jacket the top shows only in the middle, so its callout points there.
    const [x, y] = p.role === "top" && openOuter ? [CX + 12, p.y0 + 150] : (ANCHOR[p.role] || ((q) => [(q.x0 + q.x1) / 2, (q.y0 + q.y1) / 2]))(p);
    return { id: p.item.id, x, y, side: x >= CX ? "right" : "left" };
  });
}

// ---- drawing -----------------------------------------------------------------------------------
function loadImage(src) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("Не удалось загрузить картинку вещи"));
    image.src = src;
  });
}

// How wide the cutout is at a given height (0 = top row, 1 = bottom row), as a share of its full width.
// For trousers the top rows are the waistband, which has to cover the mannequin's hips.
function widthAt(canvas, share) {
  const y = Math.min(canvas.height - 1, Math.max(0, Math.round((canvas.height - 1) * share)));
  const row = canvas.getContext("2d", { willReadFrequently: true }).getImageData(0, y, canvas.width, 1).data;
  let first = -1; let last = -1;
  for (let x = 0; x < canvas.width; x += 1) if (row[x * 4 + 3] > 40) { if (first < 0) first = x; last = x; }
  return first < 0 ? 1 : (last - first + 1) / canvas.width;
}

async function trimmed(src) {
  if (trimmedCache.has(src)) return trimmedCache.get(src);
  const image = await loadImage(src);
  const canvas = document.createElement("canvas");
  canvas.width = image.naturalWidth;
  canvas.height = image.naturalHeight;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  ctx.drawImage(image, 0, 0);
  const b = alphaBounds(ctx.getImageData(0, 0, canvas.width, canvas.height).data, canvas.width, canvas.height);
  const out = document.createElement("canvas");
  if (!b) { out.width = canvas.width; out.height = canvas.height; out.getContext("2d").drawImage(canvas, 0, 0); }
  else {
    out.width = b.maxX - b.minX + 1;
    out.height = b.maxY - b.minY + 1;
    out.getContext("2d").drawImage(canvas, b.minX, b.minY, out.width, out.height, 0, 0, out.width, out.height);
  }
  out.waist = widthAt(out, 0.04);
  trimmedCache.set(src, out);
  return out;
}

// Fit the image into its box (keeping proportions), then crop for a tucked top.
// Trousers and skirts (`stretch`) reach their hem exactly, and their waistband is widened or narrowed to
// sit on the hips (`cover`), within 25% of the photo's own proportions so they never look distorted.
function place(ctx, img, p) {
  const bw = p.x1 - p.x0;
  const bh = p.y1 - p.y0;
  const scale = Math.min(bw / img.width, bh / img.height);
  let sx = scale;
  let sy = scale;
  if (p.stretch) {
    sy = bh / img.height;
    const fit = p.cover ? p.cover / (img.width * (img.waist || 1)) : sy;
    sx = Math.min(sy * 1.25, Math.max(sy * 0.8, fit));
  }
  const w = img.width * sx;
  const h = img.height * sy;
  const left = (p.x0 + p.x1) / 2 - w / 2;
  const top = p.align === "bottom" ? p.y1 - h : p.align === "top" ? p.y0 : p.y0 + (bh - h) / 2;
  if (p.open) {
    const gap = w * 0.045;
    ctx.drawImage(img, 0, 0, img.width / 2, img.height, left - gap, top, w / 2, h);
    ctx.drawImage(img, img.width / 2, 0, img.width / 2, img.height, left + w / 2 + gap, top, w / 2, h);
    return;
  }
  if (p.cropAt !== undefined && top + h > p.cropAt) {
    const visible = Math.max(1, p.cropAt - top);
    ctx.drawImage(img, 0, 0, img.width, img.height * (visible / h), left, top, w, visible);
    return;
  }
  ctx.drawImage(img, left, top, w, h);
}

function shoesPlaceholder(ctx) {
  ctx.fillStyle = "#FFFDF9"; ctx.strokeStyle = LINE; ctx.lineWidth = 2;
  for (const side of [-1, 1]) { ctx.beginPath(); ctx.roundRect(CX + side * 40 - 38, Y.floor - 34, 76, 38, 16); ctx.fill(); ctx.stroke(); }
}

// Back to front: shoes, then the trouser hem over them, then the top (or a tucked top under the
// trousers), outerwear, belt and neck pieces, the head, and finally things on the head and in the hands.
const ORDER = { shoes: 0, bottom: 2, dress: 2, top: 3, outer: 4, waist: 5, neck: 6, head: 8, face: 8, hand: 9, wrist: 9 };

export async function renderOutfit(items, options = {}) {
  const { body, placed, tuck } = layoutOutfit(items, options);
  const canvas = document.createElement("canvas");
  canvas.width = W; canvas.height = H;
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = BG; ctx.fillRect(0, 0, W, H);
  ctx.imageSmoothingQuality = "high";
  drawFloor(ctx);
  drawBody(ctx, body, { arms: !placed.some((p) => ["top", "outer", "dress"].includes(p.role)) });
  if (!placed.some((p) => p.role === "shoes")) shoesPlaceholder(ctx);

  const order = (p) => (tuck && p.role === "top" ? 1 : ORDER[p.role] ?? 5);
  const images = await Promise.all(placed.map((p) => trimmed(p.item.image).catch(() => null)));
  const layers = placed.map((p, i) => ({ p, img: images[i] })).sort((a, b) => order(a.p) - order(b.p));
  let headDrawn = false;
  for (const { p, img } of layers) {
    if (!headDrawn && order(p) >= 7) { drawHead(ctx); headDrawn = true; }
    if (!img) continue;
    // A soft shadow under every layer separates a jacket from the shirt and the shirt from the trousers.
    ctx.save();
    ctx.shadowColor = "rgba(30, 27, 24, 0.18)"; ctx.shadowBlur = 14; ctx.shadowOffsetY = 5;
    place(ctx, img, p);
    ctx.restore();
  }
  if (!headDrawn) drawHead(ctx);
  return canvas.toDataURL("image/jpeg", 0.88);
}
