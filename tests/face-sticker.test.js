import { describe, expect, it } from "vitest";
import { skinTone } from "../src/face-sticker.jsx";

describe("sticker face", () => {
  it("takes the skin from the palette undertone", () => {
    expect(skinTone("тёплый подтон")).toBe("warm");
    expect(skinTone("Теплый")).toBe("warm");
    expect(skinTone("холодный подтон")).toBe("cool");
    expect(skinTone("нейтральный")).toBe("neutral");
    expect(skinTone("")).toBe("neutral");
    expect(skinTone(undefined)).toBe("neutral");
  });
});
