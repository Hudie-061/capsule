// «Моя палитра» (design/V2-Palette.dc.html): colour type from one selfie.
// The selfie is sent once to the `palette` task; the Worker keeps nothing. A small copy stays on the
// device (IndexedDB) to show the face next to the colours, like a colour analyst's drape: one of the
// best colours against one to avoid. «Удалить фото» removes it; the palette stays.
// Before the analysis the selfie can be calibrated with a white sheet of paper held next to the face
// (src/lib/white-balance.js): the phone finds the sheet, the person can tap it instead, and the colour
// cast of the camera is removed before the photo leaves the phone.
import { useEffect, useRef, useState } from "react";
import { formatShortDate, getPalette, savePalette } from "./lib/daily.js";
import { blobs } from "./lib/db.js";
import { paletteTask } from "./lib/gemini.js";
import { canvasToBlob, loadBitmap, makeCanvas } from "./lib/image.js";
import { applyGains, findWhiteSheet, sampleAt, whiteGains } from "./lib/white-balance.js";
import { getProfile, saveProfile } from "./lib/settings.js";
import { getBody } from "./lib/sizes.js";
import { getPaletteMode, paletteFor, paletteProfileText, setPaletteMode } from "./lib/palette-mode.js";
import { FaceSticker } from "./face-sticker.jsx";
import { HintChips, Icon, Segmented, WaitLine } from "./ui.jsx";

// Story image 1080×1920 drawn on a canvas, so no screenshot library is needed.
async function storyImage(p) {
  const canvas = document.createElement("canvas");
  canvas.width = 1080; canvas.height = 1920;
  const ctx = canvas.getContext("2d");
  const serif = "Prata, Georgia, 'Noto Serif', serif";
  const sans = "'Golos Text Variable', 'Golos Text', system-ui, sans-serif";
  // a canvas does not wait for web fonts: load them first, or the picture gets the fallback font
  await Promise.all([`400 110px ${serif}`, `400 40px ${sans}`, `600 40px ${sans}`].map((f) => document.fonts?.load(f, "Палитра Palette"))).catch(() => {});
  // a long season name in a wide Didone must still fit the card (830 px from x = 140)
  const fit = (text, weight, size, family, width) => { let s = size; ctx.font = `${weight} ${s}px ${family}`; while (s > 40 && ctx.measureText(text).width > width) { s -= 4; ctx.font = `${weight} ${s}px ${family}`; } };
  ctx.fillStyle = "#F4EFE7"; ctx.fillRect(0, 0, 1080, 1920);
  ctx.fillStyle = "#1E1B18"; ctx.beginPath(); ctx.roundRect(70, 160, 940, 1600, 72); ctx.fill();
  ctx.fillStyle = "#CFC6BA"; ctx.font = `500 40px ${sans}`; ctx.fillText("Моя палитра", 140, 280);
  ctx.fillStyle = "#F4EFE7"; fit(p.season || "Палитра", 400, 110, serif, 830); ctx.fillText(p.season || "Палитра", 140, 410);
  ctx.fillStyle = "#CFC6BA"; ctx.font = `400 40px ${sans}`; ctx.fillText([p.undertone, p.contrast].filter(Boolean).join(" · "), 140, 480);
  ctx.font = `600 38px ${sans}`; ctx.fillText("Лучшие цвета", 140, 600);
  const cell = 190; const gap = 20;
  p.best.slice(0, 8).forEach((c, i) => {
    const x = 140 + (i % 4) * (cell + gap); const y = 640 + Math.floor(i / 4) * 250;
    ctx.fillStyle = c.hex; ctx.beginPath(); ctx.roundRect(x, y, cell, 150, 36); ctx.fill();
    ctx.fillStyle = "#E6DED2"; ctx.font = `400 30px ${sans}`; ctx.textAlign = "center"; ctx.fillText(c.name, x + cell / 2, y + 196); ctx.textAlign = "left";
  });
  ctx.fillStyle = "#CFC6BA"; ctx.font = `600 38px ${sans}`; ctx.fillText("Лучше избегать у лица", 140, 1210);
  p.avoid.slice(0, 4).forEach((c, i) => {
    const x = 140 + i * (cell + gap); const y = 1250;
    ctx.save(); ctx.fillStyle = c.hex; ctx.beginPath(); ctx.roundRect(x, y, cell, 100, 30); ctx.fill(); ctx.clip();
    ctx.strokeStyle = "#1E1B18"; ctx.lineWidth = 8; ctx.beginPath(); ctx.moveTo(x, y + 100); ctx.lineTo(x + cell, y); ctx.stroke(); ctx.restore();
    ctx.fillStyle = "#CFC6BA"; ctx.font = `400 28px ${sans}`; ctx.textAlign = "center"; ctx.fillText(c.name, x + cell / 2, y + 146); ctx.textAlign = "left";
  });
  if (p.metal?.name) { ctx.fillStyle = "#CFC6BA"; ctx.font = `600 38px ${sans}`; ctx.fillText(`Металл: ${p.metal.name}`, 140, 1520); }
  ctx.fillStyle = "#F4EFE7"; ctx.font = `400 56px ${serif}`; ctx.fillText("Капсула", 140, 1680);
  return new Promise((resolve) => canvas.toBlob(resolve, "image/png"));
}

const SELFIE = "palette-selfie";

// The colour around the face changes like fabric being raised: the new colour spreads in a circle from
// below over the old one (a mask reveal) instead of one ring simply switching to another. The clothes on
// the sticker face take the same colour through --drape.
function DrapeFace({ color, children }) {
  const [rings, setRings] = useState([{ color, id: 0 }]);
  const nextId = useRef(1);
  useEffect(() => {
    setRings((list) => (list[list.length - 1].color === color ? list : [...list.slice(-1), { color, id: nextId.current++ }]));
  }, [color]);
  return (
    <span className="drape__frame" style={{ "--drape": color }}>
      {rings.map((r, i) => (
        <span key={r.id} className={`drape__ring${i > 0 ? " is-new" : ""}`} style={{ background: r.color }}
          onAnimationEnd={() => setRings((list) => list.slice(-1))} aria-hidden="true" />
      ))}
      <span className="drape__face">{children}</span>
    </span>
  );
}

// A 512 px JPEG is plenty for a circle on screen.
async function smallSelfie(file) {
  const bitmap = await loadBitmap(file);
  const scale = Math.min(1, 512 / Math.max(bitmap.width, bitmap.height));
  const canvas = makeCanvas(Math.round(bitmap.width * scale), Math.round(bitmap.height * scale));
  canvas.getContext("2d").drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close?.();
  return canvasToBlob(canvas, "image/jpeg", 0.85);
}

// The whole palette step for one face photo: the `palette` task, then the result, the small selfie for the
// drape and the profile line for the stylist are saved. Used by «Моя палитра» (a selfie) and by «Мерки
// по фото» (the face cut from the full-length photo, `fromBody`). Returns { saved, selfie }.
export async function paletteFromPhoto(photo, { calibrated = false, fromBody = false } = {}) {
  const result = await paletteTask(photo, { calibrated });
  const saved = await savePalette(fromBody ? { ...result, fromBody: true } : result);
  let selfie = null;
  try {
    selfie = await smallSelfie(photo);
    await blobs.set(SELFIE, selfie);
  } catch { /* the palette works without the photo */ }
  // The stylist reads «Цвета, которые идут» from the profile, so outfits and shopping use the palette too
  // (the colours of the chosen mode: simple or extended).
  const profile = await getProfile();
  await saveProfile({ ...profile, palette: paletteProfileText(paletteFor(result, await getPaletteMode())) });
  return { saved, selfie };
}

// «Простая» or «Расширенная» (src/lib/palette-mode.js): chosen before the first selfie, switched in one tap.
const MODES = [
  { id: "simple", title: "Простая", text: "Белый, бежевый, серый, тёмно-синий, чёрный — базовые цвета, которые легко сочетать", preview: ["#F7F7F5", "#D8C3A5", "#8A8A8A", "#1F2A44", "#111111", "#2E7D4F"] },
  { id: "extended", title: "Расширенная", text: "Терракота, шалфей, пыльная роза, петроль — все оттенки твоего цветотипа", preview: ["#B5735A", "#9AA382", "#C2949A", "#1F5A66", "#C99A2E", "#9C8AA5"] },
];
const MODE_NOTE = {
  simple: "Понятные базовые цвета в оттенке, который тебе идёт.",
  extended: "Все оттенки твоего цветотипа — для тех, кто любит цвет.",
};

function ModePick({ mode, onChange }) {
  return (
    <div className="mode-pick" role="radiogroup" aria-label="Какую палитру показать">
      {MODES.map((m) => (
        <button type="button" role="radio" key={m.id} aria-checked={mode === m.id} className={`mode-pick__card${mode === m.id ? " is-on" : ""}`} onClick={() => onChange(m.id)}>
          <span className="mode-pick__fan" aria-hidden="true">{m.preview.map((hex) => <span key={hex} style={{ background: hex }} />)}</span>
          <span className="mode-pick__title">{mode === m.id && <Icon name="check" size={14} width={2.6} />}{m.title}</span>
          <span className="mode-pick__text">{m.text}</span>
        </button>
      ))}
    </div>
  );
}

// 60 / 30 / 10: one base colour for most of the outfit, a second one, one accent — drawn with the person's
// own colours (the tapped one when it fits the role), with an example of which pieces take which colour.
function MixBar({ colors, picked }) {
  const base = colors.filter((c) => c.role === "base");
  const accents = colors.filter((c) => c.role === "accent");
  if (base.length < 2 || !accents.length) return null;
  const main = picked?.role === "base" ? picked : base[0];
  const second = base.find((c) => c !== main);
  const accent = picked?.role === "accent" ? picked : accents[0];
  const low = (c) => c.name.toLowerCase();
  return (
    <div className="mix">
      <span className="palette-card__label">Как сочетать</span>
      <div className="mix__bar" aria-hidden="true">
        <span style={{ flexGrow: 6, background: main.hex }}><b>60 %</b></span>
        <span style={{ flexGrow: 3, background: second.hex }}><b>30 %</b></span>
        <span style={{ flexGrow: 1, background: accent.hex }} />
      </div>
      <span className="palette-card__muted">Например: брюки и куртка — {low(main)}, свитер — {low(second)}, футболка или шарф у лица — {low(accent)}.</span>
    </div>
  );
}

export function PaletteView({ onBack, onFindClothes, setupReady, onOpenAccess }) {
  const [saved, setSaved] = useState(null);
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [story, setStory] = useState(null);
  const [selfie, setSelfie] = useState(null);
  const [gender, setGender] = useState(""); // for the sticker face shown until there is a selfie
  const [drape, setDrape] = useState({ best: 0, avoid: 0 });
  const [calib, setCalib] = useState(null); // { url, full, small, sheet, miss } while the photo is being calibrated
  const [mode, setMode] = useState(""); // "simple" | "extended"
  const fileRef = useRef(null);

  useEffect(() => {
    getPalette().then((value) => { setSaved(value); setLoaded(true); });
    blobs.get(SELFIE).then((blob) => { if (blob) setSelfie(URL.createObjectURL(blob)); }).catch(() => {});
    Promise.all([getBody(), getProfile()]).then(([body, profile]) => setGender(body?.gender || profile?.gender || "")).catch(() => {});
    getPaletteMode().then(setMode).catch(() => setMode("extended"));
  }, []);

  // one tap: the colours here, the stylist's profile line and «Чего не хватает» all follow the mode
  const switchMode = (next) => {
    if (next === mode) return;
    setMode(next);
    setDrape({ best: 0, avoid: 0 });
    setPaletteMode(next).catch(() => {});
  };
  useEffect(() => () => { if (story) URL.revokeObjectURL(story); }, [story]);
  useEffect(() => () => { if (selfie) URL.revokeObjectURL(selfie); }, [selfie]);

  // Step 1: the photo is drawn at 1024 px for the analysis and at 160 px to look for the white sheet.
  const prepare = async (file) => {
    setError("");
    try {
      const bitmap = await loadBitmap(file);
      const fit = (side) => Math.min(1, side / Math.max(bitmap.width, bitmap.height));
      const full = makeCanvas(Math.round(bitmap.width * fit(1024)), Math.round(bitmap.height * fit(1024)));
      full.getContext("2d").drawImage(bitmap, 0, 0, full.width, full.height);
      const tiny = makeCanvas(Math.max(1, Math.round(bitmap.width * fit(160))), Math.max(1, Math.round(bitmap.height * fit(160))));
      const tctx = tiny.getContext("2d", { willReadFrequently: true });
      tctx.drawImage(bitmap, 0, 0, tiny.width, tiny.height);
      bitmap.close?.();
      const small = { data: tctx.getImageData(0, 0, tiny.width, tiny.height).data, width: tiny.width, height: tiny.height };
      const found = findWhiteSheet(small.data, small.width, small.height);
      if (calib?.url) URL.revokeObjectURL(calib.url);
      setCalib({ url: URL.createObjectURL(file), full, small, sheet: found && whiteGains(found.avg) ? found : null, miss: false });
    } catch (e) {
      setError(e.message || "Не удалось открыть фото.");
    }
  };

  // A tap on the photo marks the sheet by hand.
  const tapSheet = (event) => {
    if (!calib) return;
    const rect = event.currentTarget.getBoundingClientRect();
    const x = (event.clientX - rect.left) / rect.width;
    const y = (event.clientY - rect.top) / rect.height;
    const spot = sampleAt(calib.small.data, calib.small.width, calib.small.height, x, y);
    setCalib({ ...calib, sheet: whiteGains(spot.avg) ? spot : calib.sheet, miss: !whiteGains(spot.avg) });
  };

  // Step 2: remove the camera's colour cast (if a sheet is marked) and analyse.
  const analyse = async (useSheet) => {
    if (!calib) return;
    setBusy(true); setError("");
    try {
      const gains = useSheet && calib.sheet ? whiteGains(calib.sheet.avg) : null;
      // A copy, so a retry after an error does not correct the colours twice.
      const out = makeCanvas(calib.full.width, calib.full.height);
      const ctx = out.getContext("2d");
      ctx.drawImage(calib.full, 0, 0);
      if (gains) {
        const pixels = ctx.getImageData(0, 0, out.width, out.height);
        applyGains(pixels.data, gains);
        ctx.putImageData(pixels, 0, 0);
      }
      const file = await canvasToBlob(out, "image/jpeg", 0.92);
      const done = await paletteFromPhoto(file, { calibrated: Boolean(gains) });
      URL.revokeObjectURL(calib.url);
      setCalib(null);
      setSaved(done.saved);
      setDrape({ best: 0, avoid: 0 });
      if (done.selfie) setSelfie(URL.createObjectURL(done.selfie));
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  const removeSelfie = async () => {
    await blobs.del(SELFIE);
    setSelfie(null);
  };

  const share = async () => {
    const blob = await storyImage(p); // the colours of the chosen mode
    const file = new File([blob], "capsule-palette.png", { type: "image/png" });
    if (navigator.canShare?.({ files: [file] })) {
      try { await navigator.share({ files: [file], title: "Моя палитра" }); return; } catch (e) { if (e?.name === "AbortError") return; }
    }
    setStory(URL.createObjectURL(blob)); // fallback: show the picture to save or screenshot
  };

  const p = saved?.result ? paletteFor(saved.result, mode) : null;
  const face = (key) => (selfie ? <img src={selfie} alt="" key={key} /> : <FaceSticker gender={gender} undertone={p?.undertone} metal={p?.metal?.good?.[0]} />);
  const swatch = (c, i) => (
    <button type="button" key={c.hex + i} className={`swatch pop${drape.best === i ? " is-on" : ""}`} style={{ animationDelay: `${(i % 4) * 0.03}s` }} aria-pressed={drape.best === i} onClick={() => setDrape({ ...drape, best: i })}>
      <span className="swatch__color" style={{ background: c.hex }} />
      <span className="swatch__name">{c.name}</span>
    </button>
  );
  const picker = <input ref={fileRef} type="file" accept="image/*" capture="user" hidden onChange={(e) => { const file = e.target.files?.[0]; e.target.value = ""; if (file) prepare(file); }} />;

  return (
    <section className="screen palette-screen">
      <div className="subscreen-top">
        <button type="button" className="round-button round-button--lg" aria-label="Назад" onClick={onBack}><Icon name="back" size={22} width={2} /></button>
        {p && <span className="tiny-text">по фото от {formatShortDate(new Date(saved.at))}</span>}
      </div>
      <h1 className="screen-title screen-title--sub">Моя палитра</h1>
      {picker}

      {calib && !busy ? (
        <div className="palette-card calib rise">
          <span className="palette-card__season">Калибровка цвета</span>
          <span className="palette-card__muted">
            {calib.sheet
              ? "Нашёл белый лист — выровняю по нему цвета камеры, как колорист по эталону. Если рамка не на листе, нажми на лист."
              : "Не нашёл белый лист. Нажми на него на фото — или продолжи без калибровки, тогда цвета будут менее точными."}
          </span>
          <button type="button" className="calib__photo" onClick={tapSheet} aria-label="Нажми на белый лист на фото">
            <img src={calib.url} alt="Твоё селфи" />
            {calib.sheet && (
              <span className="calib__box" style={{ left: `${calib.sheet.box.x0 * 100}%`, top: `${calib.sheet.box.y0 * 100}%`, width: `${(calib.sheet.box.x1 - calib.sheet.box.x0) * 100}%`, height: `${(calib.sheet.box.y1 - calib.sheet.box.y0) * 100}%` }} />
            )}
          </button>
          {calib.miss && <span className="palette-note">Это не похоже на белый лист — нажми точно на бумагу.</span>}
          <div className="calib__actions">
            {calib.sheet && <button type="button" className="btn btn--light" onClick={() => analyse(true)}><Icon name="check" size={18} width={2.2} /> Определить цвета</button>}
            <button type="button" className={calib.sheet ? "text-button text-button--dark" : "btn btn--light"} onClick={() => analyse(false)}>Без калибровки</button>
            <button type="button" className="text-button text-button--dark" onClick={() => fileRef.current?.click()}>Другое фото</button>
          </div>
          {error && <span className="error-text error-text--dark">{error}</span>}
        </div>
      ) : !loaded || !mode ? null : !p || busy ? (
        <div className="palette-card palette-card--intro rise">
          <span className="palette-card__avatar"><Icon name="camera" size={28} color="#CFC6BA" /></span>
          <span className="palette-card__season">{busy ? "Смотрю на цвета…" : "Узнай свой цветотип"}</span>
          <span className="palette-card__muted">{busy ? "Это займёт несколько секунд." : "Одно селфи — и я подберу цвета одежды, которые тебе идут, и металлы для украшений. Фото останется только на телефоне, чтобы показать цвета рядом с лицом."}</span>
          {!busy && mode && (
            <>
              <span className="palette-card__label">Какую палитру показать? <span className="palette-card__muted">потом можно переключить</span></span>
              <ModePick mode={mode} onChange={switchMode} />
            </>
          )}
          {!busy && (
            <ul className="calib-tips">
              <li><b>Днём у окна</b>, лицом к свету, без фильтров</li>
              <li><b>Белый лист бумаги</b> у лица — по нему я выровняю цвета камеры: лампа и экран делают всех «теплее» или «холоднее». Можно и без листа</li>
              <li>Волосы и брови видны, без тонального крема — если можно</li>
            </ul>
          )}
          {busy ? <><span className="shimmer shimmer--dark palette-skeleton" /><WaitLine tone="dark" phrases={["Смотрю на свет и цвет кожи…", "Сравниваю с 12 сезонами…", "Объясняю, почему тебе идут цвета…"]} /></> : setupReady ? (
            <button type="button" className="btn btn--light" onClick={() => fileRef.current?.click()}>Сделать селфи</button>
          ) : <button type="button" className="btn btn--light" onClick={onOpenAccess}>Сначала введи код доступа</button>}
          {error && <span className="error-text error-text--dark">{error}</span>}
          <span className="palette-card__foot"><span className="palette-card__brand">Капсула</span><span>Фото при дневном свете, без фильтров</span></span>
        </div>
      ) : (
        <div className="palette-card rise">
          <div className="palette-card__head">
            <span className="palette-card__avatar" style={{ borderColor: p.metal?.good?.[0] || "#C9A24A" }}>{selfie ? <img src={selfie} alt="Твоё селфи" /> : <span className="palette-card__sticker" style={{ "--drape": p.best[0]?.hex }}><FaceSticker gender={gender} undertone={p.undertone} metal={p.metal?.good?.[0]} /></span>}</span>
            <div className="palette-card__heading">
              <span className="palette-card__season">{p.season}</span>
              <span className="palette-card__muted">{[p.undertone, p.contrast, p.calibrated ? "по белому листу" : ""].filter(Boolean).join(" · ")}</span>
            </div>
          </div>
          <div className="palette-mode">
            <Segmented tone="dark" label="Какая палитра" value={p.mode} onChange={switchMode} options={[{ id: "simple", label: "Простая" }, { id: "extended", label: "Расширенная" }]} />
            <span className="palette-card__muted fade" key={p.mode}>{MODE_NOTE[p.mode]}</span>
          </div>

          <div className="palette-section">
            {/* the selfie when there is one, otherwise a sticker face of the person's gender */}
            <div className="drape-row" aria-label={selfie ? "Цвета рядом с лицом" : "Цвета рядом с лицом, пример"}>
              <figure className="drape">
                <DrapeFace color={p.best[drape.best]?.hex}>{face("best")}</DrapeFace>
                <figcaption><span className="strong-text">{p.best[drape.best]?.name}</span><span className="palette-card__muted">идёт</span></figcaption>
              </figure>
              {p.avoid.length > 0 && (
                <figure className="drape">
                  <DrapeFace color={p.avoid[drape.avoid]?.hex}>{face("avoid")}</DrapeFace>
                  <figcaption><span className="strong-text">{p.avoid[drape.avoid]?.name}</span><span className="palette-card__muted">хуже у лица</span></figcaption>
                </figure>
              )}
            </div>
            {!selfie && (
              <button type="button" className="drape-hint" onClick={() => fileRef.current?.click()}><Icon name="camera" size={16} width={2} /> Это пример. Добавь селфи — покажу цвета рядом с твоим лицом</button>
            )}

            <div className="palette-group" key={`base-${p.mode}`}>
              <span className="palette-card__label">База гардероба <span className="palette-card__muted">брюки, куртки, свитера — большая часть вещей</span></span>
              <div className="swatch-grid">{p.best.map((c, i) => (c.role === "base" ? swatch(c, i) : null))}</div>
            </div>
            <div className="palette-group" key={`accent-${p.mode}`}>
              <span className="palette-card__label">Акценты <span className="palette-card__muted">1–2 на образ, лучше у лица</span></span>
              <div className="swatch-grid">{p.best.map((c, i) => (c.role === "accent" ? swatch(c, i) : null))}</div>
            </div>
            {p.best[drape.best]?.why && <p className="swatch-why fade" key={`best-${p.mode}-${drape.best}`}><b>{p.best[drape.best].name}</b> — {p.best[drape.best].why}</p>}

            <MixBar colors={p.best} picked={p.best[drape.best]} />

            {p.avoid.length > 0 && (
              <div className="palette-group">
                <span className="palette-card__label">У лица — осторожнее <span className="palette-card__muted">в брюках и обуви можно</span></span>
                <div className="swatch-grid">
                  {p.avoid.map((c, i) => (
                    <button type="button" key={c.hex + i} className={`swatch${drape.avoid === i ? " is-on" : ""}`} aria-pressed={drape.avoid === i} onClick={() => setDrape({ ...drape, avoid: i })}>
                      <span className="swatch__color swatch__color--avoid" style={{ background: c.hex }}>
                        <svg aria-hidden="true" width="100%" height="100%" viewBox="0 0 70 34" preserveAspectRatio="none"><path d="M0 34 L70 0" stroke="#1E1B18" strokeWidth="3" /></svg>
                      </span>
                      <span className="swatch__name swatch__name--muted">{c.name}</span>
                    </button>
                  ))}
                </div>
                {p.avoid[drape.avoid]?.why && <p className="swatch-why fade" key={`avoid-${p.mode}-${drape.avoid}`}><b>{p.avoid[drape.avoid].name}</b> — {p.avoid[drape.avoid].why}</p>}
              </div>
            )}
          </div>

          <div className="palette-group palette-group--line">
            <span className="palette-card__label">Почему такой цветотип</span>
            {p.why ? <p className="palette-why">{p.why}</p> : <p className="palette-note">Сделай новое селфи — теперь объясняю, почему тебе идёт каждый цвет.</p>}
            <HintChips tips={p.traits} tone="dark" label="Из чего складывается цветотип" />
            {p.photoNote && <p className="palette-note">{p.photoNote}</p>}
            {p.fromBody && <p className="palette-note">Палитра определена по лицу с фото в полный рост — там оно небольшое. Для точности сделай крупное селфи при дневном свете.</p>}
          </div>

          <div className="palette-group palette-group--line">
            <span className="palette-card__label">Металлы и украшения</span>
            {p.metal?.name && (
              <div className="metal-row">
                <div className="metal-row__text"><span className="palette-card__muted">Твой металл</span><span className="strong-text">{p.metal.name}</span></div>
                <div className="metal-row__dots">
                  {p.metal.good.map((hex) => <span key={hex} className="metal-dot" style={{ background: hex }} />)}
                  {p.metal.avoid && (
                    <span className="metal-dot metal-dot--avoid" style={{ background: p.metal.avoid }} title="Лучше избегать">
                      <svg width="30" height="30" viewBox="0 0 30 30" aria-hidden="true"><path d="M4 26 L26 4" stroke="#1E1B18" strokeWidth="3" /></svg>
                    </span>
                  )}
                </div>
              </div>
            )}
            {p.jewelry.map((j) => (
              <div key={j.name} className="jewel">
                <span className="jewel__icon"><Icon name="star" size={20} width={2} color="#C9A24A" /></span>
                <span className="jewel__text"><span className="strong-text">{j.name}</span><span className="palette-card__muted">{j.note}</span></span>
              </div>
            ))}
          </div>
          <span className="palette-card__foot">
            <span className="palette-card__brand">Капсула</span>
            <span className="row-gap">
              {selfie && <button type="button" className="text-button text-button--dark" onClick={removeSelfie}>Удалить фото</button>}
              <button type="button" className="text-button text-button--dark" onClick={() => fileRef.current?.click()}>Новое селфи</button>
            </span>
          </span>
        </div>
      )}

      {p && !busy && (
        <div className="action-row action-row--bottom">
          <button type="button" className="btn btn--outline btn--grow1" onClick={share}><Icon name="share" size={20} width={2} /> В сторис</button>
          <button type="button" className="btn btn--dark btn--grow2 btn--lift" onClick={onFindClothes}>Найти вещи в моих цветах</button>
        </div>
      )}
      {p && !busy && <p className="tiny-text center-text">{p.mode === "simple" ? "Стилист подбирает образы и покупки в этих простых цветах." : "Палитра добавлена в «Мой стиль» — стилист учитывает её в образах и покупках."}</p>}

      {story && (
        <div className="story-preview" role="dialog" aria-modal="true" aria-label="Картинка для сторис">
          <img src={story} alt="Моя палитра — картинка для сторис" />
          <span>Нажми и удерживай картинку, чтобы сохранить, или сделай скриншот.</span>
          <div className="row-gap">
            <a className="btn btn--light btn--small" href={story} download="capsule-palette.png">Скачать</a>
            <button type="button" className="btn btn--outline btn--small story-preview__close" onClick={() => setStory(null)}>Закрыть</button>
          </div>
        </div>
      )}
    </section>
  );
}
