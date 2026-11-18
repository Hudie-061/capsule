import { describe, expect, it } from "vitest";
import { checkPose, faceBox, isStill, phoneUpright } from "../src/lib/pose-check.js";

// A person facing the camera in a 1080×1920 frame, arms a little away from the body, feet hip-wide.
function front(overrides = {}) {
  const lm = Array.from({ length: 33 }, () => ({ x: 0.5, y: 0.3, visibility: 0.9 }));
  const set = (i, x, y) => { lm[i] = { x, y, visibility: 0.95 }; };
  set(0, 0.5, 0.17); set(2, 0.515, 0.16); set(5, 0.485, 0.16); set(7, 0.53, 0.17); set(8, 0.47, 0.17);
  set(11, 0.59, 0.25); set(12, 0.41, 0.25); set(13, 0.64, 0.38); set(14, 0.36, 0.38); set(15, 0.7, 0.5); set(16, 0.3, 0.5);
  set(23, 0.55, 0.52); set(24, 0.45, 0.52); set(25, 0.55, 0.7); set(26, 0.45, 0.7);
  set(27, 0.56, 0.88); set(28, 0.44, 0.88); set(29, 0.56, 0.9); set(30, 0.44, 0.9); set(31, 0.57, 0.9); set(32, 0.43, 0.9);
  for (const [i, p] of Object.entries(overrides)) lm[i] = { ...lm[i], ...p };
  return lm;
}
const shift = (lm, dx) => lm.map((p) => ({ ...p, x: p.x + dx }));

describe("pose checks for the camera", () => {
  it("accepts a good front pose and says what to fix otherwise", () => {
    expect(checkPose(front()).id).toBe("ok");
    expect(checkPose(front({ 15: { x: 0.6, y: 0.52 }, 16: { x: 0.4, y: 0.52 } })).id).toBe("armsOut");
    expect(checkPose(front({ 15: { x: 0.95, y: 0.3 }, 16: { x: 0.05, y: 0.3 } })).id).toBe("armsDown");
    expect(checkPose(front({ 27: { x: 0.51 }, 28: { x: 0.49 }, 29: { x: 0.51 }, 30: { x: 0.49 } })).id).toBe("feetApart");
    expect(checkPose(front({ 27: { visibility: 0.1 }, 28: { visibility: 0.1 } })).id).toBe("feet");
    expect(checkPose(front({ 0: { y: 0.03 }, 11: { y: 0.1 }, 12: { y: 0.1 } })).id).toBe("head");
    expect(checkPose(shift(front(), -0.3)).id).toBe("left");
    expect(checkPose(shift(front(), 0.3)).id).toBe("right");
    expect(checkPose([]).id).toBe("none");
  });

  it("asks to come closer when the person is small in the frame", () => {
    const small = front().map((p) => ({ ...p, y: 0.4 + (p.y - 0.3) * 0.5 }));
    expect(checkPose(small).id).toBe("closer");
  });

  it("checks the side view: turned sideways, arms along the body", () => {
    const side = front({ 11: { x: 0.505 }, 12: { x: 0.495 }, 15: { x: 0.52, y: 0.5 }, 16: { x: 0.5, y: 0.5 } });
    expect(checkPose(side, { view: "side" }).id).toBe("ok");
    expect(checkPose(front(), { view: "side" }).id).toBe("side");
    expect(checkPose(side).id).toBe("face"); // not facing the camera for the front photo
    expect(checkPose(front({ 11: { x: 0.505 }, 12: { x: 0.495 }, 15: { x: 0.75, y: 0.4 } }), { view: "side" }).id).toBe("armsAlong");
  });

  it("checks that the phone stands upright", () => {
    expect(phoneUpright({ beta: 88, gamma: 3 })).toBe(true);
    expect(phoneUpright({ beta: 60, gamma: 0 })).toBe(false);
    expect(phoneUpright(null)).toBe(true); // no sensor on a computer
    expect(checkPose(front(), { tilt: { beta: 45, gamma: 0 } }).id).toBe("tilt");
  });

  it("knows when the person stands still", () => {
    const still = Array.from({ length: 9 }, (_, i) => ({ t: i * 100, landmarks: front() }));
    expect(isStill(still)).toBe(true);
    const moving = still.map((h, i) => ({ ...h, landmarks: shift(front(), i * 0.01) }));
    expect(isStill(moving)).toBe(false);
    expect(isStill(still.slice(0, 3))).toBe(false); // not long enough yet
  });

  it("cuts the head and shoulders for the palette, only when the face is big enough", () => {
    const box = faceBox(front(), 1080, 1920);
    expect(box.w).toBeGreaterThan(150);
    expect(box.x).toBeLessThan(540);
    expect(box.x + box.w).toBeGreaterThan(540);
    expect(box.y).toBeLessThan(0.16 * 1920);
    expect(faceBox(front(), 200, 356)).toBe(null); // a tiny photo
    expect(faceBox(front({ 2: { visibility: 0.1 } }), 1080, 1920)).toBe(null);
  });
});
