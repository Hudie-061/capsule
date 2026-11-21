import { describe, expect, it } from "vitest";
import { brandLatin, isOfBrand, withBrand, withoutBrand } from "../src/lib/brands.js";
import { shopQueryFor } from "../src/lib/chains.js";

describe("brands", () => {
  it("writes the brand the way shops do", () => {
    expect(brandLatin("Томми Хилфигер")).toBe("Tommy Hilfiger");
    expect(brandLatin("томми")).toBe("Tommy Hilfiger");
    expect(brandLatin("tommy hilfiger")).toBe("Tommy Hilfiger");
    expect(brandLatin("Левайс")).toBe("Levi's");
    expect(brandLatin("Эйч энд эм")).toBe("H&M");
    expect(brandLatin("Carhartt WIP")).toBe("Carhartt");
    expect(brandLatin("Acne Studios")).toBe("Acne Studios"); // an unknown Latin name stays as written
    expect(brandLatin("Свой бренд")).toBe("Svoy Brend"); // an unknown Cyrillic name is transliterated
    expect(brandLatin("")).toBe("");
  });

  it("finds the brand in a product title, in any case and spelling", () => {
    expect(isOfBrand("TOMMY HILFIGER Logo Hoodie Black Zalando", "Tommy Hilfiger")).toBe(true);
    expect(isOfBrand("Tommy Jeans hoodie", "Tommy Hilfiger")).toBe(false);
    expect(isOfBrand("Levis 501 Original", "Levi's")).toBe(true);
    expect(isOfBrand("Basic hoodie", "")).toBe(false);
  });

  it("the owner's case: a black Tommy Hilfiger hoodie from «Хочу купить»", () => {
    const wish = { item: "Чёрное худи", part: "upperbody", kind: "hoodie", color: "#111111", query: "black hoodie" };
    const plain = withoutBrand(shopQueryFor(wish, "male"), "Tommy Hilfiger");
    expect(plain).toBe("men black hoodie");
    expect(withBrand(plain, "Tommy Hilfiger")).toBe("men Tommy Hilfiger black hoodie"); // «такой же»
    expect(withoutBrand("men tommy hilfiger black hoodie", "Tommy Hilfiger")).toBe("men black hoodie"); // «похожие»
    expect(withBrand("black hoodie", "Tommy Hilfiger")).toBe("Tommy Hilfiger black hoodie");
  });
});
