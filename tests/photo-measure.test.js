import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { fitBody, parseModel } from "../src/lib/body-model.js";
import { checkPhoto, crotchShare, ellipse, measureFromPhotos, silhouette } from "../src/lib/photo-measure.js";
import { estimate } from "../src/lib/sizes.js";

const file = readFileSync(new URL("../src/assets/mh-body.bin", import.meta.url));
const model = parseModel(file.buffer.slice(file.byteOffset, file.byteOffset + file.byteLength));

// A synthetic «photo»: the 3D body seen from the front (x) or the side (z), filled triangle by
// triangle into a person mask, with the landmarks MediaPipe would give. The 3D body stands with its
// arms out (A-pose); in the side photo the user's arms hang along the body inside its outline, so
// the arms are left out of the side view.
function photo(fit, view, { scale = 6, legsTogether = false, grow = 0 } = {}) {
  const pos = fit.positions; const H = fit.height;
  const width = Math.round(150 * scale); const height = Math.round((H + 24) * scale);
  const ox = width / 2; const oy = height - 12 * scale;
  const u = (i) => ox + (view === "front" ? pos[i * 3] : pos[i * 3 + 2]) * scale;
  const v = (i) => oy - pos[i * 3 + 1] * scale;
  const data = new Float32Array(width * height);
  const tri = model.body;
  for (let t = 0; t < tri.length; t += 3) {
    const [a, b, c] = [tri[t], tri[t + 1], tri[t + 2]];
    if (view === "side" && [a, b, c].every((i) => Math.abs(pos[i * 3]) > 0.14 * H)) continue;
    const ax = u(a); const ay = v(a); const bx = u(b); const by = v(b); const cx = u(c); const cy = v(c);
    const area = (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
    if (Math.abs(area) < 1e-9) continue;
    for (let y = Math.max(0, Math.floor(Math.min(ay, by, cy))); y <= Math.min(height - 1, Math.ceil(Math.max(ay, by, cy))); y += 1) {
      for (let x = Math.max(0, Math.floor(Math.min(ax, bx, cx))); x <= Math.min(width - 1, Math.ceil(Math.max(ax, bx, cx))); x += 1) {
        const px = x + 0.5; const py = y + 0.5;
        const w0 = ((bx - px) * (cy - py) - (by - py) * (cx - px)) / area;
        const w1 = ((cx - px) * (ay - py) - (cy - py) * (ax - px)) / area;
        if (w0 >= 0 && w1 >= 0 && w0 + w1 <= 1) data[y * width + x] = 1;
      }
    }
  }
  // a real photo from waist height shows the toes below the floor line (see photo-measure.js)
  const toes = Math.round(0.015 * H * scale / 0.985);
  for (let y = Math.round(oy); y < Math.min(height, oy + toes); y += 1) for (let x = Math.round(ox - 12 * scale); x <= ox - 6 * scale; x += 1) data[y * width + x] = 1;
  if (legsTogether) for (let y = Math.round(oy - 0.5 * H * scale); y < oy; y += 1) for (let x = Math.round(ox - 6 * scale); x <= ox + 6 * scale; x += 1) data[y * width + x] = 1;
  // a mask that spills over the edge by `grow` pixels (soft edges, clothing)
  for (let g = 0; g < grow; g += 1) {
    const copy = data.slice();
    for (let y = 1; y < height - 1; y += 1) for (let x = 1; x < width - 1; x += 1) if (!copy[y * width + x] && (copy[y * width + x - 1] || copy[y * width + x + 1] || copy[(y - 1) * width + x] || copy[(y + 1) * width + x])) data[y * width + x] = 1;
  }
  const at = (x, y, z = 0) => ({ x: (ox + (view === "front" ? x : z) * scale) / width, y: (oy - y * scale) / height, visibility: 0.99 });
  const [l, r] = fit.shoulders;
  const marks = [];
  marks[0] = at(0, 0.93 * H, 10);
  marks[11] = at(l[0], l[1], l[2]); marks[12] = at(r[0], r[1], r[2]);
  marks[23] = at(9, fit.crotch[1] + 0.05 * H, fit.crotch[2]); marks[24] = at(-9, fit.crotch[1] + 0.05 * H, fit.crotch[2]);
  marks[27] = at(10, 0.039 * H); marks[28] = at(-10, 0.039 * H);
  return silhouette({ data, width, height }, marks);
}

const people = [
  { gender: "male", height: 180, weight: 80, chest: 104, waist: 92, hips: 101, inseam: 83 },
  { gender: "female", height: 165, weight: 62, chest: 92, waist: 74, hips: 100, inseam: 76 },
  { gender: "female", height: 160, weight: 85, chest: 108, waist: 98, hips: 116, inseam: 72 },
  { gender: "male", height: 175, weight: 72, chest: 104, waist: 78, hips: 95, inseam: 80 }, // far from the estimate
];

describe("measuring by photo", () => {
  it("knows an ellipse", () => {
    expect(ellipse(20, 20)).toBeCloseTo(Math.PI * 20, 6);
    expect(ellipse(30, 20)).toBeCloseTo(79.33, 1);
  });

  for (const p of people) {
    it(`finds the measurements of ${p.gender} ${p.height} cm ${p.weight} kg`, () => {
      const base = estimate(p);
      const truth = fitBody(model, { ...base, ...p, shoulders: base.shoulders * 1.04, shouldersEstimate: base.shoulders });
      const want = { chest: truth.rings.chest.girth, waist: truth.rings.waist.girth, hips: truth.rings.hips.girth, inseam: truth.crotch[1], shoulders: base.shoulders * 1.04 };
      const front = photo(truth, "front"); const side = photo(truth, "side");
      expect(checkPhoto(front, "front").error).toBeUndefined();
      expect(checkPhoto(side, "side").error).toBeUndefined();
      expect(checkPhoto(side, "front").error).toMatch(/сбоку/);

      const t0 = performance.now();
      const both = measureFromPhotos({ model, front, side, gender: p.gender, height: p.height, weight: p.weight, estimates: base });
      const ms = performance.now() - t0;
      const only = measureFromPhotos({ model, front, gender: p.gender, height: p.height, weight: p.weight, estimates: base });
      const err = (r) => Object.fromEntries(Object.entries(want).map(([k, v]) => [k, r.values[k] === undefined ? "—" : +(r.values[k] - v).toFixed(1)]));
      console.log(p.gender, p.height, p.weight, Math.round(ms), "ms", "with side", err(both), "front only", err(only), "estimate", err({ values: base }));
      expect(both.dropped).toEqual([]);
      for (const id of ["chest", "waist", "hips"]) {
        expect(Math.abs(both.values[id] - want[id])).toBeLessThan(3);
        expect(Math.abs(only.values[id] - want[id])).toBeLessThan(6);
      }
      expect(Math.abs(both.values.inseam - want.inseam)).toBeLessThan(1.5);
      expect(Math.abs(both.values.shoulders - want.shoulders)).toBeLessThan(2);
      expect(both.lines.front.map((l) => l.id).sort()).toEqual(["chest", "hips", "inseam", "shoulders", "waist"]);
      expect(both.lines.side.map((l) => l.id).sort()).toEqual(["chest", "hips", "waist"]);
    });
  }

  it("stays close on a coarse photo with soft edges", () => {
    const p = people[1];
    const base = estimate(p);
    const truth = fitBody(model, { ...base, ...p, shouldersEstimate: base.shoulders });
    const r = measureFromPhotos({ model, front: photo(truth, "front", { scale: 3, grow: 1 }), side: photo(truth, "side", { scale: 3, grow: 1 }), gender: p.gender, height: p.height, weight: p.weight, estimates: base });
    console.log("coarse", r.values, "truth", { chest: truth.rings.chest.girth.toFixed(1), waist: truth.rings.waist.girth.toFixed(1), hips: truth.rings.hips.girth.toFixed(1), inseam: truth.crotch[1].toFixed(1) });
    for (const id of ["chest", "waist", "hips"]) expect(Math.abs(r.values[id] - truth.rings[id].girth)).toBeLessThan(4);
    expect(Math.abs(r.values.inseam - truth.crotch[1])).toBeLessThan(2);
  });

  it("needs a gap between the legs for the inside leg", () => {
    const p = people[0];
    const truth = fitBody(model, { ...p, ...estimate(p), shouldersEstimate: estimate(p).shoulders });
    expect(crotchShare(photo(truth, "front"))).toBeGreaterThan(0.4);
    const r = measureFromPhotos({ model, front: photo(truth, "front", { legsTogether: true }), gender: p.gender, height: p.height, weight: p.weight, estimates: estimate(p) });
    expect(r.values.inseam).toBeUndefined();
    expect(r.warnings.join(" ")).toMatch(/внутренний шов/);
  });

  it("refuses photos it cannot measure", () => {
    expect(checkPhoto(silhouette({ data: new Float32Array(100 * 100), width: 100, height: 100 }), "front").error).toMatch(/Не вижу/);
    const cut = new Float32Array(100 * 300);
    for (let y = 0; y < 300; y += 1) for (let x = 40; x < 60; x += 1) cut[y * 100 + x] = 1;
    expect(checkPhoto(silhouette({ data: cut, width: 100, height: 300 }), "front").error).toMatch(/Голова/);
    expect(checkPhoto(silhouette({ data: cut, width: 100, height: 300 }), "front", 2).error).toMatch(/одного/);
  });
});
