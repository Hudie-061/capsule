// Body measurements and clothing sizes.
// Measuring follows ISO 8559-1 (where to put the tape); sizes follow EN 13402 conventions
// (tops by chest, trousers by waist and inside leg, shirts by neck) and Mondopoint / ISO 9407
// for shoes (foot length). Brand charts differ, so results are a starting point, not a promise.
import { kv } from "./db.js";

export const MEASURES = [
  { id: "chest", label: "Грудь", female: "Обхват груди", min: 70, max: 150, step: 1, how: "Лента горизонтально через самые выступающие точки груди и под лопатками." },
  { id: "waist", label: "Талия", min: 55, max: 140, step: 1, how: "По самому узкому месту, не втягивая живот." },
  { id: "hips", label: "Бёдра", min: 70, max: 150, step: 1, how: "По самым выступающим точкам ягодиц, ноги вместе." },
  { id: "shoulders", label: "Ширина плеч", min: 30, max: 60, step: 0.5, how: "По спине от края одного плеча до края другого." },
  { id: "inseam", label: "Внутренний шов", min: 60, max: 100, step: 0.5, how: "От паха до пола по внутренней стороне ноги, без обуви." },
  { id: "neck", label: "Шея", min: 28, max: 50, step: 0.5, how: "У основания шеи, оставь палец под лентой." },
  { id: "foot", label: "Стопа", min: 20, max: 32, step: 0.1, how: "Стоя: от пятки до самого длинного пальца." },
];

const female = (g) => g === "female";
const round = (v, step = 1) => Math.round(v / step) * step;

// Rough estimates from height, weight and gender when a measurement is unknown.
export function estimate({ gender = "", height = 175, weight = 70 } = {}) {
  const h = Number(height) || 175;
  const w = Number(weight) || 70;
  const bmi = w / ((h / 100) ** 2);
  const f = female(gender);
  const s = Math.sqrt(bmi / (f ? 21 : 22));
  return {
    chest: round((f ? 0.53 : 0.545) * h * s),
    waist: round((f ? 0.42 : 0.45) * h * (bmi / (f ? 21 : 22)) ** 0.8),
    hips: round((f ? 0.58 : 0.53) * h * s),
    shoulders: round((f ? 0.235 : 0.259) * h * Math.sqrt(s), 0.5),
    inseam: round(0.45 * h, 0.5),
    neck: round((f ? 0.19 : 0.21) * h * s, 0.5),
    foot: round(0.152 * h, 0.1),
  };
}

// Stored body: { gender, height, weight, measured: { chest: 98, ... } } — only what the user set.
export async function getBody() {
  return (await kv.get("body", null)) || null;
}
export async function saveBody(body) {
  await kv.set("body", body);
}

// Measured values win; the rest is estimated. Returns { values, estimated: Set }.
export function fullBody(body) {
  const base = estimate(body || {});
  const measured = body?.measured || {};
  const values = { ...base };
  const estimated = new Set(Object.keys(base));
  for (const [k, v] of Object.entries(measured)) if (Number.isFinite(v)) { values[k] = v; estimated.delete(k); }
  return { values, estimated };
}

const LETTERS = ["XS", "S", "M", "L", "XL", "XXL", "3XL"];
const letterFor = (chest, f) => {
  const limits = f ? [82, 88, 96, 104, 112, 120] : [88, 96, 104, 112, 120, 128];
  const i = limits.findIndex((limit) => chest < limit);
  return i === -1 ? LETTERS.length - 1 : i;
};
const nearest = (value, list) => list.reduce((a, b) => (Math.abs(b - value) < Math.abs(a - value) ? b : a));

export function sizesFor(body, { oversize = false } = {}) {
  const { values: v, estimated } = fullBody(body);
  const f = female(body?.gender);
  const est = (...ids) => ids.some((id) => estimated.has(id));
  const top = letterFor(v.chest, f);
  const euTop = f ? Math.min(54, Math.max(32, 34 + 2 * Math.floor((v.chest - 80) / 4))) : 2 * Math.round(v.chest / 4);
  const euTrousers = f ? Math.min(54, Math.max(32, 34 + 2 * Math.floor((v.waist - 64) / 4))) : 2 * Math.round((v.waist / 2 + 6) / 2);
  const shoeEu = Math.round((v.foot + 1.5) * 1.5 * 2) / 2;
  const sizes = [
    { id: "top", label: "Футболки, худи, свитеры", value: LETTERS[top], detail: `EU ${euTop}`, estimated: est("chest"),
      note: oversize && top < LETTERS.length - 1 ? `Для оверсайза бери ${LETTERS[top + 1]}` : "" },
    { id: "jeans", label: "Джинсы", value: `W${Math.round(v.waist / 2.54)} L${nearest(v.inseam / 2.54, [28, 30, 32, 34, 36])}`, detail: `брюки EU ${euTrousers}`, estimated: est("waist", "inseam") },
    { id: "shoes", label: "Обувь", value: `EU ${shoeEu}`, detail: `стопа ${v.foot.toFixed(1)} см · Mondopoint ${Math.round(v.foot * 10)}`, estimated: est("foot") },
  ];
  if (!f) sizes.splice(2, 0, { id: "shirt", label: "Рубашки", value: `ворот ${Math.round(v.neck + 1)}`, detail: "размер по обхвату шеи", estimated: est("neck") });
  return sizes;
}

// One line for the profile card and for the stylist ("верх M, джинсы W32 L32, обувь EU 43").
export function sizesSummary(body) {
  if (!body?.height) return "";
  const s = Object.fromEntries(sizesFor(body).map((x) => [x.id, x.value]));
  return `верх ${s.top}, джинсы ${s.jeans}, обувь ${s.shoes}`;
}
