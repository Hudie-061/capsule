// The weather from the person's own words in «Повод и погода»: «+6 и ветрено», «минус 3, снег», «холодно»,
// «дождь» — or from the forecast for the person's place (src/lib/forecast.js); the person's own words win. Nothing
// is guessed. The phone turns it into facts (temperature, wind, rain, snow) for the stylist, and checks the outfits afterwards: in the
// cold every outfit gets a coat or jacket from the wardrobe, in the heat it loses one. Before this the words
// went to the stylist as plain text and it could ignore them (+6 and windy gave a t-shirt and no jacket).
import { scoreOutfit } from "./colors.js";
import { kindOf } from "./kinds.js";

// feels-like temperature → level: frost ≤ 0 < cold ≤ 10 < cool ≤ 15 < mild ≤ 21 < warm
const LEVELS = [[0, "frost"], [10, "cold"], [15, "cool"], [21, "mild"]];
const levelOf = (t) => (LEVELS.find(([max]) => t <= max) || [0, "warm"])[1];
const signed = (t) => `${t > 0 ? "+" : ""}${t}`;
const outerFor = (level, rain, snow) => ({
  needOuter: ["frost", "cold", "cool"].includes(level) || ((rain || snow) && level !== "warm"),
  noOuter: level === "warm" && !rain && !snow,
});

// The same facts from a forecast (src/lib/forecast.js): the hours from 8:00 to 20:00 of the day, when the person
// is out. Dressed for the average "feels like" of those hours (it already counts the wind); windy from 30 km/h
// (a fresh breeze), rain from 1 mm or a likely shower, snow from 2 mm.
// hours: [{ temp, feels, pop, rain, snow, wind }] — °C, °C, %, mm, cm, km/h.
export function weatherFromHours(hours) {
  const list = (hours || []).filter((h) => Number.isFinite(h?.temp) && Number.isFinite(h?.feels));
  if (!list.length) return null;
  const sum = (k) => list.reduce((s, h) => s + (Number.isFinite(h[k]) ? h[k] : 0), 0);
  const most = (k) => Math.max(0, ...list.map((h) => (Number.isFinite(h[k]) ? h[k] : 0)));
  const temps = list.map((h) => h.temp);
  const min = Math.round(Math.min(...temps));
  const max = Math.round(Math.max(...temps));
  const temp = Math.round(sum("temp") / list.length);
  const feels = Math.round(sum("feels") / list.length);
  const wind = most("wind") >= 30;
  const rain = sum("rain") >= 1 || (most("pop") >= 50 && sum("rain") >= 0.3);
  const snow = sum("snow") >= 0.2;
  const level = levelOf(feels);
  const range = min === max ? `${signed(min)} °C` : `${signed(min)}…${signed(max)} °C`;
  const label = [range, wind ? "ветер" : "", rain ? "дождь" : "", snow ? "снег" : ""].filter(Boolean).join(", ");
  return { temp, feels, min, max, wind, rain, snow, level, ...outerFor(level, rain, snow), label, known: true, from: "forecast" };
}

function readTemp(t) {
  const word = /(минус|плюс)\s*(\d{1,2})(?!\d)/.exec(t);
  if (word) return (word[1] === "минус" ? -1 : 1) * Number(word[2]);
  const signed = /(?:^|[\s(,;:])([+-])\s?(\d{1,2})(?![\d:.,]*\d)/.exec(t);
  if (signed) return (signed[1] === "-" ? -1 : 1) * Number(signed[2]);
  const marked = /(?:^|[^\d:.,])(\d{1,2})\s*(°|℃|градус|град\b|гр\b|тепла|мороза)/.exec(t);
  if (marked) return (marked[2] === "мороза" ? -1 : 1) * Number(marked[1]);
  if (/(?:^|[^а-я])(ноль|нуля|нулю)(?![а-я])/.test(t)) return 0;
  return null;
}

// { temp, feels, wind, rain, snow, level, needOuter, noOuter, label, known }
export function readWeather(text) {
  const t = String(text || "").toLowerCase().replace(/ё/g, "е").replace(/[−–—]/g, "-");
  const temp = readTemp(t);
  const wind = /ветр|ветер|ветрен|вьюг|\bwind/.test(t);
  const rain = /дожд|ливн|ливен|морос|слякот|\brain/.test(t);
  const snow = /снег|снеж|метел|вьюг|\bsnow/.test(t);
  let level = "";
  let feels = null;
  if (temp !== null) {
    feels = temp - (wind ? 4 : 0) - (rain ? 1 : 0);
    level = levelOf(feels);
  } else if (snow || /мороз(?!а)|морозн|\bfreez/.test(t)) level = "frost";
  else if (/холод|зябк|\bcold/.test(t)) level = "cold";
  else if (/прохлад|\bcool/.test(t) || rain) level = "cool";
  else if (/жар[ак]|жарищ|зно[йя]|духот|\bhot/.test(t)) level = "warm";
  else if (/тепл|\bwarm/.test(t)) level = "mild";
  const parts = [
    temp !== null ? `${signed(temp)} °C` : { frost: "мороз", cold: "холодно", cool: "прохладно", mild: "тепло", warm: "жарко" }[level] || "",
    wind ? "ветер" : "", rain ? "дождь" : "", snow ? "снег" : "",
  ].filter(Boolean);
  return { temp, feels, wind, rain, snow, level, ...outerFor(level, rain, snow), label: parts.join(", "), known: Boolean(level || wind || rain || snow), from: "words" };
}

const isDress = (item) => item?.part === "wholebody_up" && kindOf(item) === "dress";
export const isOuterwear = (item) => item?.part === "wholebody_up" && !isDress(item);
// a coat or a jacket; a blazer is worn indoors too and does not keep anyone warm at +6
export const isWarmOuter = (item) => isOuterwear(item) && kindOf(item) !== "blazer";
const isWearable = (pieces) => pieces.some(isDress) || (pieces.some((p) => p.part === "lowerbody") && pieces.some((p) => p.part === "upperbody" || p.part === "wholebody_up"));
const short = (name, n = 32) => (name.length > n ? `${name.slice(0, n - 1)}…` : name);

// Every outfit checked against the weather. In the cold: a coat or jacket is added (the one that suits the
// colours best, a different one across outfits when there is a choice); a blazer gives way to it in real cold.
// In the heat: coats and jackets come off. Outfits the person edited by hand are left alone. Each outfit
// remembers which words it was checked for (`weatherFor`), so a saved plan is not changed twice.
export function dressForWeather(outfits, items, weather, { pal = null, contrast = "", source = "" } = {}) {
  if (!weather?.known) return outfits;
  const byId = new Map(items.map((i) => [i.id, i]));
  const used = new Map();
  const warm = items.filter(isWarmOuter);
  const realCold = weather.level === "frost" || weather.level === "cold";
  return outfits.map((outfit) => {
    if (outfit.edited || (source && outfit.weatherFor === source)) return outfit;
    let ids = [...outfit.itemIds];
    const pieces = () => ids.map((id) => byId.get(id)).filter(Boolean);
    let note = "";
    if (weather.needOuter && !pieces().some(isWarmOuter)) {
      const blazer = pieces().find(isOuterwear);
      const keepBlazer = blazer && !realCold;
      if (!keepBlazer) {
        const base = pieces().filter((p) => p !== blazer);
        const pick = warm
          .filter((c) => !ids.includes(c.id))
          .map((c) => ({ c, score: scoreOutfit([...base, c], { pal, contrast }).score - 6 * (used.get(c.id) || 0) + (weather.level === "frost" && kindOf(c) === "coat" ? 6 : 0) }))
          .sort((a, b) => b.score - a.score)[0]?.c;
        if (pick) {
          ids = [...ids.filter((id) => id !== blazer?.id), pick.id];
          note = `${weather.label}: добавил «${short(pick.name)}» — в помещении её можно снять.`;
        } else if (!blazer) {
          note = `${weather.label} — а куртки или пальто в гардеробе нет. Добавь их через ＋, и я буду их надевать.`;
        }
      }
    }
    if (weather.noOuter) {
      const rest = pieces().filter((p) => !isWarmOuter(p));
      if (rest.length < pieces().length && isWearable(rest)) {
        ids = rest.map((p) => p.id);
        note = `${weather.label}: без куртки и пальто.`;
      }
    }
    for (const p of pieces()) if (isWarmOuter(p)) used.set(p.id, (used.get(p.id) || 0) + 1);
    const tips = note ? [{ title: "По погоде", why: note }, ...(outfit.tips || []).filter((t) => t.title !== "По погоде")].slice(0, 3) : outfit.tips;
    return { ...outfit, itemIds: ids, tips, weatherFor: source || outfit.weatherFor };
  });
}

// A t-shirt as the only top in the cold ranks lower when the wardrobe has knitwear (the stylist was asked
// for warm tops; this catches it when it did not listen).
export function weatherPenalty(pieces, weather, items) {
  if (!weather || !["frost", "cold"].includes(weather.level)) return 0;
  const hasKnit = items.some((i) => ["sweater", "hoodie"].includes(kindOf(i)));
  const tops = pieces.filter((p) => p.part === "upperbody");
  const onlyTee = tops.length > 0 && tops.every((p) => kindOf(p) === "t-shirt");
  return hasKnit && onlyTee ? 10 : 0;
}
