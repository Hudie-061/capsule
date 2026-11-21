// «Простая» and «Расширенная» palette (owner, 21.11.2026). The extended palette is the season's fan from the
// Worker: nuanced shades such as dusty berry or terracotta. Many people, often men, only want plain everyday
// colours: black, white, grey, beige, navy. The simple palette gives those, in the shade that suits the
// season (a "grey" for a warm season is a warm grey), with plain names. It is worked out on the phone from
// the saved season, so switching costs nothing and needs no new selfie.
//
// Every colour has a role: "base" — most of the wardrobe (trousers, jackets, knitwear); "accent" — one or two
// per outfit, best near the face.
import { deltaE, hexToLab } from "./colors.js";
import { getPalette } from "./daily.js";
import { kv } from "./db.js";
import { getProfile, getSettings, saveProfile, saveSettings } from "./settings.js";

// The same season names as SEASONS in proxy/worker.js. 4 base colours, 4 accents, 4 to keep away from the face.
const SIMPLE = {
  "Светлая весна": {
    base: [["Молочный", "#F5EEDF"], ["Бежевый", "#E2CDAE"], ["Светло-серый", "#CBC4B8"], ["Светло-коричневый", "#C8A27A"]],
    accent: [["Голубой", "#9CC8E6"], ["Розовый", "#F4A6A0"], ["Светло-зелёный", "#A6D49A"], ["Синий", "#6F8FD8"]],
    avoid: [["Чёрный", "#111111"], ["Тёмно-серый", "#3C3C3C"], ["Бордовый", "#6E1A2E"], ["Тёмно-коричневый", "#3E2A1E"]],
  },
  "Тёплая весна": {
    base: [["Молочный", "#F5EDDC"], ["Бежевый", "#E8D3B0"], ["Светло-коричневый", "#C19A6B"], ["Коричневый", "#8B5A2B"]],
    accent: [["Красный", "#E2492F"], ["Зелёный", "#5FA83A"], ["Бирюзовый", "#2BB3A3"], ["Тёмно-синий", "#2C3E70"]],
    avoid: [["Чёрный", "#111111"], ["Серый", "#8A8F98"], ["Ярко-розовый", "#C2185B"], ["Бордовый", "#6E1A2E"]],
  },
  "Яркая весна": {
    base: [["Белый", "#FAF7F0"], ["Тёмно-синий", "#1F2F6B"], ["Бежевый", "#D9BF98"], ["Тёмно-серый", "#3F3D3B"]],
    accent: [["Красный", "#E8303A"], ["Синий", "#2F5DD0"], ["Зелёный", "#22A35A"], ["Бирюзовый", "#00B5AD"]],
    avoid: [["Хаки", "#8E8A63"], ["Бордовый", "#6E1A2E"], ["Серо-бежевый", "#B8AFA2"], ["Тёмно-коричневый", "#3E2A1E"]],
  },
  "Светлое лето": {
    base: [["Белый", "#F4F1EC"], ["Светло-серый", "#C9C7C5"], ["Серый", "#8E8E93"], ["Серо-голубой", "#8FA3B8"]],
    accent: [["Голубой", "#9CC3E6"], ["Розовый", "#E8B4C0"], ["Сиреневый", "#B9A6D6"], ["Мятный", "#A8DCCB"]],
    avoid: [["Чёрный", "#111111"], ["Оранжевый", "#F07C1E"], ["Горчичный", "#C79A2C"], ["Тёмно-коричневый", "#3E2A1E"]],
  },
  "Холодное лето": {
    base: [["Белый", "#EEEDEA"], ["Серый", "#8A8D91"], ["Тёмно-серый", "#4A4D52"], ["Тёмно-синий", "#34476B"]],
    accent: [["Синий", "#6F8FCF"], ["Голубой", "#9CC3E6"], ["Розовый", "#E58FB0"], ["Бордовый", "#8E2F55"]],
    avoid: [["Оранжевый", "#F07C1E"], ["Горчичный", "#C79A2C"], ["Коричневый", "#7A4A2A"], ["Чёрный", "#111111"]],
  },
  "Мягкое лето": {
    base: [["Серый", "#9A9A9C"], ["Тёмно-серый", "#5A5C60"], ["Серо-бежевый", "#B9AEA0"], ["Тёмно-синий", "#46546E"]],
    accent: [["Голубой", "#8AA2B8"], ["Розовый", "#C2949A"], ["Серо-зелёный", "#9AAE97"], ["Бордовый", "#8E4E62"]],
    avoid: [["Чёрный", "#111111"], ["Белый", "#FFFFFF"], ["Оранжевый", "#FF6A13"], ["Жёлтый", "#F4E04D"]],
  },
  "Мягкая осень": {
    base: [["Молочный", "#EFE3C8"], ["Бежевый", "#D8C3A5"], ["Светло-коричневый", "#B08D57"], ["Серо-коричневый", "#8B7D6B"]],
    accent: [["Хаки", "#7D7650"], ["Серо-зелёный", "#9AA382"], ["Персиковый", "#D9A58B"], ["Бирюзовый", "#4F7D78"]],
    avoid: [["Чёрный", "#111111"], ["Белый", "#FFFFFF"], ["Ярко-розовый", "#D1338C"], ["Голубой", "#CFE8F5"]],
  },
  "Тёплая осень": {
    base: [["Бежевый", "#EAD7B5"], ["Светло-коричневый", "#B5864E"], ["Коричневый", "#5B3A29"], ["Оливковый", "#6B6B2A"]],
    accent: [["Красный", "#B3412C"], ["Горчичный", "#C99A2E"], ["Зелёный", "#3F6B3A"], ["Бирюзовый", "#1F6F6B"]],
    avoid: [["Чёрный", "#111111"], ["Розовый", "#E58FB0"], ["Светло-серый", "#D5D9DE"], ["Ярко-синий", "#2948C2"]],
  },
  "Тёмная осень": {
    base: [["Тёмно-коричневый", "#3E2A1E"], ["Хаки", "#5A5236"], ["Тёмно-серый", "#3F3A36"], ["Бежевый", "#CBB28E"]],
    accent: [["Бордовый", "#7B2D26"], ["Тёмно-зелёный", "#1E6B52"], ["Горчичный", "#B88A1E"], ["Тёмно-бирюзовый", "#1F5A66"]],
    avoid: [["Розовый", "#F4C2D0"], ["Голубой", "#CFE8F5"], ["Светло-серый", "#C0C4C8"], ["Сиреневый", "#B9A6D6"]],
  },
  "Тёмная зима": {
    base: [["Чёрный", "#111111"], ["Тёмно-серый", "#333333"], ["Тёмно-синий", "#1B2240"], ["Белый", "#F7F7F5"]],
    accent: [["Бордовый", "#6D1A36"], ["Зелёный", "#0B6E4F"], ["Синий", "#2948C2"], ["Красный", "#C8102E"]],
    avoid: [["Светло-коричневый", "#C19A6B"], ["Оранжевый", "#F07C1E"], ["Персиковый", "#D9A58B"], ["Оливковый", "#6F6B3E"]],
  },
  "Холодная зима": {
    base: [["Белый", "#FFFFFF"], ["Чёрный", "#111111"], ["Серый", "#7D8590"], ["Тёмно-синий", "#1F2A50"]],
    accent: [["Розовый", "#C2187A"], ["Синий", "#2948C2"], ["Зелёный", "#009B77"], ["Красный", "#C8102E"]],
    avoid: [["Оранжевый", "#F07C1E"], ["Горчичный", "#C79A2C"], ["Светло-коричневый", "#C19A6B"], ["Коричневый", "#7A4A2A"]],
  },
  "Яркая зима": {
    base: [["Белый", "#FFFFFF"], ["Чёрный", "#111111"], ["Тёмно-синий", "#1B2A6B"], ["Серый", "#8C9096"]],
    accent: [["Красный", "#E0102F"], ["Синий", "#1F4FE0"], ["Зелёный", "#00A86B"], ["Розовый", "#E0218A"]],
    avoid: [["Хаки", "#8E8A63"], ["Серо-бежевый", "#A39B91"], ["Светло-коричневый", "#B08D57"], ["Бледно-розовый", "#C2949A"]],
  },
};

export const PALETTE_MODES = ["simple", "extended"];
export const hasSimple = (season) => Object.hasOwn(SIMPLE, season || "");

// Until the person chooses: plain colours for men, the full fan for women and everyone else (as before).
export const defaultPaletteMode = (gender) => (gender === "male" ? "simple" : "extended");

// The explanation of a simple colour: the stylist's own words about the nearest colour of the full fan, when
// it is the same family of colour; otherwise a plain line by role.
function borrowWhy(hex, list, fallback) {
  const lab = hexToLab(hex);
  const near = (list || []).reduce((best, c) => { const d = deltaE(lab, hexToLab(c.hex)); return d < best.d ? { d, why: c.why } : best; }, { d: Infinity, why: "" });
  return near.d < 22 && near.why ? near.why : fallback;
}

// The palette as the person sees and uses it in this mode: { ...result, best, avoid, mode }, every best colour
// with its role. Unknown season (should not happen): the extended palette as it is.
export function paletteFor(result, mode) {
  if (!result) return null;
  const extended = {
    ...result,
    mode: "extended",
    best: (result.best || []).map((c, i) => ({ ...c, role: c.role || (i < 3 ? "base" : "accent") })),
    avoid: result.avoid || [],
  };
  if (mode !== "simple" || !hasSimple(result.season)) return extended;
  const fan = SIMPLE[result.season];
  return {
    ...result,
    mode: "simple",
    best: [
      ...fan.base.map(([name, hex]) => ({ name, hex, role: "base", why: borrowWhy(hex, result.best, "База: с этим цветом сочетаются все остальные твои цвета") })),
      ...fan.accent.map(([name, hex]) => ({ name, hex, role: "accent", why: borrowWhy(hex, result.best, "Подходит к твоему подтону — хорош у лица: футболка, свитер, шарф") })),
    ],
    avoid: fan.avoid.map(([name, hex]) => ({ name, hex, why: borrowWhy(hex, result.avoid, "У лица спорит с твоими цветами — лучше в брюках или обуви") })),
  };
}

export async function getPaletteMode() {
  const [settings, profile] = await Promise.all([getSettings(), getProfile()]);
  return PALETTE_MODES.includes(settings.paletteMode) ? settings.paletteMode : defaultPaletteMode(profile.gender);
}

// What «Сегодня» and «Покупки» use: the saved season in the person's mode (null without a palette).
// A palette saved before the modes existed still has the full fan in the profile line the stylist reads (a man
// gets the simple palette by default now): the line is brought to the mode here, once, and «Чего не хватает»
// is made again. A line the person wrote themself (not starting with the season) is left alone.
export async function getActivePalette() {
  const saved = await getPalette();
  if (!saved?.result) return null;
  const p = paletteFor(saved.result, await getPaletteMode());
  const profile = await getProfile();
  const line = paletteProfileText(p);
  if (profile.palette !== line && (!profile.palette || profile.palette.startsWith(p.season))) {
    await saveProfile({ ...profile, palette: line });
    await kv.del("gaps");
  }
  return p;
}

// The stylist reads this from the profile: season, undertone and contrast, then the colours of the chosen mode.
export function paletteProfileText(p) {
  if (!p) return "";
  const traits = [p.undertone, p.contrast].filter(Boolean).join(", ");
  const colors = p.best.map((c) => c.name.toLowerCase()).join(", ");
  const avoid = p.avoid.length ? `; у лица избегать: ${p.avoid.map((c) => c.name.toLowerCase()).join(", ")}` : "";
  return `${p.season}${traits ? ` (${traits})` : ""}${p.mode === "simple" ? ", простые цвета" : ""}: ${colors}${avoid}`;
}

// A switch takes effect everywhere: the profile line for the stylist, and «Чего не хватает» is made again
// (the old cards were picked for the other palette).
export async function setPaletteMode(mode) {
  if (!PALETTE_MODES.includes(mode)) return;
  await saveSettings({ paletteMode: mode });
  const saved = await getPalette();
  if (saved?.result) {
    const profile = await getProfile();
    await saveProfile({ ...profile, palette: paletteProfileText(paletteFor(saved.result, mode)) });
    await kv.del("gaps");
  }
}
