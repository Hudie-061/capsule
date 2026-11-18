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
import { HintChips, Icon, Segmented } from "./ui.jsx";

// Story image 1080×1920 drawn on a canvas, so no screenshot library is needed.
async function storyImage(p) {
  const canvas = document.createElement("canvas");
  canvas.width = 1080; canvas.height = 1920;
  const ctx = canvas.getContext("2d");
  const serif = "Georgia, 'Noto Serif', 'Times New Roman', serif";
  const sans = "'Inter Variable', Inter, system-ui, sans-serif";
  ctx.fillStyle = "#F4EFE7"; ctx.fillRect(0, 0, 1080, 1920);
  ctx.fillStyle = "#1E1B18"; ctx.beginPath(); ctx.roundRect(70, 160, 940, 1600, 72); ctx.fill();
  ctx.fillStyle = "#CFC6BA"; ctx.font = `500 40px ${sans}`; ctx.fillText("Моя палитра", 140, 280);
  ctx.fillStyle = "#F4EFE7"; ctx.font = `400 110px ${serif}`; ctx.fillText(p.season || "Палитра", 140, 410);
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

// A 512 px JPEG is plenty for a circle on screen.
async function smallSelfie(file) {
  const bitmap = await loadBitmap(file);
  const scale = Math.min(1, 512 / Math.max(bitmap.width, bitmap.height));
  const canvas = makeCanvas(Math.round(bitmap.width * scale), Math.round(bitmap.height * scale));
  canvas.getContext("2d").drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close?.();
  return canvasToBlob(canvas, "image/jpeg", 0.85);
}

// The stylist reads this from the profile: season, undertone and contrast (for the outfit's contrast), colours.
function paletteText(p) {
  const traits = [p.undertone, p.contrast].filter(Boolean).join(", ");
  return `${p.season}${traits ? ` (${traits})` : ""}: ${p.best.map((c) => c.name.toLowerCase()).join(", ")}${p.avoid.length ? `; у лица избегать: ${p.avoid.map((c) => c.name.toLowerCase()).join(", ")}` : ""}`;
}

export function PaletteView({ onBack, onFindClothes, setupReady, onOpenAccess }) {
  const [saved, setSaved] = useState(null);
  const [loaded, setLoaded] = useState(false);
  const [tab, setTab] = useState("colors");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [story, setStory] = useState(null);
  const [selfie, setSelfie] = useState(null);
  const [drape, setDrape] = useState({ best: 0, avoid: 0 });
  const [calib, setCalib] = useState(null); // { url, full, small, sheet, miss } while the photo is being calibrated
  const fileRef = useRef(null);

  useEffect(() => {
    getPalette().then((value) => { setSaved(value); setLoaded(true); });
    blobs.get(SELFIE).then((blob) => { if (blob) setSelfie(URL.createObjectURL(blob)); }).catch(() => {});
  }, []);
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
      const result = await paletteTask(file, { calibrated: Boolean(gains) });
      URL.revokeObjectURL(calib.url);
      setCalib(null);
      setSaved(await savePalette(result));
      setDrape({ best: 0, avoid: 0 });
      try {
        const small = await smallSelfie(file);
        await blobs.set(SELFIE, small);
        setSelfie(URL.createObjectURL(small));
      } catch { /* the palette works without the photo */ }
      // The stylist reads «Цвета, которые идут» from the profile, so outfits and shopping use the palette too.
      const profile = await getProfile();
      await saveProfile({ ...profile, palette: paletteText(result) });
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
    const blob = await storyImage(saved.result);
    const file = new File([blob], "capsule-palette.png", { type: "image/png" });
    if (navigator.canShare?.({ files: [file] })) {
      try { await navigator.share({ files: [file], title: "Моя палитра" }); return; } catch (e) { if (e?.name === "AbortError") return; }
    }
    setStory(URL.createObjectURL(blob)); // fallback: show the picture to save or screenshot
  };

  const p = saved?.result;
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
      ) : !loaded ? null : !p || busy ? (
        <div className="palette-card palette-card--intro rise">
          <span className="palette-card__avatar"><Icon name="camera" size={28} color="#CFC6BA" /></span>
          <span className="palette-card__season">{busy ? "Смотрю на цвета…" : "Узнай свой цветотип"}</span>
          <span className="palette-card__muted">{busy ? "Это займёт несколько секунд." : "Одно селфи — и я подберу цвета одежды, которые тебе идут, и металлы для украшений. Фото останется только на телефоне, чтобы показать цвета рядом с лицом."}</span>
          {!busy && (
            <ul className="calib-tips">
              <li><b>Днём у окна</b>, лицом к свету, без фильтров</li>
              <li><b>Белый лист бумаги</b> у лица — по нему я выровняю цвета камеры: лампа и экран делают всех «теплее» или «холоднее». Можно и без листа</li>
              <li>Волосы и брови видны, без тонального крема — если можно</li>
            </ul>
          )}
          {busy ? <span className="shimmer shimmer--dark palette-skeleton" /> : setupReady ? (
            <button type="button" className="btn btn--light" onClick={() => fileRef.current?.click()}>Сделать селфи</button>
          ) : <button type="button" className="btn btn--light" onClick={onOpenAccess}>Сначала введи код доступа</button>}
          {error && <span className="error-text error-text--dark">{error}</span>}
          <span className="palette-card__foot"><span className="palette-card__brand">Капсула</span><span>Фото при дневном свете, без фильтров</span></span>
        </div>
      ) : (
        <div className="palette-card rise">
          <div className="palette-card__head">
            <span className="palette-card__avatar" style={{ borderColor: p.metal?.good?.[0] || "#C9A24A" }}>{selfie ? <img src={selfie} alt="Твоё селфи" /> : <Icon name="profile" size={28} color="#CFC6BA" />}</span>
            <div className="palette-card__heading">
              <span className="palette-card__season">{p.season}</span>
              <span className="palette-card__muted">{[p.undertone, p.contrast, p.calibrated ? "по белому листу" : ""].filter(Boolean).join(" · ")}</span>
            </div>
          </div>
          {p.why ? <p className="palette-why">{p.why}</p> : <p className="palette-note">Сделай новое селфи — теперь объясняю, почему тебе идёт каждый цвет.</p>}
          <HintChips tips={p.traits} tone="dark" label="Из чего складывается цветотип" />
          {p.photoNote && <p className="palette-note">{p.photoNote}</p>}
          <Segmented role="tablist" tone="dark" label="Раздел палитры" value={tab} onChange={setTab} options={[{ id: "colors", label: "Цвета" }, { id: "jewel", label: "Металлы и украшения" }]} />
          {tab === "colors" ? (
            <div className="palette-section">
              {selfie ? (
                <div className="drape-row" aria-label="Цвета рядом с лицом">
                  <figure className="drape">
                    <span className="drape__face" style={{ "--drape": p.best[drape.best]?.hex }}><img src={selfie} alt="" /></span>
                    <figcaption><span className="strong-text">{p.best[drape.best]?.name}</span><span className="palette-card__muted">идёт</span></figcaption>
                  </figure>
                  {p.avoid.length > 0 && (
                    <figure className="drape">
                      <span className="drape__face" style={{ "--drape": p.avoid[drape.avoid]?.hex }}><img src={selfie} alt="" /></span>
                      <figcaption><span className="strong-text">{p.avoid[drape.avoid]?.name}</span><span className="palette-card__muted">хуже у лица</span></figcaption>
                    </figure>
                  )}
                </div>
              ) : (
                <button type="button" className="drape-hint" onClick={() => fileRef.current?.click()}><Icon name="camera" size={16} width={2} /> Новое селфи — покажу цвета рядом с лицом</button>
              )}
              <span className="palette-card__label">Твои лучшие цвета · {selfie ? "нажми — примерю и объясню" : "нажми, чтобы узнать почему"}</span>
              <div className="swatch-grid">
                {p.best.map((c, i) => (
                  <button type="button" key={c.hex + i} className={`swatch pop${drape.best === i ? " is-on" : ""}`} style={{ animationDelay: `${i * 0.04}s` }} aria-pressed={drape.best === i} onClick={() => setDrape({ ...drape, best: i })}>
                    <span className="swatch__color" style={{ background: c.hex }} />
                    <span className="swatch__name">{c.name}</span>
                  </button>
                ))}
              </div>
              {p.best[drape.best]?.why && <p className="swatch-why fade" key={`best-${drape.best}`}><b>{p.best[drape.best].name}</b> — {p.best[drape.best].why}</p>}
              {p.avoid.length > 0 && (
                <>
                  <span className="palette-card__label">Лучше избегать у лица</span>
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
                  {p.avoid[drape.avoid]?.why && <p className="swatch-why fade" key={`avoid-${drape.avoid}`}><b>{p.avoid[drape.avoid].name}</b> — {p.avoid[drape.avoid].why}</p>}
                </>
              )}
            </div>
          ) : (
            <div className="palette-section rise">
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
              <span className="palette-card__label">Подойдут тебе</span>
              {p.jewelry.map((j, i) => (
                <div key={j.name} className="jewel rise" style={{ animationDelay: `${i * 0.06}s` }}>
                  <span className="jewel__icon"><Icon name="star" size={20} width={2} color="#C9A24A" /></span>
                  <span className="jewel__text"><span className="strong-text">{j.name}</span><span className="palette-card__muted">{j.note}</span></span>
                </div>
              ))}
            </div>
          )}
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
      {p && !busy && <p className="tiny-text center-text">Палитра добавлена в «Мой стиль» — стилист учитывает её в образах и покупках.</p>}

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
