// Colour maths for outfits, on the phone (no AI call, no cost). A language model reads "#1f2a44" badly,
// so every piece gets a plain description from its colour in CIE Lab / LCh (the space colour analysts and
// the textile industry use): light or dark, warm or cool, neutral or accent, and how close it is to the
// person's palette. The stylist model gets these words; afterwards each outfit it proposes is scored by
// the same rules the stylist prompt asks for, and the best ones are shown.
//
// ΔE here is CIE76 (straight distance in Lab): about 2–3 is a just noticeable difference; under ~15
// counts as "the same family of colour" for clothes, which is all we need.

const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

export function hexToLab(hex) {
  const m = /^#?([0-9a-f]{6})$/i.exec(String(hex || "").trim());
  if (!m) return null;
  const n = Number.parseInt(m[1], 16);
  const lin = (c) => { const v = c / 255; return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
  const r = lin((n >> 16) & 255); const g = lin((n >> 8) & 255); const b = lin(n & 255);
  // sRGB → XYZ (D65) → Lab
  const x = (0.4124 * r + 0.3576 * g + 0.1805 * b) / 0.95047;
  const y = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  const z = (0.0193 * r + 0.1192 * g + 0.9505 * b) / 1.08883;
  const f = (t) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
  const L = 116 * f(y) - 16;
  const A = 500 * (f(x) - f(y));
  const B = 200 * (f(y) - f(z));
  const C = Math.hypot(A, B);
  const h = (Math.atan2(B, A) * 180 / Math.PI + 360) % 360;
  return { L, a: A, b: B, C, h };
}

export const deltaE = (p, q) => (p && q ? Math.hypot(p.L - q.L, p.a - q.a, p.b - q.b) : Infinity);

// Fashion neutrals are wider than "grey": navy, denim, charcoal, chocolate, camel, beige, cream, olive-khaki.
export function describeColor(hex) {
  const c = hexToLab(hex);
  if (!c) return null;
  const neutral = c.C < 12
    || (c.L < 40 && c.C < 32) // navy, charcoal, chocolate, dark olive
    || (c.L > 72 && c.C < 24) // cream, ecru, stone, light beige
    || (c.h >= 50 && c.h <= 100 && c.C < 36 && c.L >= 35) // camel, tan, khaki, taupe, beige
    || (c.h >= 220 && c.h <= 290 && c.C < 30 && c.L < 62); // denim, slate blue
  const temp = c.C < 8 ? "neutral" : c.h >= 20 && c.h < 135 ? "warm" : "cool";
  const depth = c.L >= 70 ? "light" : c.L <= 38 ? "dark" : "medium";
  const vivid = !neutral && c.C >= 45;
  return { ...c, neutral, temp, depth, vivid };
}

// The person's palette (from «Моя палитра») as Lab colours.
export function paletteLab(palette) {
  const list = (arr) => (Array.isArray(arr) ? arr : []).map((c) => ({ name: c.name, lab: hexToLab(c.hex) })).filter((c) => c.lab);
  return { best: list(palette?.best), avoid: list(palette?.avoid) };
}

// "in palette" when close to one of the best colours, "avoid" when closer to a colour to avoid.
export function paletteFit(hex, pal) {
  const c = hexToLab(hex);
  if (!c || !pal) return { fit: "", name: "" };
  const nearest = (list) => list.reduce((best, x) => { const d = deltaE(c, x.lab); return d < best.d ? { d, name: x.name } : best; }, { d: Infinity, name: "" });
  const good = nearest(pal.best);
  const bad = nearest(pal.avoid);
  if (bad.d < 14 && bad.d < good.d) return { fit: "avoid", name: bad.name };
  if (good.d < 18) return { fit: "best", name: good.name };
  return { fit: "", name: "" };
}

// One short English line for the stylist prompt, e.g. "dark cool neutral; in the person's palette (Тёмно-синий)".
export function toneOf(item, pal) {
  const d = describeColor(item?.color);
  if (!d) return "";
  const words = [d.depth, d.temp === "neutral" ? "" : d.temp, d.neutral ? "neutral" : d.vivid ? "bright accent" : "accent"].filter(Boolean).join(" ");
  const fit = paletteFit(item.color, pal);
  const tail = fit.fit === "best" ? `; in the person's palette (${fit.name})` : fit.fit === "avoid" ? `; close to a colour to avoid near the face (${fit.name})` : "";
  return `${words}${tail}`;
}

// Person's contrast from the palette text: «низкий/мягкий», «средний», «высокий/контрастный».
export function contrastLevel(text) {
  const t = String(text || "").toLowerCase();
  if (/низк|мягк|слаб/.test(t)) return "low";
  if (/высок|сильн|ярк/.test(t)) return "high";
  if (/средн/.test(t)) return "medium";
  return "";
}

const MAIN = new Set(["upperbody", "wholebody_up", "lowerbody"]);
const hueGap = (a, b) => { const d = Math.abs(a - b) % 360; return d > 180 ? 360 - d : d; };

// Score an outfit by the stylist rules (0…100) and say why, so the best of the proposed outfits win.
// - at most two accent colours, and two accents should be neighbours or opposites on the colour wheel;
// - a warm and a cool bright accent together look busy;
// - light-dark contrast close to the person's own contrast;
// - near the face (top, jacket) colours from the palette, not the ones to avoid.
export function scoreOutfit(pieces, { pal = null, contrast = "" } = {}) {
  const colored = pieces.map((p) => ({ p, d: describeColor(p.color) })).filter((x) => x.d);
  const main = colored.filter((x) => MAIN.has(x.p.part));
  let score = 70;
  const notes = [];

  // accents: group shades of the same hue
  const accents = [];
  for (const x of colored.filter((y) => !y.d.neutral && y.p.part !== "accessories_up")) {
    if (!accents.some((a) => hueGap(a.h, x.d.h) < 25)) accents.push(x.d);
  }
  if (accents.length > 2) { score -= 18 * (accents.length - 2); notes.push("too many colours"); }
  if (accents.length === 2) {
    const gap = hueGap(accents[0].h, accents[1].h);
    if (gap <= 50) notes.push("analogous");
    else if (gap >= 150) { score -= 3; notes.push("complementary"); }
    else { score -= 12; notes.push("clashing hues"); }
    if (accents[0].vivid && accents[1].vivid && accents[0].temp !== accents[1].temp) { score -= 8; notes.push("warm and cool brights"); }
  }
  if (accents.length <= 1) { score += 6; notes.push(accents.length ? "one accent" : "tonal"); }

  // contrast of the main pieces against the person's own contrast
  if (main.length >= 2) {
    const ls = main.map((x) => x.d.L);
    const span = Math.max(...ls) - Math.min(...ls);
    const [lo, hi] = contrast === "low" ? [0, 40] : contrast === "high" ? [40, 100] : contrast === "medium" ? [18, 65] : [0, 100];
    const off = span < lo ? lo - span : span > hi ? span - hi : 0;
    score -= clamp(off / 2, 0, 20);
    if (off) notes.push(span > hi ? "contrast too strong" : "contrast too soft");
  }

  // colours near the face
  if (pal) {
    const face = colored.filter((x) => x.p.part === "upperbody" || x.p.part === "wholebody_up");
    const fits = face.map((x) => paletteFit(x.p.color, pal).fit);
    if (fits.includes("avoid")) { score -= 15; notes.push("avoid-colour near the face"); }
    else if (fits.includes("best")) { score += 10; notes.push("palette colour near the face"); }
  }
  return { score: Math.round(clamp(score, 0, 100)), notes };
}

// The English word shops use for a colour, by the nearest of these in Lab. Everything sent to shops and
// to the price search is English (the owner's rule, 18.11.2026): the interface is Russian, the shops are not.
const COLOR_WORDS = [
  ["black", "#111111"], ["white", "#F7F7F5"], ["cream", "#EFE6D2"], ["beige", "#D8C3A5"], ["camel", "#B08D57"], ["brown", "#6B4423"],
  ["light grey", "#C8C8C8"], ["grey", "#8A8A8A"], ["charcoal", "#3C3C3C"], ["navy", "#1F2A44"], ["blue", "#2F5DA8"], ["light blue", "#9CC3E6"],
  ["olive", "#6F6B3E"], ["khaki", "#A69B6B"], ["green", "#2E7D4F"], ["burgundy", "#6E1A2E"], ["red", "#C8102E"], ["pink", "#E58FB0"],
  ["purple", "#6B4A8E"], ["yellow", "#F2C94C"], ["orange", "#E8742A"],
].map(([name, hex]) => ({ name, lab: hexToLab(hex) }));

export function colorNameEn(hex) {
  const c = hexToLab(hex);
  if (!c) return "";
  return COLOR_WORDS.reduce((best, x) => { const d = deltaE(c, x.lab); return d < best.d ? { d, name: x.name } : best; }, { d: Infinity, name: "" }).name;
}

// Keep the best `count` outfits, but never two with the same pieces.
export function pickBest(outfits, count) {
  const seen = new Set();
  return [...outfits]
    .sort((a, b) => (b.colorScore ?? 0) - (a.colorScore ?? 0))
    .filter((o) => { const key = [...o.itemIds].sort().join("+"); if (seen.has(key)) return false; seen.add(key); return true; })
    .slice(0, count);
}
