// Outfit planning, shopping gaps and preference memory. Prompts live in the proxy (proxy/worker.js);
// here we only send wardrobe data and validate what comes back.
import { contrastLevel, paletteLab, pickBest, scoreOutfit, toneOf } from "./colors.js";
import { gapsTask, learnTask, planTask } from "./gemini.js";
import { kindOf } from "./kinds.js";
import { dressForWeather, weatherPenalty } from "./weather.js";

// Every piece gets its colour in words (light/dark, warm/cool, neutral/accent, in the palette or not),
// worked out on the phone: the model reads that far better than a hex code. And its exact type
// (t-shirt, sweater, coat), so the stylist can dress for the weather.
const withTones = (items, pal) => items.map((item) => ({ ...item, kind: item.kind || kindOf(item), tone: toneOf(item, pal) }));

const isDress = (item) => item.part === "wholebody_up" && (kindOf(item) === "dress" || /dress|jumpsuit|платье|комбинезон/i.test(`${item.name} ${(item.tags || []).join(" ")}`));
const isWearable = (pieces) => pieces.some(isDress) || (pieces.some((p) => p.part === "lowerbody") && pieces.some((p) => p.part === "upperbody" || p.part === "wholebody_up"));

// «Примерить» a piece from «Хочу купить»: it is in every outfit. When the stylist left it out, it takes the
// place of the owned piece of its kind (a top for the top, a coat for the coat, a dress for top and bottom);
// an accessory is simply added. Returns the new ids, or null when no outfit can be made of the rest.
export function withPiece(itemIds, piece, byId) {
  if (!piece || itemIds.includes(piece.id)) return itemIds;
  const pieces = itemIds.map((id) => byId.get(id)).filter(Boolean);
  const outer = (p) => p.part === "wholebody_up" && !isDress(p);
  let kept;
  if (piece.part === "accessories_up") kept = pieces;
  else if (isDress(piece)) kept = pieces.filter((p) => p.part === "shoes" || p.part === "accessories_up" || outer(p));
  else if (outer(piece)) kept = pieces.filter((p) => !outer(p));
  else kept = pieces.filter((p) => p.part !== piece.part && !isDress(p));
  const next = [...kept, piece];
  return isWearable(next) ? next.map((p) => p.id) : null;
}

// The facts the Worker turns into weather rules (see readWeather in src/lib/weather.js).
// `from`: "words" (typed by the person) or "forecast" (src/lib/forecast.js, with the day's min and max).
const weatherFacts = (w) => (w?.known ? { temp: w.temp, feels: w.feels, min: w.min, max: w.max, wind: w.wind, rain: w.rain, snow: w.snow, level: w.level, from: w.from } : null);

// The stylist proposes a few more outfits than needed; each is scored on the phone by the colour rules
// (src/lib/colors.js: accents, contrast, palette near the face) and the best `count` are kept.
// Costs nothing extra: the same one request, only a slightly longer answer.
// `weather`: from the person's words (readWeather); `source` — those words, so a saved plan is checked once.
// `colors`: "simple" or "extended" palette (src/lib/palette-mode.js). `country`: for the usual weather.
// `include`: the id of a piece from «Хочу купить» that every outfit must have (it is in `items`).
export async function planOutfits({ items, profile, feedback, learned = [], count = 5, occasion = "", palette = null, weather = null, source = "", colors = "", country = "", include = "" }) {
  const pal = palette ? paletteLab(palette) : null;
  const contrast = contrastLevel(palette?.contrast);
  const extra = Math.min(8, count + 3);
  const result = await planTask({ items: withTones(items, pal), profile, feedback: feedback.slice(-40), learned, occasion, count: extra, weather: weatherFacts(weather), colors, country, include });
  const byId = new Map(items.map((item) => [item.id, item]));
  const tried = include ? byId.get(include) : null;
  const proposed = (result.outfits || [])
    .map((outfit) => ({ ...outfit, itemIds: [...new Set((outfit.itemIds || []).filter((id) => byId.has(id)))] }))
    .map((outfit) => (tried ? { ...outfit, itemIds: withPiece(outfit.itemIds, tried, byId) } : outfit))
    .filter((outfit) => outfit.itemIds && isWearable(outfit.itemIds.map((id) => byId.get(id))));
  const outfits = dressForWeather(proposed, items, weather, { pal, contrast, source })
    .map((outfit) => {
      const pieces = outfit.itemIds.map((id) => byId.get(id));
      const { score, notes } = scoreOutfit(pieces, { pal, contrast });
      return { ...outfit, colorScore: score - weatherPenalty(pieces, weather, items), colorNotes: notes };
    });
  return pickBest(outfits, count);
}

export async function findGaps({ items, profile, feedback, learned = [], palette = null, wishes = null, shown = [], dismissed = [], bought = [], replace = null }) {
  const colors = palette?.mode || "";
  const result = await gapsTask({ items: withTones(items, palette ? paletteLab(palette) : null), profile, feedback: feedback.slice(-40), learned, wishes, shown, dismissed, bought, replace, colors });
  return { summary: result.summary || "", items: result.items || [] };
}

export async function learnFromComment({ comment, outfitItems, liked, learned }) {
  const result = await learnTask({ comment, outfitItems, liked, rules: learned });
  return { rules: Array.isArray(result.rules) ? result.rules : learned, remembered: result.remembered || "", ignored: Boolean(result.ignored) };
}
