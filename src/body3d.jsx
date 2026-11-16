// Parametric 3D body (owner's choice among the avatar options): built on the device from height,
// weight and measurements, no per-user 3D model and no server call. three.js is loaded only when
// this view opens, so the rest of the app stays light. Drag to rotate; the measurement being edited
// is highlighted on the body (chest, waist and hips rings, neck, shoulders, inside leg, foot).
import { useEffect, useRef, useState } from "react";

const SKIN = 0xd3c8ba;
const ACCENT = 0xa8360a;
const INK = 0x1e1b18;

// Ellipse semi-axes (width, depth) for a girth with the given width:depth ratio.
function axes(girth, ratio) {
  const depth = girth / (2 * Math.PI * Math.sqrt((ratio * ratio + 1) / 2));
  return [ratio * depth, depth];
}

const catmull = (p0, p1, p2, p3, t) => 0.5 * ((2 * p1) + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t * t + (-p0 + 3 * p1 - 3 * p2 + p3) * t * t * t);

// Torso: elliptical rings at anatomical levels, smoothed into one surface.
function torsoGeometry(THREE, keys) {
  const per = 8;
  const seg = 40;
  const rings = [];
  for (let i = 0; i < keys.length - 1; i += 1) {
    const p0 = keys[i - 1] || keys[i]; const p1 = keys[i]; const p2 = keys[i + 1]; const p3 = keys[i + 2] || keys[i + 1];
    for (let j = 0; j < per; j += 1) {
      const t = j / per;
      rings.push([0, 1, 2, 3].map((k) => catmull(p0[k], p1[k], p2[k], p3[k], t)));
    }
  }
  rings.push(keys[keys.length - 1]);
  const positions = [];
  for (const [y, a, b, z] of rings) {
    for (let s = 0; s < seg; s += 1) {
      const th = (s / seg) * Math.PI * 2;
      // a slightly flatter back than front
      const depth = Math.sin(th) > 0 ? b : b * 0.9;
      positions.push(a * Math.cos(th), y, z + depth * Math.sin(th));
    }
  }
  const bottom = positions.length / 3;
  positions.push(0, rings[0][0] - 1.5, rings[0][3]);
  const index = [];
  for (let r = 0; r < rings.length - 1; r += 1) {
    for (let s = 0; s < seg; s += 1) {
      const a = r * seg + s; const b = r * seg + ((s + 1) % seg);
      const c = (r + 1) * seg + s; const d = (r + 1) * seg + ((s + 1) % seg);
      index.push(a, c, b, b, c, d);
    }
  }
  for (let s = 0; s < seg; s += 1) index.push(bottom, s, (s + 1) % seg);
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.setIndex(index);
  geometry.computeVertexNormals();
  return geometry;
}

const lathe = (THREE, points) => new THREE.LatheGeometry(points.map(([r, y]) => new THREE.Vector2(Math.max(0.1, r), y)), 32);

class EllipseRing {
  constructor(THREE, y, a, b, z) { this.curve = new (class extends THREE.Curve { getPoint(t, out = new THREE.Vector3()) { const th = t * Math.PI * 2; return out.set(a * Math.cos(th), y, z + b * Math.sin(th)); } })(); }
}

export function buildBody(THREE, m) {
  const H = m.height;
  const f = m.gender === "female";
  const k = H / 175;
  const bmi = m.weight / ((H / 100) ** 2);
  const fat = Math.sqrt(Math.min(1.6, Math.max(0.7, bmi / 22)));
  const crotch = Math.min(0.52 * H, Math.max(0.4 * H, m.inseam));
  const y = { hips: crotch + 0.06 * H, waist: (f ? 0.625 : 0.615) * H, chest: 0.725 * H, armpit: 0.755 * H, shoulder: 0.815 * H, neck: 0.838 * H, chin: 0.872 * H, head: 0.93 * H, elbow: 0.63 * H, wrist: 0.485 * H };
  const [hA, hB] = axes(m.hips, f ? 1.32 : 1.28);
  const [wA, wB] = axes(m.waist, f ? 1.32 : 1.22);
  const [cA, cB] = axes(m.chest, f ? 1.3 : 1.38);
  const neckR = m.neck / (2 * Math.PI);
  const sh = m.shoulders / 2;
  const material = new THREE.MeshStandardMaterial({ color: SKIN, roughness: 0.86, metalness: 0 });
  const body = new THREE.Group();
  const add = (geometry, x = 0, yy = 0, z = 0) => { const mesh = new THREE.Mesh(geometry, material); mesh.position.set(x, yy, z); body.add(mesh); return mesh; };

  // torso: [height, half width, half depth, forward offset]
  add(torsoGeometry(THREE, [
    [crotch - 4, hA * 0.78, hB * 0.7, -0.5],
    [y.hips, hA, hB, -1.2],
    [(y.hips + y.waist) / 2, (hA + wA) / 2, (hB + wB) / 2, -0.6],
    [y.waist, wA, wB, 0],
    [y.chest, cA, cB, f ? 1.8 : 0.6],
    [y.armpit, Math.max(cA * 0.97, sh * 0.84), cB * 0.92, 0.3],
    [y.shoulder, sh * 0.8, cB * 0.68, 0],
    [y.neck, neckR * 1.5, neckR * 1.35, 0],
    [y.neck + 1.5, neckR * 1.02, neckR, 0],
  ]));

  // legs
  const thigh = (0.6 * m.hips) / (2 * Math.PI);
  const legX = hA * 0.5;
  for (const side of [-1, 1]) {
    add(lathe(THREE, [[3.4 * k, 0.03 * H], [3.6 * k, 0.055 * H], [6 * k * fat, 0.19 * H], [5.4 * k * Math.sqrt(fat), 0.285 * H], [thigh * 0.84, 0.37 * H], [thigh, crotch - 1], [thigh * 1.02, crotch + 6], [thigh * 0.7, crotch + 13]]), side * legX, 0, 0); // the top blends into the hips
    const foot = add(new THREE.SphereGeometry(1, 24, 14), side * legX, 3.6 * k, m.foot * 0.2);
    foot.scale.set(m.foot * 0.19, 4.2 * k, m.foot * 0.5);
  }

  // arms, slightly away from the body
  const upper = (f ? 4.1 : 4.7) * k * Math.pow(fat, 0.7);
  for (const side of [-1, 1]) {
    const arm = new THREE.Group();
    arm.position.set(side * (sh - 1.2), y.shoulder - 3, 0);
    arm.rotation.z = side * 0.09;
    const len1 = y.shoulder - 3 - y.elbow;
    const len2 = y.elbow - y.wrist;
    const meshes = [
      [lathe(THREE, [[upper * 0.82, -len1], [upper, -len1 * 0.5], [upper * 1.05, 0]]), 0],
      [lathe(THREE, [[upper * 0.58, -len1 - len2], [upper * 0.8, -len1 - len2 * 0.4], [upper * 0.84, -len1]]), 0],
    ];
    for (const [geometry] of meshes) arm.add(new THREE.Mesh(geometry, material));
    const cap = new THREE.Mesh(new THREE.SphereGeometry(upper * 1.15, 20, 14), material);
    arm.add(cap);
    const hand = new THREE.Mesh(new THREE.SphereGeometry(1, 16, 12), material);
    hand.scale.set(2.3 * k, 8.4 * k, 4.2 * k);
    hand.position.y = -len1 - len2 - 7 * k;
    arm.add(hand);
    body.add(arm);
  }

  // neck and head
  add(new THREE.CylinderGeometry(neckR * 0.95, neckR, y.chin - y.neck + 4, 24), 0, (y.neck + y.chin) / 2, 0);
  const head = add(new THREE.SphereGeometry(1, 32, 24), 0, y.head, 0.6);
  head.scale.set(7.8 * k * (f ? 0.96 : 1), 11.6 * k, 9.6 * k);

  // where each measurement is taken
  const tube = (curve, closed = false) => new THREE.TubeGeometry(curve, 72, 0.45, 8, closed);
  const marks = {
    chest: tube(new EllipseRing(THREE, y.chest, cA * 1.04, cB * 1.06, f ? 1.8 : 0.6).curve, true),
    waist: tube(new EllipseRing(THREE, y.waist, wA * 1.04, wB * 1.06, 0).curve, true),
    hips: tube(new EllipseRing(THREE, y.hips, hA * 1.04, hB * 1.06, -1.2).curve, true),
    neck: tube(new EllipseRing(THREE, y.neck + 1.5, neckR * 1.15, neckR * 1.12, 0).curve, true),
    shoulders: tube(new THREE.CatmullRomCurve3([new THREE.Vector3(-sh, y.shoulder - 2, -cB * 0.4), new THREE.Vector3(0, y.shoulder + 1, -cB * 0.75), new THREE.Vector3(sh, y.shoulder - 2, -cB * 0.4)])),
    inseam: tube(new THREE.LineCurve3(new THREE.Vector3(-legX + thigh * 0.85, crotch - 1, 1), new THREE.Vector3(-legX + 3.6 * k, 0.5, 1))),
    foot: tube(new THREE.LineCurve3(new THREE.Vector3(legX + m.foot * 0.22, 0.6, -m.foot * 0.3), new THREE.Vector3(legX + m.foot * 0.22, 0.6, m.foot * 0.7))),
  };
  const markMeshes = {};
  for (const [id, geometry] of Object.entries(marks)) {
    const mesh = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({ color: INK, transparent: true, opacity: 0.22 }));
    markMeshes[id] = mesh;
    body.add(mesh);
  }
  return { body, marks: markMeshes, height: H };
}

function dispose(object) {
  object.traverse((o) => { o.geometry?.dispose?.(); if (o.material) (Array.isArray(o.material) ? o.material : [o.material]).forEach((m) => m.dispose?.()); });
}

function rebuild(state, props) {
  if (!props.values) return;
  if (state.model) { state.pivot.remove(state.model.body); dispose(state.model.body); }
  state.model = buildBody(state.THREE, { gender: props.gender, height: Number(props.height) || 175, weight: Number(props.weight) || 70, ...props.values });
  state.pivot.add(state.model.body);
  const H = state.model.height;
  state.camera.position.set(0, H * 0.54, H * 2.75);
  state.camera.lookAt(0, H * 0.5, 0);
  state.shadow.scale.setScalar(H * 0.17);
  highlight(state, props.focus);
}

// The measurement being edited glows in the accent colour; chest, waist and hips stay faintly visible.
function highlight(state, focus) {
  if (!state?.model) return;
  for (const [id, mesh] of Object.entries(state.model.marks)) {
    const on = id === focus;
    mesh.material.color.setHex(on ? ACCENT : INK);
    mesh.material.opacity = on ? 1 : (["chest", "waist", "hips"].includes(id) ? 0.22 : 0);
  }
}

export function Body3D({ gender, height, weight, values, focus }) {
  const hostRef = useRef(null);
  const stateRef = useRef(null);
  const propsRef = useRef({});
  propsRef.current = { gender, height, weight, values, focus };
  const [error, setError] = useState("");
  const shapeKey = JSON.stringify([gender, height, weight, values]);

  // scene, camera, renderer, drag-to-rotate — once
  useEffect(() => {
    let alive = true;
    let frame = 0;
    let observer;
    (async () => {
      let THREE;
      try { THREE = await import("three"); } catch { setError("Не удалось загрузить 3D."); return; }
      if (!alive || !hostRef.current) return;
      let renderer;
      try { renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true }); } catch { setError("3D не поддерживается на этом устройстве."); return; }
      const host = hostRef.current;
      renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
      renderer.setClearColor(0x000000, 0);
      host.appendChild(renderer.domElement);
      const scene = new THREE.Scene();
      const camera = new THREE.PerspectiveCamera(26, 1, 1, 3000);
      scene.add(new THREE.HemisphereLight(0xffffff, 0xcfc3b2, 1.7));
      const key = new THREE.DirectionalLight(0xffffff, 1.9); key.position.set(80, 240, 180); scene.add(key);
      const rim = new THREE.DirectionalLight(0xffffff, 0.7); rim.position.set(-140, 140, -120); scene.add(rim);
      const pivot = new THREE.Group();
      pivot.rotation.y = -0.45;
      scene.add(pivot);
      const shadow = new THREE.Mesh(new THREE.CircleGeometry(1, 48), new THREE.MeshBasicMaterial({ color: INK, transparent: true, opacity: 0.08 }));
      shadow.rotation.x = -Math.PI / 2;
      shadow.position.y = 0.2;
      scene.add(shadow);
      const state = { THREE, renderer, scene, camera, pivot, shadow, model: null, auto: true, drag: null };
      stateRef.current = state;

      const resize = () => {
        const w = host.clientWidth || 300;
        const h = host.clientHeight || 360;
        renderer.setSize(w, h, false);
        renderer.domElement.style.width = "100%";
        renderer.domElement.style.height = "100%";
        camera.aspect = w / h;
        camera.updateProjectionMatrix();
      };
      observer = new ResizeObserver(resize);
      observer.observe(host);
      resize();

      const canvas = renderer.domElement;
      canvas.style.touchAction = "pan-y";
      canvas.addEventListener("pointerdown", (e) => { state.auto = false; state.drag = { x: e.clientX, r: pivot.rotation.y }; canvas.setPointerCapture?.(e.pointerId); });
      canvas.addEventListener("pointermove", (e) => { if (state.drag) pivot.rotation.y = state.drag.r + (e.clientX - state.drag.x) * 0.012; });
      const stop = () => { state.drag = null; };
      canvas.addEventListener("pointerup", stop);
      canvas.addEventListener("pointercancel", stop);

      rebuild(state, propsRef.current);
      const loop = () => {
        frame = requestAnimationFrame(loop);
        if (document.hidden) return;
        if (state.auto) pivot.rotation.y += 0.004;
        renderer.render(scene, camera);
      };
      loop();
    })();
    return () => {
      alive = false;
      cancelAnimationFrame(frame);
      observer?.disconnect();
      const state = stateRef.current;
      if (state) { if (state.model) dispose(state.model.body); state.renderer.dispose(); state.renderer.domElement.remove(); }
      stateRef.current = null;
    };
  }, []);

  useEffect(() => { if (stateRef.current) rebuild(stateRef.current, propsRef.current); }, [shapeKey]);
  useEffect(() => { highlight(stateRef.current, focus); }, [focus]);

  return (
    <div className="body3d" ref={hostRef} aria-label="3D-фигура по твоим меркам. Потяни, чтобы повернуть." role="img">
      {error && <p className="body3d__error">{error}</p>}
    </div>
  );
}
