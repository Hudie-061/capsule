import { describe, expect, it } from "vitest";
import { parseSize, sizeForKind, sizesSummary, stepLength, stepSize, wardrobeSizes } from "../src/lib/sizes.js";

describe("sizes from labels and from the clothes the person wears", () => {
  it("reads sizes as printed on labels", () => {
    expect(parseSize("M", "letter")).toBe("M");
    expect(parseSize("Size: xl", "letter")).toBe("XL");
    expect(parseSize("2XL", "letter")).toBe("XXL");
    expect(parseSize("Slim fit", "letter")).toBe(null);
    expect(parseSize("W32 L34", "wl")).toEqual({ w: 32, l: 34 });
    expect(parseSize("32/32", "wl")).toEqual({ w: 32, l: 32 });
    expect(parseSize("W33 L31", "wl")).toEqual({ w: 33, l: 30 }); // nearest length we search for
    expect(parseSize("UK 8 · US 9 · EU 42", "shoe")).toBe(42);
    expect(parseSize("EUR 42 2/3", "shoe")).toBe(42.5);
    expect(parseSize("44,5", "shoe")).toBe(44.5);
    expect(parseSize("EU 50 / M", "euTop")).toBe(50);
    expect(parseSize("38", "euBottom", "female")).toBe(38);
    expect(parseSize("", "letter")).toBe(null);
  });

  it("steps a size up and down", () => {
    expect(stepSize("letter", "M", 1)).toBe("L");
    expect(stepSize("letter", "XS", -1)).toBe(null);
    expect(stepSize("wl", { w: 32, l: 32 }, 1)).toEqual({ w: 33, l: 32 });
    expect(stepSize("shoe", 42, 1)).toBe(43);
    expect(stepSize("euBottom", 38, -1, "female")).toBe(36);
    expect(stepLength({ w: 32, l: 32 }, 1)).toEqual({ w: 32, l: 34 });
  });

  it("takes the size from pieces that fit, corrected for pieces that are too small or big", () => {
    const items = [
      { name: "Белая футболка", kind: "t-shirt", size: "M", fit: "good" },
      { name: "Серое худи", kind: "hoodie", size: "S", fit: "small" }, // S is small → M
      { name: "Чёрный свитер", kind: "sweater", size: "L" }, // unmarked: half a vote
      { name: "Синие джинсы", kind: "jeans", size: "W33 L32", fit: "big" }, // → W32
      { name: "Кеды", kind: "sneakers", size: "EU 43" },
      { name: "Цепочка", kind: "chain", size: "M" }, // no size system
    ];
    const owned = wardrobeSizes(items, "male");
    expect(owned.letter).toEqual({ pick: "M", count: 2, names: ["Белая футболка", "Серое худи"] });
    expect(owned.wl.pick).toEqual({ w: 32, l: 32 });
    expect(owned.shoe.pick).toBe(43);

    const body = { gender: "male", height: 180, weight: 75, measured: {} };
    const fromWardrobe = sizeForKind("hoodie", body, { owned });
    expect(fromWardrobe).toMatchObject({ value: "M", owned: true, chosen: false, ownedCount: 2 });
    const chosen = sizeForKind("hoodie", body, { owned, chosen: { letter: "L" } });
    expect(chosen).toMatchObject({ value: "L", chosen: true, fallback: { value: "M", from: "owned" } });
    expect(sizesSummary(null, { owned, gender: "male" })).toBe("верх M, джинсы W32 L32, обувь EU 43");
  });
});
