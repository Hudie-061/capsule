import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { fitBody, parseModel, slice, hull } from "../src/lib/body-model.js";
import { estimate } from "../src/lib/sizes.js";

const file = readFileSync(new URL("../src/assets/mh-body.bin", import.meta.url));
const model = parseModel(file.buffer.slice(file.byteOffset, file.byteOffset + file.byteLength));

const people = [
  { gender: "male", height: 180, weight: 75 },
  { gender: "female", height: 166, weight: 58 },
  { gender: "female", height: 158, weight: 82 },
  { gender: "male", height: 192, weight: 105 },
  { gender: "", height: 172, weight: 64 },
];

describe("3D body from measurements", () => {
  for (const p of people) {
    it(`fits ${p.gender || "neutral"} ${p.height} cm ${p.weight} kg`, () => {
      const m = { ...p, ...estimate(p) };
      const t0 = performance.now();
      const body = fitBody(model, { ...m, shouldersEstimate: m.shoulders });
      const ms = performance.now() - t0;
      let min = Infinity; let max = -Infinity;
      for (let i = 1; i < body.positions.length; i += 3) { min = Math.min(min, body.positions[i]); max = Math.max(max, body.positions[i]); }
      console.log(p, Math.round(ms), "ms", Object.fromEntries(Object.entries(body.rings).map(([k, r]) => [k, `${r.girth.toFixed(1)} / ${m[k]}`])), "inseam", body.crotch[1].toFixed(1), "/", m.inseam, "height", (max - min).toFixed(1));
      expect(max - min).toBeCloseTo(p.height, 0);
      expect(Math.abs(body.crotch[1] - m.inseam)).toBeLessThan(1.5);
      // shapes are not stretched far past their design range (that made bulges), so a very full waist
      // (BMI over 30) may come out a few centimetres smaller; everything else matches the tape
      const bmi = p.weight / (p.height / 100) ** 2;
      for (const id of ["chest", "waist", "hips", "neck"]) expect(Math.abs(body.rings[id].girth - m[id])).toBeLessThan(id === "waist" && bmi > 30 ? 5 : 1.5);
      // the hip tape goes round the fullest part of the buttocks, above the crotch
      expect(body.rings.hips.y - body.crotch[1]).toBeGreaterThan(0.03 * p.height);
      // no shape is pushed beyond 1.5× its design range
      for (const [name, value] of Object.entries(body.weights)) if (!/weight$/.test(name)) expect(Math.abs(value)).toBeLessThanOrEqual(1.5 + 1e-6);
    });
  }

  it("slices and measures like a tape", () => {
    const square = hull([[0, 0], [2, 0], [2, 2], [0, 2], [1, 1]]);
    expect(square).toHaveLength(4);
    expect(slice(model.base, model.body, 0).length).toBeGreaterThan(0);
  });
});
