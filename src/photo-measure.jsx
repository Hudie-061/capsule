// «Мерки по фото»: body measurements from one or two full-body photos, computed on the phone.
// MediaPipe Pose Landmarker (@mediapipe/tasks-vision, Google, Apache-2.0; model
// pose_landmarker_full.task, Apache-2.0, see src/assets/MEDIAPIPE-LICENSE.md) finds the person's
// outline and joints; src/lib/photo-measure.js turns the outline into centimetres with the help
// of the 3D body. The photos never leave the phone and are not stored: they live in memory only
// while this screen is open. The library (~15 MB) and the model (~9 MB) load only here.
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import bodyUrl from "./assets/mh-body.bin?url";
import poseModelUrl from "./assets/pose_landmarker_full.task?url";
import wasmLoaderUrl from "@mediapipe/tasks-vision/vision_wasm_internal.js?url";
import wasmBinaryUrl from "@mediapipe/tasks-vision/vision_wasm_internal.wasm?url";
import { parseModel } from "./lib/body-model.js";
import { loadBitmap, makeCanvas } from "./lib/image.js";
import { checkPhoto, measureFromPhotos, silhouette } from "./lib/photo-measure.js";
import { MEASURES, estimate } from "./lib/sizes.js";
import { Icon } from "./ui.jsx";

const absolute = (url) => new URL(url, document.baseURI).href;

let landmarkerPromise = null;
function loadLandmarker() {
  landmarkerPromise ??= import("@mediapipe/tasks-vision")
    .then(({ PoseLandmarker }) => PoseLandmarker.createFromOptions(
      { wasmLoaderPath: absolute(wasmLoaderUrl), wasmBinaryPath: absolute(wasmBinaryUrl) },
      { baseOptions: { modelAssetPath: absolute(poseModelUrl), delegate: "CPU" }, runningMode: "IMAGE", numPoses: 2, outputSegmentationMasks: true },
    ))
    .catch((error) => { landmarkerPromise = null; throw error; });
  return landmarkerPromise;
}

let bodyPromise = null;
const loadBody = () => (bodyPromise ??= fetch(bodyUrl).then((r) => { if (!r.ok) throw new Error(); return r.arrayBuffer(); }).then(parseModel).catch((e) => { bodyPromise = null; throw e; }));

// One photo → the person's outline. The photo is scaled to 1280 px so phones keep up.
async function readPhoto(file, landmarker) {
  const bitmap = await loadBitmap(file);
  const scale = Math.min(1, 1280 / Math.max(bitmap.width, bitmap.height));
  const canvas = makeCanvas(Math.round(bitmap.width * scale), Math.round(bitmap.height * scale));
  canvas.getContext("2d").drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close?.();
  const result = landmarker.detect(canvas);
  const mask = result.segmentationMasks?.[0];
  const data = mask ? mask.getAsFloat32Array().slice() : null;
  const size = mask ? { width: mask.width, height: mask.height } : { width: canvas.width, height: canvas.height };
  for (const m of result.segmentationMasks || []) m.close();
  return { size, people: result.landmarks.length, outline: data ? silhouette({ data, ...size }, result.landmarks[0] || []) : null };
}

// Stick figures: how to stand for each photo, with the levels that get measured.
export function PoseGuide() {
  const level = (y, x1, x2) => <line className="pose-guide__level" x1={x1} x2={x2} y1={y} y2={y} />;
  return (
    <div className="pose-guide" aria-label="Как встать: спереди — прямо, руки чуть в стороны, ноги на ширине бёдер; сбоку — прямо, руки вдоль тела">
      <figure>
        <svg viewBox="0 0 120 200" aria-hidden="true">
          <line className="pose-guide__floor" x1="6" x2="114" y1="190" y2="190" />
          {level(62, 44, 76)}{level(80, 47, 73)}{level(100, 44, 76)}
          <circle cx="60" cy="20" r="11" />
          <path d="M60 31 V104 M44 44 H76 M50 104 H70 M44 44 L18 92 M76 44 L102 92 M52 104 L45 188 M68 104 L75 188 M45 188 H37 M75 188 H83" />
        </svg>
        <figcaption><b>Спереди</b><span>руки чуть в стороны, ноги на ширине бёдер</span></figcaption>
      </figure>
      <figure>
        <svg viewBox="0 0 120 200" aria-hidden="true">
          <line className="pose-guide__floor" x1="6" x2="114" y1="190" y2="190" />
          {level(62, 49, 73)}{level(80, 51, 70)}{level(100, 48, 72)}
          <circle cx="60" cy="20" r="11" />
          <path d="M71 19 L74 22 M60 31 V104 M60 44 L63 100 M60 104 L59 188 M59 188 H73" />
        </svg>
        <figcaption><b>Сбоку</b><span>по желанию, точнее: руки вдоль тела</span></figcaption>
      </figure>
    </div>
  );
}

const LABEL = Object.fromEntries(MEASURES.map((m) => [m.id, m]));
const ORDER = ["chest", "waist", "hips", "shoulders", "inseam"];

function Overlay({ url, size, lines, alt }) {
  return (
    <figure className="measured-photo">
      <img src={url} alt={alt} />
      <svg viewBox={`0 0 ${size.width} ${size.height}`} preserveAspectRatio="none" aria-hidden="true">
        {lines.map((l) => (l.id === "inseam"
          ? <line key={l.id} x1={l.x} x2={l.x} y1={l.y1} y2={l.y2} />
          : <line key={l.id} x1={l.x1} x2={l.x2} y1={l.y} y2={l.y} />))}
      </svg>
    </figure>
  );
}

// gender/height/weight come from the profile; `current` are the values shown now (to compare).
export function PhotoMeasure({ gender = "", height: startHeight = 175, weight = 70, current = {}, onClose, onSave }) {
  const [height, setHeight] = useState(startHeight);
  const [photos, setPhotos] = useState({ front: null, side: null });
  const [state, setState] = useState({ step: "how", text: "", error: "" });
  const [result, setResult] = useState(null);
  const pick = { front: useRef(null), side: useRef(null) };
  const urls = useRef(new Set());

  // the photos live only as in-memory URLs while this screen is open
  useEffect(() => () => { for (const url of urls.current) URL.revokeObjectURL(url); }, []);

  const choose = (view) => (event) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    const url = URL.createObjectURL(file);
    urls.current.add(url);
    setPhotos((p) => {
      if (p[view]) { URL.revokeObjectURL(p[view].url); urls.current.delete(p[view].url); }
      return { ...p, [view]: { file, url } };
    });
    setState({ step: "how", text: "", error: "" });
  };

  const measure = async () => {
    try {
      setState({ step: "busy", text: "Загружаю распознавание фигуры — один раз, около 24 МБ…", error: "" });
      const [landmarker, model] = await Promise.all([loadLandmarker(), loadBody()]);
      setState({ step: "busy", text: "Измеряю…", error: "" });
      await new Promise((r) => setTimeout(r, 30)); // let the text paint before the heavy work
      const read = {};
      for (const view of ["front", "side"]) {
        if (!photos[view]) continue;
        const r = await readPhoto(photos[view].file, landmarker);
        const check = checkPhoto(r.outline, view, r.people);
        if (check.error) throw new Error(`${view === "front" ? "Фото спереди" : "Фото сбоку"}: ${check.error}`);
        read[view] = { ...r, warnings: check.warnings };
      }
      const out = measureFromPhotos({ model, front: read.front.outline, side: read.side?.outline, gender, height, weight, estimates: estimate({ gender, height, weight }) });
      if (!Object.keys(out.values).length) throw new Error(out.warnings[0] || "Не получилось измерить — попробуй другое фото.");
      const warnings = [...new Set([...(read.front.warnings || []), ...(read.side?.warnings || []), ...out.warnings])];
      if (!out.withSide) warnings.push("Без фото сбоку глубина тела взята из 3D-модели — с ним обхваты точнее.");
      setResult({ ...out, warnings, sizes: { front: read.front.size, side: read.side?.size } });
      setState({ step: "result", text: "", error: "" });
    } catch (error) {
      const text = error?.message && !/wasm|fetch|abort|module/i.test(error.message) ? error.message : "Не получилось запустить распознавание. Проверь интернет при первом запуске и попробуй ещё раз.";
      setState({ step: "how", text: "", error: text });
    }
  };

  const retake = () => { setResult(null); setState({ step: "how", text: "", error: "" }); };

  // a portal: the screens around it are animated (transform), which would trap a fixed layer
  return createPortal(
    <div className="photo-measure" role="dialog" aria-modal="true" aria-label="Мерки по фото">
      <div className="photo-measure__inner">
        <div className="subscreen-top">
          <button type="button" className="round-button round-button--lg" aria-label="Закрыть" onClick={onClose}><Icon name="close" size={22} width={2} /></button>
          <span className="tiny-text">Фото не уходит с телефона</span>
        </div>
        <h1 className="screen-title screen-title--sub">Мерки по фото</h1>

        {state.step !== "result" && (
          <>
            <p className="muted-text lead-text">Два фото в полный рост — и я посчитаю обхваты груди, талии, бёдер, ширину плеч и внутренний шов.</p>
            <PoseGuide />
            <ul className="photo-tips">
              <li><b>Облегающая одежда</b> — лосины или спортивные штаны в обтяжку, футболка или топ по фигуре. Бельё не нужно.</li>
              <li><b>Без обуви</b>, волосы собери, чтобы были видны шея и плечи.</li>
              <li><b>Телефон вертикально на уровне пояса</b>, в 2–3 м. Попроси кого-нибудь снять или поставь таймер.</li>
              <li><b>Всё тело в кадре</b> — от макушки до стоп, лучше на однотонном фоне.</li>
            </ul>

            <label className="field-v2 slider-field">
              <span>Твой рост <b>{height} см</b></span>
              <input type="range" min="140" max="210" step="1" value={height} onChange={(e) => setHeight(Number(e.target.value))} />
            </label>
            <p className="tiny-text">По росту фото переводится в сантиметры — проверь, что он точный.</p>

            <div className="photo-slots">
              {[["front", "Спереди", "обязательно"], ["side", "Сбоку", "по желанию"]].map(([view, title, note]) => (
                <button type="button" key={view} className={`photo-slot${photos[view] ? " has-photo" : ""}`} onClick={() => pick[view].current?.click()} disabled={state.step === "busy"}>
                  {photos[view] ? <img src={photos[view].url} alt={`Фото ${title.toLowerCase()}`} /> : <Icon name="camera" size={26} />}
                  <span className="photo-slot__label"><b>{title}</b><small>{photos[view] ? "заменить" : note}</small></span>
                </button>
              ))}
              <input ref={pick.front} type="file" accept="image/*" hidden onChange={choose("front")} />
              <input ref={pick.side} type="file" accept="image/*" hidden onChange={choose("side")} />
            </div>

            {state.error && <p className="status-line status-line--error">{state.error}</p>}
            {state.step === "busy" && <p className="status-line"><span className="spinner" aria-hidden="true" /> {state.text}</p>}
            <button type="button" className="btn btn--dark btn--block btn--tall" disabled={!photos.front || state.step === "busy"} onClick={measure}>
              <Icon name="ruler" size={18} width={2} /> {state.step === "busy" ? "Измеряю…" : "Измерить"}
            </button>
            <p className="tiny-text">Фото обрабатывается прямо на телефоне, никуда не отправляется и не сохраняется.</p>
          </>
        )}

        {state.step === "result" && result && (
          <>
            <div className={`measured-photos${result.sizes.side ? " is-two" : ""}`}>
              <Overlay url={photos.front.url} size={result.sizes.front} lines={result.lines.front} alt="Фото спереди с линиями мерок" />
              {result.sizes.side && <Overlay url={photos.side.url} size={result.sizes.side} lines={result.lines.side} alt="Фото сбоку с линиями мерок" />}
            </div>
            <p className="tiny-text">Линии показывают, где я мерил. Если линия ушла не туда — переснимите фото.</p>
            <div className="panel photo-results">
              {ORDER.filter((id) => result.values[id] !== undefined).map((id) => (
                <div key={id} className="photo-result">
                  <span>{gender === "female" && LABEL[id].female ? LABEL[id].female : LABEL[id].label}</span>
                  <b>{result.values[id]} см</b>
                  {current[id] !== undefined && <small>сейчас {current[id]}</small>}
                </div>
              ))}
            </div>
            {result.warnings.map((w) => <p key={w} className="status-line">{w}</p>)}
            <p className="tiny-text">По фото точность примерно ±2–5 см. Шею и стопу по фото не мерю — их лучше лентой. Всё можно поправить ползунками.</p>
            <div className="action-row">
              <button type="button" className="btn btn--outline btn--grow1" onClick={retake}>Переснять</button>
              <button type="button" className="btn btn--dark btn--grow2" onClick={() => onSave({ height, values: result.values })}><Icon name="check" size={18} width={2.2} /> Сохранить мерки</button>
            </div>
          </>
        )}
      </div>
    </div>,
    document.body,
  );
}
