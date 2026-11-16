import { describe, expect, it } from "vitest";
import { kindOf, slotOf } from "../src/lib/kinds.js";
import { bodyOrProfile, estimate, fullBody, sizeChart, sizeForKind, sizesFor, sizesSummary } from "../src/lib/sizes.js";

describe("sizes", () => {
  it("estimates plausible measurements from height and weight", () => {
    const m = estimate({ gender: "male", height: 180, weight: 75 });
    expect(m.chest).toBeGreaterThan(92);
    expect(m.chest).toBeLessThan(108);
    expect(m.inseam).toBe(81);
    expect(m.foot).toBeCloseTo(27.4, 1);
  });

  it("uses the user's own measurements over estimates", () => {
    const { values, estimated } = fullBody({ gender: "male", height: 180, weight: 75, measured: { chest: 112 } });
    expect(values.chest).toBe(112);
    expect(estimated.has("chest")).toBe(false);
    expect(estimated.has("waist")).toBe(true);
  });

  it("turns measurements into sizes", () => {
    const sizes = Object.fromEntries(sizesFor({ gender: "male", height: 180, weight: 75, measured: { chest: 100, waist: 84, inseam: 81, neck: 39, foot: 27 } }).map((s) => [s.id, s]));
    expect(sizes.top.value).toBe("M");
    expect(sizes.top.detail).toBe("EU 50");
    expect(sizes.jeans.value).toBe("W33 L32");
    expect(sizes.jeans.detail).toBe("брюки EU 48");
    expect(sizes.shirt.value).toBe("ворот 40");
    expect(sizes.shoes.value).toBe("EU 43"); // (27 + 1.5) × 1.5 = 42.75 → nearest half size
    expect(sizes.top.estimated).toBe(false);
  });

  it("suggests a size up for oversize and has no collar size for women", () => {
    const sizes = sizesFor({ gender: "female", height: 166, weight: 58, measured: { chest: 86 } }, { oversize: true });
    expect(sizes.find((s) => s.id === "top").value).toBe("S");
    expect(sizes.find((s) => s.id === "top").note).toBe("Для оверсайза бери M");
    expect(sizes.some((s) => s.id === "shirt")).toBe(false);
    expect(sizesSummary({ gender: "female", height: 166, weight: 58 })).toMatch(/^верх \S+, джинсы W\d+ L\d+, обувь EU/);
  });
});

describe("size in the shop search", () => {
  const man = { gender: "male", height: 180, weight: 75, measured: { chest: 100, waist: 84, inseam: 81, neck: 39, foot: 27 } };
  const woman = { gender: "female", height: 166, weight: 58, measured: { chest: 86, waist: 68, foot: 24 } };

  it("picks the size system the piece is sold in", () => {
    expect(sizeForKind("hoodie", man)).toMatchObject({ value: "M", query: "size M", detail: "EU 50", estimated: false });
    expect(sizeForKind("shirt", man)).toMatchObject({ value: "M", detail: "ворот 40" });
    expect(sizeForKind("blazer", man)).toMatchObject({ value: "EU 50", query: "size 50", detail: "M" });
    expect(sizeForKind("jeans", man)).toMatchObject({ value: "W33 L32", query: "W33 L32" });
    expect(sizeForKind("trousers", man).query).toBe("W33 L32");
    expect(sizeForKind("shorts", man).query).toBe("W33");
    expect(sizeForKind("sneakers", man)).toMatchObject({ value: "EU 43", query: "size 43" });
    expect(sizeForKind("trousers", woman)).toMatchObject({ value: "EU 36", query: "size 36" });
    expect(sizeForKind("skirt", woman).query).toBe("size 36");
    expect(sizeForKind("shirt", woman).detail).toBe("EU 36");
  });

  it("searches half shoe sizes as the whole number and skips accessories", () => {
    const half = sizeForKind("boots", { ...man, measured: { foot: 26.5 } }); // (26.5 + 1.5) × 1.5 = 42
    expect(half.query).toBe("size 42");
    const between = sizeForKind("boots", { ...man, measured: { foot: 26.8 } }); // 42.45 → EU 42.5
    expect(between).toMatchObject({ value: "EU 42.5", query: "size 42", shown: "size 42.5" }); // the user sees 42.5
    expect(sizeForKind("jeans", man).shown).toBe("W33 L32");
    expect(sizeForKind("bag", man)).toBeNull();
    expect(sizeForKind("chain", man)).toBeNull();
    expect(sizeForKind("hoodie", null)).toBeNull();
  });

  it("only keeps characters the Worker allows in a query", () => {
    for (const kind of ["t-shirt", "blazer", "jeans", "trousers", "shorts", "sneakers"]) {
      for (const body of [man, woman]) expect(sizeForKind(kind, body).query).toMatch(/^[\p{L}\p{N} '-]+$/u);
    }
  });

  it("falls back to height and weight from the profile", () => {
    expect(bodyOrProfile(man, {})).toBe(man);
    expect(bodyOrProfile(null, { gender: "female", height: "166 см", weight: "58,5 кг" })).toEqual({ gender: "female", height: 166, weight: 58.5, measured: {} });
    expect(bodyOrProfile(null, { height: "" })).toBeNull();
    expect(sizeForKind("hoodie", bodyOrProfile(null, { height: "180", weight: "75" })).estimated).toBe(true);
  });
});

describe("item kinds", () => {
  it("reads the type from detection or from the Russian name", () => {
    expect(kindOf({ kind: "blazer" })).toBe("blazer");
    expect(kindOf({ name: "Тёмно-синий пиджак", part: "wholebody_up" })).toBe("blazer");
    expect(kindOf({ name: "Белая рубашка", part: "upperbody" })).toBe("shirt");
    expect(kindOf({ item: "Чёрные кожаные ботинки", part: "shoes" })).toBe("boots");
    expect(kindOf({ name: "Что-то", part: "lowerbody" })).toBe("trousers");
  });

  it("puts accessories on the right place of the body", () => {
    expect(slotOf({ name: "Серебряная цепочка" })).toBe("neck");
    expect(slotOf({ kind: "cap" })).toBe("head");
    expect(slotOf({ kind: "watch" })).toBe("wrist");
    expect(slotOf({ name: "Коричневая сумка" })).toBe("hand");
  });
});

describe("size charts", () => {
  const man = { gender: "male", height: 180, weight: 75, measured: { chest: 100, waist: 84, inseam: 81, neck: 39, foot: 27 } };
  const woman = { gender: "female", height: 166, weight: 58, measured: { chest: 86, waist: 68, foot: 24.8 } };
  const mine = (chart) => chart.rows.filter((r) => r.me).map((r) => r.cells);

  it("marks the user's row in every chart", () => {
    expect(mine(sizeChart("top", man))).toEqual([["M", "96–103", "48–50", "38–40"]]);
    expect(mine(sizeChart("bottom", man))).toEqual([["W33", 84, 48]]);
    expect(mine(sizeChart("shirt", man))).toEqual([[40, "15¾", "M"]]);
    expect(mine(sizeChart("shoes", man))[0][0]).toBe(43);
    expect(mine(sizeChart("top", woman))).toEqual([[36, "S", "84–87", 38, 42, 10, 6]]);
    expect(mine(sizeChart("bottom", woman))[0][0]).toBe(36);
  });

  it("converts shoe sizes like the usual tables", () => {
    const row = (eu) => sizeChart("shoes", man).rows.find((r) => r.cells[0] === eu).cells;
    expect(row(42).slice(0, 4)).toEqual([42, 8, 9, 10]);
    expect(row(38)[1]).toBe(5);
    expect(row(45)[1]).toBe(10.5);
    // a half size is added as its own row
    const half = sizeChart("shoes", woman);
    expect(mine(half)[0][0]).toBe(39.5);
  });
});
