import { describe, expect, it } from "vitest";
import { contrastLevel, describeColor, hexToLab, paletteFit, paletteLab, pickBest, scoreOutfit, toneOf } from "../src/lib/colors.js";

const softAutumn = paletteLab({
  best: [{ name: "Тауп", hex: "#8B7D6B" }, { name: "Кэмел", hex: "#B08D57" }, { name: "Олива", hex: "#6F6B3E" }, { name: "Терракота", hex: "#B5735A" }],
  avoid: [{ name: "Чёрный", hex: "#111111" }, { name: "Фуксия", hex: "#D1338C" }, { name: "Ледяной голубой", hex: "#CFE8F5" }],
});
const piece = (part, color, id = color) => ({ id, part, color });

describe("colour maths", () => {
  it("converts to Lab like the reference (white, black, red)", () => {
    expect(hexToLab("#ffffff").L).toBeCloseTo(100, 0);
    expect(hexToLab("#000000").L).toBeCloseTo(0, 0);
    const red = hexToLab("#ff0000");
    expect(red.L).toBeCloseTo(53.2, 0);
    expect(red.a).toBeCloseTo(80.1, 0);
    expect(hexToLab("nope")).toBe(null);
  });

  it("knows fashion neutrals from accents, and warm from cool", () => {
    for (const hex of ["#1f2a44", "#2b3a55", "#b08d57", "#efe3c8", "#808080", "#3e2a1e"]) expect(describeColor(hex).neutral).toBe(true); // navy, denim, camel, cream, grey, chocolate
    for (const hex of ["#e2492f", "#d1338c", "#00a86b", "#f2b630"]) expect(describeColor(hex).neutral).toBe(false);
    expect(describeColor("#e2492f").temp).toBe("warm");
    expect(describeColor("#2948c2").temp).toBe("cool");
    expect(describeColor("#f4f1ec").depth).toBe("light");
    expect(describeColor("#1b2240").depth).toBe("dark");
  });

  it("tells whether a colour is in the person's palette", () => {
    expect(paletteFit("#6b673b", softAutumn)).toEqual({ fit: "best", name: "Олива" });
    expect(paletteFit("#151515", softAutumn)).toEqual({ fit: "avoid", name: "Чёрный" });
    expect(paletteFit("#2948c2", softAutumn).fit).toBe("");
    expect(toneOf({ color: "#b5735a" }, softAutumn)).toBe("medium warm accent; in the person's palette (Терракота)");
    expect(contrastLevel("средний контраст")).toBe("medium");
    expect(contrastLevel("мягкий контраст")).toBe("low");
  });

  it("scores outfits by the stylist rules: few accents, matching contrast, palette near the face", () => {
    const opts = { pal: softAutumn, contrast: "medium" };
    const calm = scoreOutfit([piece("upperbody", "#b5735a"), piece("lowerbody", "#2b3a55"), piece("shoes", "#efe3c8")], opts);
    const busy = scoreOutfit([piece("upperbody", "#d1338c"), piece("lowerbody", "#00a86b"), piece("wholebody_up", "#f2b630")], opts);
    const blackTop = scoreOutfit([piece("upperbody", "#111111"), piece("lowerbody", "#2b3a55")], opts);
    expect(calm.score).toBeGreaterThan(busy.score);
    expect(busy.notes).toContain("too many colours");
    expect(calm.notes).toContain("palette colour near the face");
    expect(blackTop.notes).toContain("avoid-colour near the face");
    expect(calm.score).toBeGreaterThan(blackTop.score);
  });

  it("keeps the best outfits and drops repeats", () => {
    const list = pickBest([
      { itemIds: ["a", "b"], colorScore: 60 }, { itemIds: ["b", "a"], colorScore: 90 }, { itemIds: ["c", "d"], colorScore: 70 }, { itemIds: ["e", "f"], colorScore: 40 },
    ], 2);
    expect(list.map((o) => o.colorScore)).toEqual([90, 70]);
  });
});
