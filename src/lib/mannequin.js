// Draws an outfit "flat lay on a mannequin" from transparent garment cutouts.
// Pure canvas, no AI call: free and instant.
import { alphaBounds } from "./image.js";

const W = 600;
const H = 1000;
// Colours of the v2 tile (#EAE2D6) and mannequin body (#D3C8BA), so the board blends into the card.
const BG = "#EAE2D6";
const BODY = "#D3C8BA";
const LINE = "#BFB2A0";
const trimmedCache = new Map();

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("Не удалось загрузить картинку вещи"));
    image.src = src;
  });
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
  trimmedCache.set(src, out);
  return out;
}

function body(ctx) {
  ctx.fillStyle = BODY;
  ctx.beginPath(); ctx.roundRect(285, 118, 30, 42, 10); ctx.fill();
  ctx.beginPath(); ctx.moveTo(205, 165); ctx.lineTo(395, 165); ctx.lineTo(375, 440); ctx.lineTo(225, 440); ctx.closePath(); ctx.fill();
  ctx.lineCap = "round"; ctx.strokeStyle = BODY;
  ctx.lineWidth = 34;
  for (const [x0, x1] of [[205, 160], [395, 440]]) { ctx.beginPath(); ctx.moveTo(x0, 175); ctx.lineTo(x1, 420); ctx.stroke(); }
  ctx.lineWidth = 58;
  for (const [x0, x1] of [[262, 255], [338, 345]]) { ctx.beginPath(); ctx.moveTo(x0, 440); ctx.lineTo(x1, 905); ctx.stroke(); }
}

function head(ctx) {
  ctx.fillStyle = BODY; ctx.strokeStyle = LINE; ctx.lineWidth = 2;
  ctx.beginPath(); ctx.ellipse(300, 84, 38, 44, 0, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
}

function shoesPlaceholder(ctx) {
  ctx.fillStyle = "#FFFDF9"; ctx.strokeStyle = LINE; ctx.lineWidth = 2;
  for (const x of [215, 315]) { ctx.beginPath(); ctx.roundRect(x, 905, 78, 35, 14); ctx.fill(); ctx.stroke(); }
}

function place(ctx, img, { width, height, x, y, bottom, maxHeight, cropBottomAt }) {
  let w = width; let h = img.height * (width / img.width);
  if (height) { h = height; w = img.width * (height / img.height); }
  if (maxHeight && h > maxHeight) { w *= maxHeight / h; h = maxHeight; }
  const left = x ?? (W - w) / 2;
  const top = bottom !== undefined ? bottom - h : y;
  if (cropBottomAt !== undefined && top + h > cropBottomAt) {
    const visible = Math.max(1, cropBottomAt - top);
    ctx.drawImage(img, 0, 0, img.width, img.height * (visible / h), left, top, w, visible);
    return;
  }
  ctx.drawImage(img, left, top, w, h);
}

const isDress = (item) => (item.tags || []).some((tag) => /dress|jumpsuit|overall|платье|комбинезон/i.test(tag)) || /dress|jumpsuit|платье/i.test(item.name || "");

// items: library records with resolved image URLs. Returns a PNG data URL.
export async function renderOutfit(items, { tuck = false } = {}) {
  const canvas = document.createElement("canvas");
  canvas.width = W; canvas.height = H;
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = BG; ctx.fillRect(0, 0, W, H);
  ctx.imageSmoothingQuality = "high";
  body(ctx);

  const by = (part) => items.filter((item) => item.part === part);
  const dress = items.find((item) => item.part === "wholebody_up" && isDress(item));
  const outers = by("wholebody_up").filter((item) => item !== dress);
  const tops = by("upperbody");
  const bottoms = by("lowerbody");
  const shoes = by("shoes");
  const accessories = by("accessories_up");
  const waist = 425;

  if (shoes[0]) place(ctx, await trimmed(shoes[0].image), { width: 230, bottom: 962, maxHeight: 140 });
  else shoesPlaceholder(ctx);

  const drawBottom = async () => { if (bottoms[0]) place(ctx, await trimmed(bottoms[0].image), { height: 500, y: waist, maxHeight: 520 }); };
  const drawTop = async () => {
    if (!tops[0]) return;
    place(ctx, await trimmed(tops[0].image), { width: 400, y: 158, maxHeight: 420, cropBottomAt: tuck && bottoms[0] ? waist + 14 : undefined });
  };

  if (dress) {
    place(ctx, await trimmed(dress.image), { width: 380, y: 158, maxHeight: 780 });
  } else if (tuck) { await drawTop(); await drawBottom(); }
  else { await drawBottom(); await drawTop(); }

  if (outers[0]) place(ctx, await trimmed(outers[0].image), { width: tops[0] || dress ? 470 : 440, y: 110, maxHeight: 520 });
  head(ctx);
  if (accessories[0]) place(ctx, await trimmed(accessories[0].image), { width: 120, x: 455, y: 250, maxHeight: 150 });
  return canvas.toDataURL("image/jpeg", 0.88);
}
