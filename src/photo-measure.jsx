// «Мерки по фото»: body measurements from full-length photos, computed on the phone.
// Two ways in: «Снять с подсказками» (src/body-capture.jsx — the phone stands by itself, a voice says
// how to stand and the photos are taken after a countdown, a short burst for each view) or two ready
// photos. MediaPipe Pose (src/lib/pose-models.js) finds the person's outline and joints;
// src/lib/photo-measure.js turns the outline into centimetres with the help of the 3D body. With a burst,
// every pair of frames is measured and the median is kept, which evens out the outline's noise.
// After saving, the same front photo can give the colour palette (the face is cut out and analysed like
// a selfie) and become the try-on photo. The measuring photos never leave the phone and are not stored.
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import bodyUrl from "./assets/mh-body.bin?url";
import { BodyCapture } from "./body-capture.jsx";
import { clearTryOns } from "./lib/daily.js";
import { SetupError } from "./lib/gemini.js";
import { parseModel } from "./lib/body-model.js";
import { canvasToBlob, loadBitmap, makeCanvas, normalizeImage } from "./lib/image.js";
import { faceBox } from "./lib/pose-check.js";
import { loadPhotoLandmarker } from "./lib/pose-models.js";
import { checkPhoto, measureFromPhotos, silhouette } from "./lib/photo-measure.js";
import { getModelReference, setModelReference } from "./lib/settings.js";
import { MEASURES, estimate } from "./lib/sizes.js";
import { paletteFromPhoto } from "./palette.jsx";
import { PoseGuide } from "./pose-guide.jsx";
import { Icon } from "./ui.jsx";

export { PoseGuide };

let bodyPromise = null;
const loadBody = () => (bodyPromise ??= fetch(bodyUrl).then((r) => { if (!r.ok) throw new Error(); return r.arrayBuffer(); }).then(parseModel).catch((e) => { bodyPromise = null; throw e; }));

const isCanvas = (x) => typeof x?.getContext === "function";

// One photo (a file or a camera frame) → the person's outline and joints. Scaled to 1280 px so phones keep up.
async function readPhoto(source, landmarker) {
  const bitmap = isCanvas(source) ? source : await loadBitmap(source);
  const scale = Math.min(1, 1280 / Math.max(bitmap.width, bitmap.height));
  const canvas = makeCanvas(Math.round(bitmap.width * scale), Math.round(bitmap.height * scale));
  canvas.getContext("2d").drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  if (!isCanvas(source)) bitmap.close?.();
  const result = landmarker.detect(canvas);
  const mask = result.segmentationMasks?.[0];
  const data = mask ? mask.getAsFloat32Array().slice() : null;
  const size = mask ? { width: mask.width, height: mask.height } : { width: canvas.width, height: canvas.height };
  for (const m of result.segmentationMasks || []) m.close();
  const landmarks = result.landmarks[0] || [];
  return { size, people: result.landmarks.length, landmarks, outline: data ? silhouette({ data, ...size }, landmarks) : null };
}

// The head and shoulders for the palette, from the front photo; small faces are scaled up.
async function cutFace(source, landmarks) {
  const bitmap = isCanvas(source) ? source : await loadBitmap(source);
  const box = faceBox(landmarks, bitmap.width, bitmap.height);
  if (!box) { if (!isCanvas(source)) bitmap.close?.(); return null; }
  const scale = Math.max(1, 640 / box.w);
  const out = makeCanvas(Math.round(box.w * scale), Math.round(box.h * scale));
  const ctx = out.getContext("2d");
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(bitmap, box.x, box.y, box.w, box.h, 0, 0, out.width, out.height);
  if (!isCanvas(source)) bitmap.close?.();
  return canvasToBlob(out, "image/jpeg", 0.92);
}

const median = (list) => { const s = [...list].sort((a, b) => a - b); const m = Math.floor(s.length / 2); return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };

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
// onSave({ height, values }) stores the measurements; the screen stays open for the palette question
// and closes with onClose.
export function PhotoMeasure({ gender = "", height: startHeight = 175, weight = 70, current = {}, onClose, onSave }) {
  const [height, setHeight] = useState(startHeight);
  const [photos, setPhotos] = useState({ front: null, side: null });
  const [state, setState] = useState({ step: "how", text: "", error: "" });
  const [result, setResult] = useState(null);
  const [face, setFace] = useState({ blob: null, url: null, checked: false }); // the head cut for the palette
  const [tryOn, setTryOn] = useState({ use: false, had: false });
  const [palette, setPalette] = useState({ status: "idle", season: "", error: "" });
  const pick = { front: useRef(null), side: useRef(null) };
  const urls = useRef(new Set());
  const source = useRef(null); // { front: [file|canvas], side: [...], full: file|canvas }

  const keepUrl = (url) => { urls.current.add(url); return url; };
  // the photos live only as in-memory URLs while this screen is open
  useEffect(() => () => { for (const url of urls.current) URL.revokeObjectURL(url); }, []);
  useEffect(() => { getModelReference().then((blob) => setTryOn({ use: !blob, had: Boolean(blob) })).catch(() => {}); }, []);

  const choose = (view) => (event) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    const url = keepUrl(URL.createObjectURL(file));
    setPhotos((p) => ({ ...p, [view]: { file, url } }));
    setState({ step: "how", text: "", error: "" });
  };

  // `sets`: { front: [...], side: [...] } — one photo each, or a burst from the camera.
  const measure = async (sets) => {
    try {
      setState({ step: "busy", text: "Загружаю распознавание фигуры — один раз, около 24 МБ…", error: "" });
      const [landmarker, model] = await Promise.all([loadPhotoLandmarker(), loadBody()]);
      setState({ step: "busy", text: "Измеряю…", error: "" });
      await new Promise((r) => setTimeout(r, 30)); // let the text paint before the heavy work
      const read = { front: [], side: [] };
      let firstError = "";
      for (const view of ["front", "side"]) {
        for (const item of sets[view] || []) {
          const r = await readPhoto(item, landmarker);
          const check = checkPhoto(r.outline, view, r.people);
          if (check.error) { firstError ||= `${view === "front" ? "Фото спереди" : "Фото сбоку"}: ${check.error}`; continue; }
          read[view].push({ ...r, item, warnings: check.warnings });
        }
      }
      if (!read.front.length) throw new Error(firstError || "Не получилось измерить — попробуй другое фото.");
      const estimates = estimate({ gender, height, weight });
      const runs = read.front.map((f, i) => {
        const s = read.side.length ? read.side[Math.min(i, read.side.length - 1)] : null;
        return { f, s, out: measureFromPhotos({ model, front: f.outline, side: s?.outline, gender, height, weight, estimates }) };
      });
      const values = {};
      for (const id of ORDER) {
        const list = runs.map((r) => r.out.values[id]).filter((v) => v !== undefined);
        if (list.length * 2 >= runs.length) values[id] = Math.round(median(list) * (id === "shoulders" || id === "inseam" ? 2 : 1)) / (id === "shoulders" || id === "inseam" ? 2 : 1);
      }
      if (!Object.keys(values).length) throw new Error(runs[0].out.warnings[0] || "Не получилось измерить — попробуй другое фото.");
      const shown = runs[Math.floor(runs.length / 2)];
      const toUrl = async (item) => keepUrl(URL.createObjectURL(isCanvas(item) ? await canvasToBlob(item, "image/jpeg", 0.85) : item));
      const view = { front: await toUrl(shown.f.item), side: shown.s ? await toUrl(shown.s.item) : null };
      const warnings = [...new Set([...(shown.f.warnings || []), ...(shown.s?.warnings || []), ...shown.out.warnings])];
      if (sets.side?.length && !read.side.length) warnings.push("Фото сбоку не получилось измерить — переснимите его, стоя ровно боком, руки вдоль тела.");
      else if (!shown.out.withSide) warnings.push("Без фото сбоку глубина тела взята из 3D-модели — с ним обхваты точнее.");
      if (runs.length > 1) warnings.push(`Измерил ${runs.length} кадра и взял середину — так точнее.`);
      setResult({ values, lines: shown.out.lines, warnings, withSide: Boolean(shown.s), sizes: { front: shown.f.size, side: shown.s?.size }, urls: view });
      // the face for the palette question, from the sharpest copy of the front photo
      const full = sets.full || shown.f.item;
      setFace({ blob: null, url: null, checked: false });
      cutFace(full, shown.f.landmarks).then((blob) => setFace({ blob, url: blob ? keepUrl(URL.createObjectURL(blob)) : null, checked: true })).catch(() => setFace({ blob: null, url: null, checked: true }));
      source.current = { full };
      setState({ step: "result", text: "", error: "" });
    } catch (error) {
      const text = error?.message && !/wasm|fetch|abort|module/i.test(error.message) ? error.message : "Не получилось запустить распознавание. Проверь интернет при первом запуске и попробуй ещё раз.";
      setState({ step: "how", text: "", error: text });
    }
  };

  const fromCamera = (shots) => {
    setPhotos({ front: null, side: null });
    measure({ front: shots.front, side: shots.side, full: shots.frontFull });
  };

  const save = async () => {
    await onSave({ height, values: result.values });
    setState({ step: "after", text: "", error: "" });
  };

  // the front photo becomes the try-on photo when the person agrees
  const applyTryOn = async () => {
    if (!tryOn.use || !source.current?.full || source.current.tryOnSaved) return;
    source.current.tryOnSaved = true;
    const full = source.current.full;
    const blob = isCanvas(full) ? await canvasToBlob(full, "image/jpeg", 0.92) : full;
    await setModelReference(await normalizeImage(blob, 1536));
    await clearTryOns();
  };

  const findPalette = async () => {
    setPalette({ status: "busy", season: "", error: "" });
    try {
      await applyTryOn();
      const done = await paletteFromPhoto(face.blob, { calibrated: false, fromBody: true });
      setPalette({ status: "done", season: done.saved.result.season, best: done.saved.result.best || [], error: "" });
    } catch (e) {
      setPalette({ status: "idle", season: "", error: e instanceof SetupError ? "Для палитры нужен код доступа — его можно ввести в «Профиле», а палитру сделать потом в «Моя палитра»." : e.message || "Не получилось определить палитру." });
    }
  };

  const finish = async () => {
    try { await applyTryOn(); } catch { /* the measurements are saved anyway */ }
    onClose();
  };

  const retake = () => { setResult(null); setState({ step: "how", text: "", error: "" }); };

  // a portal: the screens around it are animated (transform), which would trap a fixed layer
  return createPortal(
    <div className="photo-measure" role="dialog" aria-modal="true" aria-label="Мерки по фото">
      <div className="photo-measure__inner">
        <div className="subscreen-top">
          <button type="button" className="round-button round-button--lg" aria-label="Закрыть" onClick={state.step === "after" ? finish : onClose}><Icon name="close" size={22} width={2} /></button>
          <span className="tiny-text">Фото для мерок не уходят с телефона</span>
        </div>
        <h1 className="screen-title screen-title--sub">Мерки по фото</h1>

        {(state.step === "how" || state.step === "busy") && (
          <>
            <p className="muted-text lead-text">Два фото в полный рост — и я посчитаю обхваты груди, талии, бёдер, ширину плеч и внутренний шов. Мерить себя лентой не нужно.</p>

            <label className="field-v2 slider-field">
              <span>Твой рост <b>{height} см</b></span>
              <input type="range" min="140" max="210" step="1" value={height} onChange={(e) => setHeight(Number(e.target.value))} />
            </label>
            <p className="tiny-text">По росту фото переводится в сантиметры — проверь, что он точный.</p>

            <button type="button" className="photo-cta photo-cta--main" onClick={() => setState({ step: "camera", text: "", error: "" })} disabled={state.step === "busy"}>
              <span className="row-card__icon"><Icon name="camera" size={22} /></span>
              <span><b>Снять с подсказками</b><small>Поставь телефон — он сам скажет, как встать, и сфотографирует после отсчёта. Помощник не нужен.</small></span>
              <Icon name="chevron" size={20} width={2} />
            </button>

            <details className="photo-upload">
              <summary>Или загрузить готовые фото</summary>
              <PoseGuide />
              <ul className="photo-tips">
                <li><b>Облегающая одежда</b> — лосины или спортивные штаны в обтяжку, футболка или топ по фигуре. Бельё не нужно.</li>
                <li><b>Без обуви</b>, волосы собери, чтобы были видны шея и плечи.</li>
                <li><b>Телефон вертикально на уровне пояса</b>, в 2–3 м.</li>
                <li><b>Всё тело в кадре</b> — от макушки до стоп, лучше на однотонном фоне.</li>
              </ul>
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
              <button type="button" className="btn btn--dark btn--block btn--tall" disabled={!photos.front || state.step === "busy"}
                onClick={() => measure({ front: [photos.front.file], side: photos.side ? [photos.side.file] : [], full: photos.front.file })}>
                <Icon name="ruler" size={18} width={2} /> Измерить
              </button>
            </details>

            {state.error && <p className="status-line status-line--error">{state.error}</p>}
            {state.step === "busy" && <p className="status-line"><span className="spinner" aria-hidden="true" /> {state.text}</p>}
            <p className="tiny-text">Фото обрабатываются прямо на телефоне, никуда не отправляются и не сохраняются.</p>
          </>
        )}

        {state.step === "camera" && <BodyCapture onCancel={() => setState({ step: "how", text: "", error: "" })} onDone={fromCamera} />}

        {state.step === "result" && result && (
          <>
            <div className={`measured-photos${result.urls.side ? " is-two" : ""}`}>
              <Overlay url={result.urls.front} size={result.sizes.front} lines={result.lines.front} alt="Фото спереди с линиями мерок" />
              {result.urls.side && <Overlay url={result.urls.side} size={result.sizes.side} lines={result.lines.side} alt="Фото сбоку с линиями мерок" />}
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
              <button type="button" className="btn btn--dark btn--grow2" onClick={save}><Icon name="check" size={18} width={2.2} /> Сохранить мерки</button>
            </div>
          </>
        )}

        {state.step === "after" && (
          <div className="after-measure rise">
            <p className="status-line status-line--ok">Мерки сохранены — размеры в «Покупках» теперь считаются по ним.</p>
            {palette.status === "done" ? (
              <div className="after-measure__card">
                <span className="section-label">Твоя палитра</span>
                <span className="after-measure__season">{palette.season}</span>
                <span className="after-measure__swatches">{palette.best.slice(0, 6).map((c) => <i key={c.hex} style={{ background: c.hex }} title={c.name} />)}</span>
                <p className="tiny-text">Подробно — в «Профиль» → «Моя палитра». Для точности можно потом сделать крупное селфи.</p>
              </div>
            ) : face.checked && face.blob ? (
              <div className="after-measure__card">
                <span className="after-measure__face"><img src={face.url} alt="Лицо с фото спереди" /></span>
                <h2 className="sheet__title">Узнать свою цветовую палитру?</h2>
                <p className="muted-text">Возьму лицо с этого фото и подберу цвета, которые тебе идут. Фото лица отправится на анализ, как обычное селфи.</p>
                {palette.error && <p className="status-line status-line--error">{palette.error}</p>}
                <div className="action-row">
                  <button type="button" className="btn btn--outline btn--grow1" onClick={finish} disabled={palette.status === "busy"}>Нет, потом селфи</button>
                  <button type="button" className="btn btn--dark btn--grow2" onClick={findPalette} disabled={palette.status === "busy"}>
                    {palette.status === "busy" ? <><span className="spinner" aria-hidden="true" /> Определяю…</> : <><Icon name="palette" size={18} width={2} /> Да, определить</>}
                  </button>
                </div>
              </div>
            ) : face.checked ? (
              <p className="status-line">Лицо на фото получилось слишком маленьким для палитры — её лучше сделать по селфи в «Моя палитра».</p>
            ) : <p className="status-line"><span className="spinner" aria-hidden="true" /> Готовлю фото лица…</p>}

            <label className="size-picker__switch">
              <input type="checkbox" checked={tryOn.use} onChange={(e) => setTryOn({ ...tryOn, use: e.target.checked })} />
              <span>Использовать фото спереди для примерки образов<small>{tryOn.had ? "заменит текущее фото для примерки" : "хранится только на телефоне, удалить можно в «Профиле»"}</small></span>
            </label>
            {(palette.status === "done" || !face.blob) && face.checked && (
              <button type="button" className="btn btn--dark btn--block btn--tall" onClick={finish}><Icon name="check" size={18} width={2.2} /> Готово</button>
            )}
          </div>
        )}
      </div>
    </div>,
    document.body,
  );
}
