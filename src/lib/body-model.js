// Realistic 3D body: the MakeHuman hm08 base mesh and shape targets (CC0 1.0, makehumancommunity/
// makehuman), converted into src/assets/mh-body.bin by a one-off script (see CLAUDE.md, «3D-тело»).
// Everything here is plain math with no three.js, so it runs in tests too:
// 1. parseModel — read the binary (Int16 positions, Uint16 triangles, sparse Int16 target deltas).
// 2. fitBody — blend gender and weight, then solve the measure targets so the body has the user's
//    inside leg, hips, waist, chest and neck girths (measured like a tape: the convex hull of a
//    horizontal slice through the torso), scale it to the exact height and stretch the feet.
// The result is in centimetres with the feet on y = 0, facing +z.

export function parseModel(buffer) {
  const bytes = new Uint8Array(buffer);
  if (String.fromCharCode(...bytes.subarray(0, 4)) !== "MHB1") throw new Error("Не тот файл модели");
  const view = new DataView(buffer);
  const headLength = view.getUint32(4, true);
  const meta = JSON.parse(new TextDecoder().decode(bytes.subarray(8, 8 + headLength)));
  const data = 8 + headLength;
  const n = meta.vertices;
  const toCm = 10; // the mesh is in decimetres
  const rawPos = new Int16Array(buffer, data + meta.positions, n * 3);
  const base = new Float32Array(n * 3);
  for (let i = 0; i < n * 3; i += 1) base[i] = rawPos[i] * meta.positionScale * toCm;
  const targets = {};
  for (const t of meta.targets) {
    const raw = new Int16Array(buffer, data + t.delta, t.count * 3);
    const delta = new Float32Array(t.count * 3);
    for (let i = 0; i < t.count * 3; i += 1) delta[i] = raw[i] * t.scale * toCm;
    targets[t.name] = { index: new Uint16Array(buffer, data + t.index, t.count), delta };
  }
  return {
    n, base, targets,
    body: new Uint16Array(buffer, data + meta.body.at, meta.body.count),
    eyes: new Uint16Array(buffer, data + meta.eyes.at, meta.eyes.count),
  };
}

// Mutable blend of targets over the base mesh.
class Shape {
  constructor(model) {
    this.model = model;
    this.pos = Float32Array.from(model.base);
    this.weights = {};
  }
  set(name, weight) {
    const t = this.model.targets[name];
    const change = weight - (this.weights[name] || 0);
    if (!t || Math.abs(change) < 1e-6) return;
    const { index, delta } = t;
    for (let i = 0; i < index.length; i += 1) {
      const p = index[i] * 3;
      this.pos[p] += change * delta[i * 3];
      this.pos[p + 1] += change * delta[i * 3 + 1];
      this.pos[p + 2] += change * delta[i * 3 + 2];
    }
    this.weights[name] = weight;
  }
  // a measure slider from -1 (decr) to +1 (incr)
  measure(name, value) {
    this.set(`${name}-decr`, Math.max(0, -value));
    this.set(`${name}-incr`, Math.max(0, value));
  }
}

function yRange(pos, n) {
  let min = Infinity; let max = -Infinity;
  for (let i = 0; i < n; i += 1) { const y = pos[i * 3 + 1]; if (y < min) min = y; if (y > max) max = y; }
  return [min, max];
}

// Triangles that cross a band of heights, so repeated slices near one level stay cheap.
function trianglesNear(pos, index, y, margin) {
  const out = [];
  for (let t = 0; t < index.length; t += 3) {
    const a = pos[index[t] * 3 + 1]; const b = pos[index[t + 1] * 3 + 1]; const c = pos[index[t + 2] * 3 + 1];
    if (Math.max(a, b, c) >= y - margin && Math.min(a, b, c) <= y + margin) out.push(index[t], index[t + 1], index[t + 2]);
  }
  return out;
}

// Horizontal slice through the mesh: connected loops of [x, z] points.
export function slice(pos, triangles, y) {
  const level = y + 1e-4;
  const point = new Map(); // edge key -> [x, z]
  const parent = new Map();
  const find = (k) => { let r = k; while (parent.get(r) !== r) r = parent.get(r); parent.set(k, r); return r; };
  const edge = (a, b) => {
    const key = a < b ? a * 65536 + b : b * 65536 + a;
    if (!point.has(key)) {
      const ya = pos[a * 3 + 1]; const yb = pos[b * 3 + 1];
      const t = (level - ya) / (yb - ya);
      point.set(key, [pos[a * 3] + t * (pos[b * 3] - pos[a * 3]), pos[a * 3 + 2] + t * (pos[b * 3 + 2] - pos[a * 3 + 2])]);
      parent.set(key, key);
    }
    return key;
  };
  for (let t = 0; t < triangles.length; t += 3) {
    const v = [triangles[t], triangles[t + 1], triangles[t + 2]];
    const crossing = [];
    for (let k = 0; k < 3; k += 1) {
      const a = v[k]; const b = v[(k + 1) % 3];
      if ((pos[a * 3 + 1] - level) * (pos[b * 3 + 1] - level) < 0) crossing.push(edge(a, b));
    }
    if (crossing.length === 2) { const ra = find(crossing[0]); const rb = find(crossing[1]); if (ra !== rb) parent.set(ra, rb); }
  }
  const loops = new Map();
  for (const key of point.keys()) {
    const r = find(key);
    if (!loops.has(r)) loops.set(r, []);
    loops.get(r).push(point.get(key));
  }
  return [...loops.values()];
}

export function hull(points) {
  const p = [...points].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  if (p.length < 3) return p;
  const cross = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lower = []; const upper = [];
  for (const q of p) { while (lower.length >= 2 && cross(lower.at(-2), lower.at(-1), q) <= 0) lower.pop(); lower.push(q); }
  for (const q of p.reverse()) { while (upper.length >= 2 && cross(upper.at(-2), upper.at(-1), q) <= 0) upper.pop(); upper.push(q); }
  return lower.slice(0, -1).concat(upper.slice(0, -1));
}

const perimeter = (h) => h.reduce((sum, q, i) => sum + Math.hypot(q[0] - h[(i + 1) % h.length][0], q[1] - h[(i + 1) % h.length][1]), 0);

// The torso loop at a level (the one that crosses the middle line), measured like a tape.
function torsoGirth(pos, triangles, y) {
  const loops = slice(pos, triangles, y).filter((l) => l.length > 8);
  const torso = loops.filter((l) => Math.min(...l.map((q) => q[0])) < 0 && Math.max(...l.map((q) => q[0])) > 0);
  const best = (torso.length ? torso : loops).sort((a, b) => b.length - a.length)[0];
  if (!best) return { girth: 0, hull: [] };
  const h = hull(best);
  return { girth: perimeter(h), hull: h };
}

// Lowest point of the crotch: the lowest vertex on the middle line between the legs.
function crotchOf(pos, n, min, height) {
  let best = null;
  for (let i = 0; i < n; i += 1) {
    const x = pos[i * 3]; const y = pos[i * 3 + 1];
    if (Math.abs(x) < 0.6 && y > min + 0.35 * height && y < min + 0.6 * height && (!best || y < best[1])) best = [x, y, pos[i * 3 + 2]];
  }
  return best;
}

// Solve f(w) = goal for one slider (f grows with w), secant steps with a bisection guard.
function solve(f, goal, lo = -1.5, hi = 2) {
  let a = 0; let fa = f(a) - goal;
  if (Math.abs(fa) < 0.05) return a;
  let b = fa < 0 ? 0.5 : -0.5; let fb = f(b) - goal;
  let low = lo; let high = hi;
  for (let i = 0; i < 12; i += 1) {
    if (fa < 0) low = Math.max(low, a); else high = Math.min(high, a);
    if (fb < 0) low = Math.max(low, b); else high = Math.min(high, b);
    let next = fb !== fa ? b - (fb * (b - a)) / (fb - fa) : (low + high) / 2;
    if (!(next > low && next < high)) next = (low + high) / 2;
    a = b; fa = fb; b = next; fb = f(b) - goal;
    if (Math.abs(fb) < 0.05 || high - low < 1e-3) break;
  }
  return b;
}

const GIRTHS = [
  // [measurement, target, where on the body]
  ["hips", "hips-circ", "hips"],
  ["waist", "waist-circ", "waist"],
  ["chest", "bust-circ", "chest"],
  ["neck", "neck-circ", "neck"],
];

export function fitBody(model, m) {
  const shape = new Shape(model);
  const { n } = model;
  const female = m.gender === "female" ? 1 : m.gender === "male" ? 0 : 0.5;
  shape.set("female", female);
  shape.set("male", 1 - female);
  // MakeHuman weight 0…1 (0.5 = average) from BMI
  const bmi = m.weight / ((m.height / 100) ** 2);
  const w = Math.min(1, Math.max(0, bmi < 22 ? 0.5 - (22 - bmi) / 10 : 0.5 + (bmi - 22) / 16));
  for (const [g, share] of [["f", female], ["m", 1 - female]]) {
    shape.set(`${g}-minweight`, share * Math.max(0, (0.5 - w) * 2));
    shape.set(`${g}-maxweight`, share * Math.max(0, (w - 0.5) * 2));
  }

  // inside leg as a share of height (scale-free), then the scale to the exact height
  const legShare = () => { const [min, max] = yRange(shape.pos, n); const c = crotchOf(shape.pos, n, min, max - min); return c ? (c[1] - min) / (max - min) : 0.45; };
  shape.measure("upperleg-height", solve((v) => { shape.measure("upperleg-height", v); return legShare() * 100; }, (m.inseam / m.height) * 100, -1.5, 1.5));
  let [min, max] = yRange(shape.pos, n);
  const s = m.height / (max - min);
  const H = max - min;

  // where each girth is taken, found once on this body
  const at = (share) => min + share * H;
  const near = (y) => trianglesNear(shape.pos, model.body, y, 0.04 * H);
  const crotch = crotchOf(shape.pos, n, min, H);
  const scan = (from, to, pick) => {
    let best = null;
    for (let i = 0; i <= 6; i += 1) {
      const y = from + ((to - from) * i) / 6;
      const g = torsoGirth(shape.pos, near(y), y).girth;
      if (g && (!best || pick(g, best.g))) best = { y, g };
    }
    return best.y;
  };
  let bust = at(0.72); let front = -Infinity;
  for (let i = 0; i < n; i += 1) {
    const y = shape.pos[i * 3 + 1]; const z = shape.pos[i * 3 + 2];
    if (y > at(0.66) && y < at(0.78) && Math.abs(shape.pos[i * 3]) < 0.12 * H && z > front) { front = z; bust = y; }
  }
  const levels = {
    hips: scan(crotch[1] + 0.02 * H, crotch[1] + 0.12 * H, (g, b) => g > b),
    waist: scan(at(0.57), at(0.66), (g, b) => g < b),
    chest: bust,
    neck: scan(at(0.82), at(0.865), (g, b) => g < b),
  };
  const bands = Object.fromEntries(Object.entries(levels).map(([id, y]) => [id, near(y)]));
  const girthAt = (id) => torsoGirth(shape.pos, bands[id], levels[id]).girth * s;

  // shoulders: follow the user's difference from the estimate, as a share of this body's width
  const shoulderWidth = () => {
    let left = null; let right = null;
    for (let i = 0; i < n; i += 1) {
      const x = shape.pos[i * 3]; const y = shape.pos[i * 3 + 1];
      if (y < at(0.76) || y > at(0.85) || Math.abs(x) < 0.07 * H || Math.abs(x) > 0.3 * H) continue; // shoulder tips, not the neck or the hands
      const score = Math.abs(x) + 2 * (y - min);
      if (x > 0 && (!left || score > left.score)) left = { score, i };
      if (x < 0 && (!right || score > right.score)) right = { score, i };
    }
    return { width: (shape.pos[left.i * 3] - shape.pos[right.i * 3]) * s, left: left.i, right: right.i };
  };
  if (m.shoulders && m.shouldersEstimate) {
    const goal = shoulderWidth().width * (m.shoulders / m.shouldersEstimate);
    shape.measure("shoulder-dist", solve((v) => { shape.measure("shoulder-dist", v); return shoulderWidth().width; }, goal, -1.5, 1.5));
  }

  // two passes: the targets overlap a little (bust and waist, waist and hips)
  for (let pass = 0; pass < 2; pass += 1) {
    for (const [id, target, level] of GIRTHS) {
      if (!m[id]) continue;
      shape.measure(target, solve((v) => { shape.measure(target, v); return girthAt(level); }, m[id], -1.5, 2.5));
    }
  }

  const shoulderIdx = shoulderWidth();

  // centimetres, feet on the floor, centred
  const pos = shape.pos;
  [min, max] = yRange(pos, n);
  let cx = 0; let cz = 0;
  for (let i = 0; i < n; i += 1) { cx += pos[i * 3]; cz += pos[i * 3 + 2]; }
  cx /= n; cz /= n;
  for (let i = 0; i < n; i += 1) {
    pos[i * 3] = (pos[i * 3] - cx) * s;
    pos[i * 3 + 1] = (pos[i * 3 + 1] - min) * s;
    pos[i * 3 + 2] = (pos[i * 3 + 2] - cz) * s;
  }

  // feet: stretch along z below the ankle to the user's foot length
  const ankle = 0.045 * m.height;
  const footLength = (side) => {
    let lo = Infinity; let hi = -Infinity;
    for (let i = 0; i < n; i += 1) if (pos[i * 3 + 1] < ankle * 0.5 && Math.sign(pos[i * 3]) === side) { lo = Math.min(lo, pos[i * 3 + 2]); hi = Math.max(hi, pos[i * 3 + 2]); }
    return [lo, hi];
  };
  if (m.foot) {
    for (const side of [-1, 1]) {
      const [heel, toe] = footLength(side);
      const k = m.foot / (toe - heel);
      for (let i = 0; i < n; i += 1) {
        const y = pos[i * 3 + 1];
        if (Math.sign(pos[i * 3]) !== side || y > ankle) continue;
        const t = Math.min(1, Math.max(0, (ankle - y) / (ankle * 0.5))); // full stretch at the sole, none at the ankle
        const kk = 1 + (k - 1) * t;
        pos[i * 3 + 2] = heel + (pos[i * 3 + 2] - heel) * kk;
      }
    }
  }

  // measurement lines for the view
  const all = model.body;
  const ring = (id) => {
    const y = (levels[id] - min) * s;
    const { girth, hull: h } = torsoGirth(pos, trianglesNear(pos, all, y, 3), y);
    return { y, girth, points: h };
  };
  const fitted = Object.fromEntries(["chest", "waist", "hips", "neck"].map((id) => [id, ring(id)]));
  const [minY] = yRange(pos, n);
  const c = crotchOf(pos, n, minY, m.height);
  const point = (i) => [pos[i * 3], pos[i * 3 + 1], pos[i * 3 + 2]];
  const innerAnkle = (() => {
    let best = null;
    for (let i = 0; i < n; i += 1) {
      const x = pos[i * 3]; const y = pos[i * 3 + 1];
      if (x > 0 && y > ankle * 0.9 && y < ankle * 1.3 && (!best || x < best[0])) best = point(i);
    }
    return best;
  })();
  const [heel, toe] = footLength(-1);
  let outer = 0;
  for (let i = 0; i < n; i += 1) if (pos[i * 3] < 0 && pos[i * 3 + 1] < ankle * 0.5) outer = Math.min(outer, pos[i * 3]);
  return {
    positions: pos,
    rings: fitted,
    crotch: c,
    shoulders: [point(shoulderIdx.left), point(shoulderIdx.right)],
    inseam: [c, innerAnkle ? [innerAnkle[0], 0.5, innerAnkle[2]] : [c[0] + 3, 0.5, c[2]]],
    foot: [[outer - 0.4, 0.6, heel], [outer - 0.4, 0.6, toe]],
    height: max - min > 0 ? m.height : 0,
  };
}
