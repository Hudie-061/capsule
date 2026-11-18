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

// The numbers behind every size, so the profile cards and the shop search say the same thing.
function sizeNumbers(body) {
  const { values: v, estimated } = fullBody(body);
  const f = female(body?.gender);
  return {
    f, v, estimated,
    top: letterFor(v.chest, f),
    euTop: f ? Math.min(54, Math.max(32, 34 + 2 * Math.floor((v.chest - 80) / 4))) : 2 * Math.round(v.chest / 4),
    euTrousers: f ? Math.min(54, Math.max(32, 34 + 2 * Math.floor((v.waist - 64) / 4))) : 2 * Math.round((v.waist / 2 + 6) / 2),
    w: Math.round(v.waist / 2.54),
    l: nearest(v.inseam / 2.54, [28, 30, 32, 34, 36]),
    shoeEu: Math.round((v.foot + 1.5) * 1.5 * 2) / 2,
    collar: Math.round(v.neck + 1),
  };
}

const sizeUp = (n, oversize) => (oversize && n.top < LETTERS.length - 1 ? `Для оверсайза бери ${LETTERS[n.top + 1]}` : "");

export function sizesFor(body, { oversize = false } = {}) {
  const n = sizeNumbers(body);
  const est = (...ids) => ids.some((id) => n.estimated.has(id));
  const sizes = [
    { id: "top", label: "Футболки, худи, свитеры", value: LETTERS[n.top], detail: `EU ${n.euTop}`, estimated: est("chest"), note: sizeUp(n, oversize) },
    { id: "jeans", label: "Джинсы", value: `W${n.w} L${n.l}`, detail: `брюки EU ${n.euTrousers}`, estimated: est("waist", "inseam") },
    { id: "shoes", label: "Обувь", value: `EU ${n.shoeEu}`, detail: `стопа ${n.v.foot.toFixed(1)} см · Mondopoint ${Math.round(n.v.foot * 10)}`, estimated: est("foot") },
  ];
  if (!n.f) sizes.splice(2, 0, { id: "shirt", label: "Рубашки", value: `ворот ${n.collar}`, detail: "размер по обхвату шеи", estimated: est("neck") });
  return sizes;
}

// The size to look for when shopping for a piece of this kind (see kinds.js).
// `shown` is what the user sees in the search line and what goes into the shop links;
// `query` is what goes to the Worker's price search. They differ only for half shoe sizes:
// the Worker keeps only letters, digits, spaces and hyphens, so "42.5" would turn into "42 5",
// and "size 42" also finds offers labelled 42.5. `value` and `detail` label the chip.
// Accessories have no size.
const LETTER_KINDS = new Set(["t-shirt", "shirt", "hoodie", "sweater", "jacket", "coat", "dress"]);
const SHOE_KINDS = new Set(["sneakers", "boots", "loafers"]);

// ---- sizes the user picks right in «Покупки» ---------------------------------------------------
// One choice per size system, so a size picked for one pair of jeans also applies to the next jeans
// and to men's trousers. Stored in settings.chosenSizes: { letter: "M", euTop: 52, wl: { w: 33, l: 32 },
// euBottom: 40, w: 33, shoe: 42.5 }. A choice wins over the size from measurements.
const W_SIZES = [...Array.from({ length: 15 }, (_, i) => 26 + i), 42, 44]; // W26–W40 and the big ones
const L_SIZES = [28, 30, 32, 34, 36];
const evens = (a, b) => Array.from({ length: (b - a) / 2 + 1 }, (_, i) => a + 2 * i);
const halves = (a, b) => Array.from({ length: (b - a) * 2 + 1 }, (_, i) => a + i / 2);

export function sizeSystem(kind, gender) {
  const f = female(gender);
  if (LETTER_KINDS.has(kind)) return "letter";
  if (kind === "blazer") return "euTop";
  if (kind === "jeans" || (kind === "trousers" && !f)) return "wl";
  if (kind === "trousers" || ((kind === "shorts" || kind === "skirt") && f)) return "euBottom";
  if (kind === "shorts" || kind === "skirt") return "w";
  if (SHOE_KINDS.has(kind)) return "shoe";
  return null;
}

// What the picker offers for a system: `main` (and `second` for the inside leg of W/L sizes).
export function sizeOptions(system, gender) {
  const f = female(gender);
  if (system === "letter") return { main: LETTERS, label: "Размер" };
  if (system === "euTop") return { main: f ? evens(32, 50) : evens(44, 60), label: "Размер EU" };
  if (system === "wl") return { main: W_SIZES, second: L_SIZES, label: "Талия, W", secondLabel: "Длина, L" };
  if (system === "euBottom") return { main: evens(32, 50), label: "Размер EU" };
  if (system === "w") return { main: W_SIZES, label: "Талия, W" };
  if (system === "shoe") return { main: halves(35, 48), label: "Размер EU" };
  return null;
}

function validChoice(system, pick, gender) {
  const o = sizeOptions(system, gender);
  if (!o || pick == null) return false;
  if (system === "wl") return o.main.includes(pick?.w) && o.second.includes(pick?.l);
  return o.main.includes(pick);
}

function sizeOfChoice(system, pick) {
  const base = { estimated: false, chosen: true, note: "", system };
  if (system === "letter") return { ...base, value: pick, query: `size ${pick}`, shown: `size ${pick}`, detail: "" };
  if (system === "wl") { const wl = `W${pick.w} L${pick.l}`; return { ...base, value: wl, query: wl, shown: wl, detail: "" }; }
  if (system === "w") return { ...base, value: `W${pick}`, query: `W${pick}`, shown: `W${pick}`, detail: "" };
  if (system === "shoe") return { ...base, value: `EU ${pick}`, query: `size ${Math.floor(pick)}`, shown: `size ${pick}`, detail: "" };
  return { ...base, value: `EU ${pick}`, query: `size ${pick}`, shown: `size ${pick}`, detail: "" };
}

// The current choice in the picker's terms (also when the size comes from measurements).
export function sizePick(system, size) {
  if (!size) return null;
  if (system === "letter") return size.value;
  if (system === "wl") { const m = /^W(\d+) L(\d+)$/.exec(size.value); return m ? { w: Number(m[1]), l: Number(m[2]) } : null; }
  if (system === "w") { const m = /^W(\d+)/.exec(size.value); return m ? Number(m[1]) : null; }
  const m = /^EU ([\d.]+)/.exec(size.value);
  return m ? Number(m[1]) : null;
}

// The size to search for: the user's own choice for this system, or the size from measurements.
// `suggested` is what the measurements say, shown next to a manual choice.
export function sizeForKind(kind, body, { oversize = false, chosen = {}, gender = "" } = {}) {
  const g = body?.gender || gender;
  const system = sizeSystem(kind, g);
  if (!system) return null;
  const measured = body?.height ? measuredSize(kind, body, { oversize }) : null;
  const pick = chosen?.[system];
  if (validChoice(system, pick, g)) return { ...sizeOfChoice(system, pick), suggested: measured?.value || "" };
  return measured ? { ...measured, system, chosen: false } : null;
}

function measuredSize(kind, body, { oversize = false } = {}) {
  const n = sizeNumbers(body);
  const est = (...ids) => ids.some((id) => n.estimated.has(id));
  const wl = `W${n.w} L${n.l}`;
  if (LETTER_KINDS.has(kind)) {
    const letter = LETTERS[n.top];
    const detail = kind === "shirt" && !n.f ? `ворот ${n.collar}` : `EU ${n.euTop}`;
    return { value: letter, query: `size ${letter}`, shown: `size ${letter}`, detail, estimated: est("chest"), note: sizeUp(n, oversize) };
  }
  if (kind === "blazer") return { value: `EU ${n.euTop}`, query: `size ${n.euTop}`, shown: `size ${n.euTop}`, detail: LETTERS[n.top], estimated: est("chest"), note: "" };
  if (kind === "jeans") return { value: wl, query: wl, shown: wl, detail: `EU ${n.euTrousers}`, estimated: est("waist", "inseam"), note: "" };
  if (kind === "trousers") {
    return n.f
      ? { value: `EU ${n.euTrousers}`, query: `size ${n.euTrousers}`, shown: `size ${n.euTrousers}`, detail: wl, estimated: est("waist"), note: "" }
      : { value: wl, query: wl, shown: wl, detail: `EU ${n.euTrousers}`, estimated: est("waist", "inseam"), note: "" };
  }
  if (kind === "shorts" || kind === "skirt") {
    return n.f
      ? { value: `EU ${n.euTrousers}`, query: `size ${n.euTrousers}`, shown: `size ${n.euTrousers}`, detail: `W${n.w}`, estimated: est("waist"), note: "" }
      : { value: `W${n.w}`, query: `W${n.w}`, shown: `W${n.w}`, detail: `EU ${n.euTrousers}`, estimated: est("waist"), note: "" };
  }
  if (SHOE_KINDS.has(kind)) return { value: `EU ${n.shoeEu}`, query: `size ${Math.floor(n.shoeEu)}`, shown: `size ${n.shoeEu}`, detail: `стопа ${n.v.foot.toFixed(1)} см`, estimated: est("foot"), note: "" };
  return null;
}

// Saved measurements first; otherwise height, weight and gender from the profile («166 см»).
export function bodyOrProfile(body, profile) {
  if (body?.height) return body;
  const height = Number.parseFloat(String(profile?.height || "").replace(",", "."));
  const weight = Number.parseFloat(String(profile?.weight || "").replace(",", "."));
  if (!(height >= 120 && height <= 230)) return null;
  return { gender: profile?.gender || "", height, weight: weight >= 30 && weight <= 250 ? weight : undefined, measured: {} };
}

// One line for the profile card and for the stylist ("верх M, джинсы W32 L32, обувь EU 43").
export function sizesSummary(body) {
  if (!body?.height) return "";
  const s = Object.fromEntries(sizesFor(body).map((x) => [x.id, x.value]));
  return `верх ${s.top}, джинсы ${s.jeans}, обувь ${s.shoes}`;
}

// Full size charts with conversions, and the user's row. Sources of the conventions: EN 13402
// (letters by chest, trousers by waist), German/French/Italian/UK/US women's equivalents
// (DE 34 = FR 36 = IT 40 = UK 8 = US 4), men's jacket sizes as half the chest, Paris points for
// EU shoes (⅔ cm) and barleycorns for UK shoes (⅓ inch, adult UK 0 = 25 barleycorns of last).
const range = (a, b) => (a === b ? `${a}` : `${a}–${b}`);
const half = (v) => Math.round(v * 2) / 2;
const shoeUk = (eu) => half((3 * (eu / 1.5)) / 2.54 - 25);
const COLLARS = [[37, "14½", "S"], [38, "15", "S"], [39, "15½", "M"], [40, "15¾", "M"], [41, "16", "L"], [42, "16½", "L"], [43, "17", "XL"], [44, "17½", "XL"], [45, "17¾", "XXL"], [46, "18", "XXL"]];
const MEN_W = [28, 29, 30, 31, 32, 33, 34, 36, 38, 40];

export const CHARTS = [
  { id: "top", label: "Верх" },
  { id: "bottom", label: "Низ" },
  { id: "shirt", label: "Рубашки", male: true },
  { id: "shoes", label: "Обувь" },
];

export function sizeChart(id, body) {
  const n = sizeNumbers(body || {});
  if (id === "top" && !n.f) {
    const limits = [80, 88, 96, 104, 112, 120, 128, 136];
    return {
      columns: ["Размер", "Грудь, см", "EU", "UK / US"],
      rows: LETTERS.map((letter, i) => {
        const [lo, hi] = [limits[i], limits[i + 1]];
        return { me: i === n.top, cells: [letter, range(lo, hi - 1), range(lo / 2, hi / 2 - 2), range(Math.round(lo / 2.54), Math.round(hi / 2.54) - 1)] };
      }),
      note: "EU — размер пиджаков и курток: половина обхвата груди. UK/US — обхват груди в дюймах.",
    };
  }
  if (id === "top") {
    return {
      columns: ["EU", "Размер", "Грудь, см", "FR", "IT", "UK", "US"],
      rows: [32, 34, 36, 38, 40, 42, 44, 46, 48, 50, 52].map((eu) => {
        const lo = 80 + 2 * (eu - 34);
        return { me: eu === n.euTop, cells: [eu, LETTERS[letterFor(lo, true)], range(lo, lo + 3), eu + 2, eu + 6, eu - 26, eu - 30] };
      }),
      note: "EU здесь — немецкая сетка (DE). Французская на 2 больше, итальянская на 6.",
    };
  }
  if (id === "bottom" && !n.f) {
    return {
      columns: ["Джинсы", "Талия, см", "Брюки EU"],
      rows: MEN_W.map((w) => {
        const waist = w * 2.54;
        return { me: w === nearest(n.w, MEN_W), cells: [`W${w}`, Math.round(waist), 2 * Math.round((waist / 2 + 6) / 2)] };
      }),
      note: `Длина L — внутренний шов в дюймах: L30 ≈ 76 см, L32 ≈ 81 см, L34 ≈ 86 см. Твоя — L${n.l}.`,
    };
  }
  if (id === "bottom") {
    return {
      columns: ["EU", "Талия, см", "Джинсы", "FR", "IT", "UK", "US"],
      rows: [32, 34, 36, 38, 40, 42, 44, 46, 48, 50, 52].map((eu) => {
        const lo = 64 + 2 * (eu - 34);
        return { me: eu === n.euTrousers, cells: [eu, range(lo, lo + 3), range(`W${Math.round(lo / 2.54)}`, `W${Math.round((lo + 3) / 2.54)}`), eu + 2, eu + 6, eu - 26, eu - 30] };
      }),
      note: `Длина джинсов L — внутренний шов в дюймах. Твоя — L${n.l}.`,
    };
  }
  if (id === "shirt") {
    return {
      columns: ["Ворот, см", "Дюймы", "Размер"],
      rows: COLLARS.map(([cm, inch, letter]) => ({ me: cm === Math.min(46, Math.max(37, n.collar)), cells: [cm, inch, letter] })),
      note: "Ворот = обхват шеи + 1 см на свободу.",
    };
  }
  // shoes: whole sizes, plus the user's half size when it is one
  const sizes = [35, 36, 37, 38, 39, 40, 41, 42, 43, 44, 45, 46, 47, 48];
  if (!sizes.includes(n.shoeEu)) sizes.push(n.shoeEu);
  sizes.sort((a, b) => a - b);
  return {
    columns: ["EU", "UK", "US муж.", "US жен.", "Стопа, см"],
    rows: sizes.map((eu) => {
      const uk = shoeUk(eu);
      return { me: eu === n.shoeEu, cells: [eu, uk, uk + 1, uk + 2, (eu / 1.5 - 1.5).toFixed(1)] };
    }),
    note: "У брендов бывает расхождение на полразмера: сверяйся с длиной стопы в таблице магазина.",
  };
}
