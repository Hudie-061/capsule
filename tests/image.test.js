import { describe, expect, it } from "vitest";
import { alphaBounds, chooseChromaKey, keyPixels, spillReport } from "../src/lib/image.js";

function pixels(list) { return new Uint8ClampedArray(list.flat()); }

describe("chroma pipeline", () => {
  it("picks a key colour far from the garment colour", () => {
    expect(chooseChromaKey("#2e7d32")).toBe("#ff00ff"); // green garment -> magenta key
    expect(chooseChromaKey("#c9b08c")).not.toBe("#ff00ff");
  });

  it("removes the key colour and keeps the garment", () => {
    const data = pixels([[0, 255, 0, 255], [3, 250, 4, 255], [201, 176, 140, 255], [60, 58, 54, 255]]);
    keyPixels(data, "#00ff00", 46);
    expect(data[3]).toBe(0);
    expect(data[7]).toBe(0);
    expect(data[11]).toBeGreaterThan(245); // warm beige keeps (almost) full opacity
    expect(data[15]).toBe(255);
    expect(spillReport(data, "#00ff00").contaminatedPixels).toBe(0);
  });

  it("suppresses green spill on garment edges", () => {
    const data = pixels([[120, 200, 110, 255]]);
    keyPixels(data, "#00ff00", 46);
    expect(spillReport(data, "#00ff00").maxSpill).toBeLessThanOrEqual(1.5);
  });

  it("finds the bounding box of visible pixels", () => {
    const w = 4; const h = 3;
    const data = new Uint8ClampedArray(w * h * 4);
    data[(1 * w + 2) * 4 + 3] = 255;
    data[(2 * w + 1) * 4 + 3] = 255;
    expect(alphaBounds(data, w, h)).toEqual({ minX: 1, minY: 1, maxX: 2, maxY: 2 });
  });
});

import { plural } from "../src/lib/plural.js";
describe("russian plurals", () => {
  it("picks the right form", () => {
    const f = ["вещь", "вещи", "вещей"];
    expect([1, 2, 3, 5, 11, 12, 21, 22, 25, 101].map((n) => plural(n, f))).toEqual(["вещь", "вещи", "вещи", "вещей", "вещей", "вещей", "вещь", "вещи", "вещей", "вещь"]);
  });
});
