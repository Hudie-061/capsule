// Outfit planning, shopping gaps and preference memory. Prompts live in the proxy (proxy/worker.js);
// here we only send wardrobe data and validate what comes back.
import { gapsTask, learnTask, planTask } from "./gemini.js";

const isDress = (item) => item.part === "wholebody_up" && /dress|jumpsuit|платье|комбинезон/i.test(`${item.name} ${(item.tags || []).join(" ")}`);

export async function planOutfits({ items, profile, feedback, learned = [], count = 5, occasion = "" }) {
  const result = await planTask({ items, profile, feedback: feedback.slice(-40), learned, occasion, count });
  const byId = new Map(items.map((item) => [item.id, item]));
  return (result.outfits || [])
    .map((outfit) => ({ ...outfit, itemIds: [...new Set((outfit.itemIds || []).filter((id) => byId.has(id)))] }))
    .filter((outfit) => {
      const pieces = outfit.itemIds.map((id) => byId.get(id));
      const parts = pieces.map((p) => p.part);
      return pieces.some(isDress) || (parts.includes("lowerbody") && (parts.includes("upperbody") || parts.includes("wholebody_up")));
    });
}

export async function findGaps({ items, profile, feedback, learned = [] }) {
  const result = await gapsTask({ items, profile, feedback: feedback.slice(-40), learned });
  return { summary: result.summary || "", items: result.items || [] };
}

export async function learnFromComment({ comment, outfitItems, liked, learned }) {
  const result = await learnTask({ comment, outfitItems, liked, rules: learned });
  return { rules: Array.isArray(result.rules) ? result.rules : learned, remembered: result.remembered || "", ignored: Boolean(result.ignored) };
}
