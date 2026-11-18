// Outfit planning, shopping gaps and preference memory. Prompts live in the proxy (proxy/worker.js);
// here we only send wardrobe data and validate what comes back.
import { contrastLevel, paletteLab, pickBest, scoreOutfit, toneOf } from "./colors.js";
import { gapsTask, learnTask, planTask } from "./gemini.js";

// Every piece gets its colour in words (light/dark, warm/cool, neutral/accent, in the palette or not),
// worked out on the phone: the model reads that far better than a hex code.
const withTones = (items, pal) => items.map((item) => ({ ...item, tone: toneOf(item, pal) }));

const isDress = (item) => item.part === "wholebody_up" && /dress|jumpsuit|платье|комбинезон/i.test(`${item.name} ${(item.tags || []).join(" ")}`);

// The stylist proposes a few more outfits than needed; each is scored on the phone by the colour rules
// (src/lib/colors.js: accents, contrast, palette near the face) and the best `count` are kept.
// Costs nothing extra: the same one request, only a slightly longer answer.
export async function planOutfits({ items, profile, feedback, learned = [], count = 5, occasion = "", palette = null }) {
  const pal = palette ? paletteLab(palette) : null;
  const contrast = contrastLevel(palette?.contrast);
  const extra = Math.min(8, count + 3);
  const result = await planTask({ items: withTones(items, pal), profile, feedback: feedback.slice(-40), learned, occasion, count: extra });
  const byId = new Map(items.map((item) => [item.id, item]));
  const outfits = (result.outfits || [])
    .map((outfit) => ({ ...outfit, itemIds: [...new Set((outfit.itemIds || []).filter((id) => byId.has(id)))] }))
    .filter((outfit) => {
      const pieces = outfit.itemIds.map((id) => byId.get(id));
      const parts = pieces.map((p) => p.part);
      return pieces.some(isDress) || (parts.includes("lowerbody") && (parts.includes("upperbody") || parts.includes("wholebody_up")));
    })
    .map((outfit) => {
      const { score, notes } = scoreOutfit(outfit.itemIds.map((id) => byId.get(id)), { pal, contrast });
      return { ...outfit, colorScore: score, colorNotes: notes };
    });
  return pickBest(outfits, count);
}

export async function findGaps({ items, profile, feedback, learned = [], palette = null, wishes = null, shown = [], dismissed = [], bought = [] }) {
  const result = await gapsTask({ items: withTones(items, palette ? paletteLab(palette) : null), profile, feedback: feedback.slice(-40), learned, wishes, shown, dismissed, bought });
  return { summary: result.summary || "", items: result.items || [] };
}

export async function learnFromComment({ comment, outfitItems, liked, learned }) {
  const result = await learnTask({ comment, outfitItems, liked, rules: learned });
  return { rules: Array.isArray(result.rules) ? result.rules : learned, remembered: result.remembered || "", ignored: Boolean(result.ignored) };
}
