import { describe, expect, it } from "vitest";
import { kindOf, slotOf } from "../src/lib/kinds.js";
import { estimate, fullBody, sizesFor, sizesSummary } from "../src/lib/sizes.js";

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
