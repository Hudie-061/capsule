// Realistic 3D body (P3·16): the open MakeHuman body (CC0) fitted on the device to height, weight
// and measurements — see src/lib/body-model.js. No per-user 3D model and no server call. three.js
// and the model file (~0.8 MB) load only when this view opens. Drag to rotate; the measurement
// being edited is drawn on the body where a tape would go.
import { useEffect, useRef, useState } from "react";
import modelUrl from "./assets/mh-body.bin?url";
import { fitBody, parseModel } from "./lib/body-model.js";
import { estimate } from "./lib/sizes.js";

const SKIN = 0xd9cbbb;
const SUIT = 0x8a7d70; // a plain fitting bodysuit, like the base layer on a fitting avatar
const ACCENT = 0xa8360a;
const INK = 0x1e1b18;

// Skin, with a plain base layer like on fitting avatars: a bodysuit from the top of the thighs to just
// above the chest, or trunks up to the waist on a male figure. The torso's own width at each height
// (from the measured slices) keeps the arms out of it.
function suitColors(THREE, fit, n, H, male) {
  const skin = new THREE.Color(SKIN);
  const suit = new THREE.Color(SUIT);
  const { chest, waist, hips } = fit.rings;
  const half = (r) => Math.max(...r.points.map((q) => Math.abs(q[0]))) + 1.5;
  const stops = [[hips.y, half(hips)], [waist.y, half(waist)], [chest.y, half(chest)]];
  const limit = (y) => {
    if (y <= stops[0][0]) return stops[0][1];
    for (let i = 1; i < stops.length; i += 1) {
      if (y <= stops[i][0]) { const [y0, a] = stops[i - 1]; const [y1, b] = stops[i]; return a + ((b - a) * (y - y0)) / (y1 - y0); }
    }
    return stops.at(-1)[1];
  };
  const low = fit.crotch[1] - 0.015 * H;
  const high = male ? waist.y + 0.01 * H : chest.y + 0.035 * H;
  const colors = new Float32Array(n * 3);
  const p = fit.positions;
  for (let i = 0; i < n; i += 1) {
    const y = p[i * 3 + 1];
    const c = y >= low && y <= high && Math.abs(p[i * 3]) <= limit(y) ? suit : skin;
    colors[i * 3] = c.r; colors[i * 3 + 1] = c.g; colors[i * 3 + 2] = c.b;
  }
  return colors;
}

export function buildBody(THREE, model, m) {
  const fit = fitBody(model, { ...m, shouldersEstimate: estimate(m).shoulders });
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(fit.positions, 3));
  const index = new Uint16Array(model.body.length + model.eyes.length);
  index.set(model.body); index.set(model.eyes, model.body.length);
  geometry.setIndex(new THREE.BufferAttribute(index, 1));
  geometry.computeVertexNormals();
  geometry.setAttribute("color", new THREE.BufferAttribute(suitColors(THREE, fit, model.n, m.height, m.gender === "male"), 3));
  const body = new THREE.Group();
  body.add(new THREE.Mesh(geometry, new THREE.MeshStandardMaterial({ color: 0xffffff, vertexColors: true, roughness: 0.78, metalness: 0 })));

  // tape lines, a little off the skin
  const v = (p) => new THREE.Vector3(p[0], p[1], p[2]);
  const ring = ({ y, points }) => {
    const cx = points.reduce((a, q) => a + q[0], 0) / points.length;
    const cz = points.reduce((a, q) => a + q[1], 0) / points.length;
    return new THREE.CatmullRomCurve3(points.map(([x, z]) => new THREE.Vector3(cx + (x - cx) * 1.025, y, cz + (z - cz) * 1.025)), true, "centripetal");
  };
  const [ls, rs] = fit.shoulders;
  const neck = fit.rings.neck;
  const back = Math.min(...neck.points.map((q) => q[1])) - 1;
  const tube = (curve, closed = false) => new THREE.TubeGeometry(curve, 96, 0.4, 8, closed);
  const marks = {
    chest: tube(ring(fit.rings.chest), true),
    waist: tube(ring(fit.rings.waist), true),
    hips: tube(ring(fit.rings.hips), true),
    neck: tube(ring(neck), true),
    shoulders: tube(new THREE.CatmullRomCurve3([v([ls[0], ls[1] + 0.6, ls[2] - 1]), new THREE.Vector3(0, neck.y - 2, back), v([rs[0], rs[1] + 0.6, rs[2] - 1])])),
    inseam: tube(new THREE.LineCurve3(v([fit.inseam[0][0] + 1, fit.inseam[0][1] - 0.5, fit.inseam[0][2] + 1]), v([fit.inseam[1][0] - 0.6, fit.inseam[1][1], fit.inseam[1][2] + 1]))),
    foot: tube(new THREE.LineCurve3(v(fit.foot[0]), v(fit.foot[1]))),
  };
  const markMeshes = {};
  for (const [id, g] of Object.entries(marks)) {
    const mesh = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ color: INK, transparent: true, opacity: 0.22 }));
    markMeshes[id] = mesh;
    body.add(mesh);
  }
  return { body, marks: markMeshes, height: m.height };
}

function dispose(object) {
  object.traverse((o) => { o.geometry?.dispose?.(); if (o.material) (Array.isArray(o.material) ? o.material : [o.material]).forEach((m) => m.dispose?.()); });
}

function rebuild(state, props) {
  if (!props.values) return;
  if (state.model) { state.pivot.remove(state.model.body); dispose(state.model.body); }
  state.model = buildBody(state.THREE, state.mesh, { gender: props.gender, height: Number(props.height) || 175, weight: Number(props.weight) || 70, ...props.values });
  state.pivot.add(state.model.body);
  const H = state.model.height;
  state.camera.position.set(0, H * 0.54, H * 2.75);
  state.camera.lookAt(0, H * 0.5, 0);
  state.shadow.scale.setScalar(H * 0.17);
  highlight(state, props.focus);
}

// The measurement being edited glows in the accent colour; chest, waist and hips stay faintly visible.
// The body turns to where that tape is easiest to see: the back for shoulders, the side for the foot.
const VIEW = { shoulders: Math.PI, foot: Math.PI / 2 }; // the foot tape runs along the outer side of the right foot
function highlight(state, focus, turn = false) {
  if (!state?.model) return;
  if (turn) { state.auto = false; state.turnTo = VIEW[focus] ?? 0; }
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
      let THREE; let mesh;
      try {
        [THREE, mesh] = await Promise.all([import("three"), fetch(modelUrl).then((r) => { if (!r.ok) throw new Error(); return r.arrayBuffer(); }).then(parseModel)]);
      } catch { setError("Не удалось загрузить 3D-модель. Проверь интернет и открой экран ещё раз."); return; }
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
      const state = { THREE, mesh, renderer, scene, camera, pivot, shadow, model: null, auto: true, drag: null, pending: 0 };
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
      canvas.addEventListener("pointerdown", (e) => { state.auto = false; state.turnTo = null; state.drag = { x: e.clientX, r: pivot.rotation.y }; canvas.setPointerCapture?.(e.pointerId); });
      canvas.addEventListener("pointermove", (e) => { if (state.drag) pivot.rotation.y = state.drag.r + (e.clientX - state.drag.x) * 0.012; });
      const stop = () => { state.drag = null; };
      canvas.addEventListener("pointerup", stop);
      canvas.addEventListener("pointercancel", stop);

      rebuild(state, propsRef.current);
      const loop = () => {
        frame = requestAnimationFrame(loop);
        if (document.hidden) return;
        if (state.auto) pivot.rotation.y += 0.004;
        else if (state.turnTo != null && !state.drag) {
          const diff = Math.atan2(Math.sin(state.turnTo - pivot.rotation.y), Math.cos(state.turnTo - pivot.rotation.y));
          pivot.rotation.y += diff * 0.12;
          if (Math.abs(diff) < 0.005) state.turnTo = null;
        }
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

  useEffect(() => {
    const state = stateRef.current;
    if (!state || state.pending) return;
    state.pending = requestAnimationFrame(() => { state.pending = 0; if (stateRef.current === state) rebuild(state, propsRef.current); });
  }, [shapeKey]);
  useEffect(() => { highlight(stateRef.current, focus, true); }, [focus]);

  return (
    <div className="body3d" ref={hostRef} aria-label="3D-фигура по твоим меркам. Потяни, чтобы повернуть." role="img">
      {error && <p className="body3d__error">{error}</p>}
    </div>
  );
}
