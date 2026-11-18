import { describe, expect, it } from "vitest";
import { applyGains, findWhiteSheet, sampleAt, whiteGains } from "../src/lib/white-balance.js";

// A synthetic selfie under warm light: a beige wall, a face (skin), dark hair and a cream sheet of paper.
function photo({ cast = [1.12, 1, 0.82], sheet = true } = {}) {
  const width = 120; const height = 160;
  const data = new Uint8ClampedArray(width * height * 4);
  const paint = (x0, y0, x1, y1, [r, g, b]) => {
    for (let y = y0; y < y1; y += 1) for (let x = x0; x < x1; x += 1) {
      const i = (y * width + x) * 4;
      data[i] = Math.min(255, r * cast[0]); data[i + 1] = Math.min(255, g * cast[1]); data[i + 2] = Math.min(255, b * cast[2]); data[i + 3] = 255;
    }
  };
  paint(0, 0, width, height, [150, 145, 140]); // wall
  paint(30, 20, 80, 50, [40, 30, 25]); // hair
  paint(32, 45, 78, 110, [205, 160, 135]); // face
  if (sheet) paint(82, 60, 116, 130, [215, 215, 215]); // white paper next to the face
  return { data, width, height };
}

describe("white sheet calibration", () => {
  it("finds the sheet next to the face and neutralises the warm cast", () => {
    const { data, width, height } = photo();
    const found = findWhiteSheet(data, width, height);
    expect(found).not.toBe(null);
    expect(found.box.x0).toBeCloseTo(82 / width, 1);
    expect(found.box.y0).toBeCloseTo(60 / height, 1);
    const gains = whiteGains(found.avg);
    expect(gains[0]).toBeLessThan(1); // too much red under the warm lamp
    expect(gains[2]).toBeGreaterThan(1); // too little blue
    // after the correction the paper is neutral again
    const fixed = applyGains(Uint8ClampedArray.from([...found.avg, 255]), gains);
    expect(Math.max(fixed[0], fixed[1], fixed[2]) - Math.min(fixed[0], fixed[1], fixed[2])).toBeLessThanOrEqual(2);
  });

  it("does not pick skin or a small highlight when there is no sheet", () => {
    const { data, width, height } = photo({ sheet: false });
    const found = findWhiteSheet(data, width, height);
    // only the wall can qualify, and the face never does
    if (found) expect(found.box.x0).toBe(0);
  });

  it("uses the spot the person tapped, and refuses colours that cannot be white paper", () => {
    const { data, width, height } = photo();
    const tapped = sampleAt(data, width, height, 0.83, 0.6);
    expect(whiteGains(tapped.avg)).not.toBe(null);
    const face = sampleAt(data, width, height, 0.45, 0.5);
    expect(whiteGains(face.avg)).toBe(null); // skin is far too orange to be a sheet
    expect(whiteGains([40, 30, 25])).toBe(null); // too dark
  });
});
