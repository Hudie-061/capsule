// «Мерки и размеры» (P3·15 + P3·16): the parametric 3D body and clothing sizes.
// Unknown measurements are estimated from height and weight and marked «оценка»; anything the
// user sets with a slider counts as their own measurement and can be reset back to the estimate.
// «Мерки по фото» (photo-measure.jsx) fills chest, waist, hips, shoulders and inside leg from photos;
// those are marked «по фото» (body.sources) until the user moves their slider.
import { lazy, Suspense, useEffect, useMemo, useRef, useState } from "react";
import { getProfile, saveProfile } from "./lib/settings.js";
import { CHARTS, MEASURES, fullBody, getBody, saveBody, sizeChart, sizesFor, sizesSummary } from "./lib/sizes.js";
import { GENDERS, splitList } from "./lib/style-options.js";
import { Icon } from "./ui.jsx";

// three.js arrives only with this screen; the photo measuring (MediaPipe) only when it is opened.
const Body3D = lazy(() => import("./body3d.jsx").then((m) => ({ default: m.Body3D })));
const PhotoMeasure = lazy(() => import("./photo-measure.jsx").then((m) => ({ default: m.PhotoMeasure })));

const num = (text, fallback) => { const n = Number.parseFloat(String(text || "").replace(",", ".")); return Number.isFinite(n) ? n : fallback; };

export function SizesView({ onBack, onToast }) {
  const [ready, setReady] = useState(false);
  const [gender, setGender] = useState("");
  const [height, setHeight] = useState(175);
  const [weight, setWeight] = useState(70);
  const [measured, setMeasured] = useState({});
  const [sources, setSources] = useState({});
  const [photoOpen, setPhotoOpen] = useState(false);
  const [focus, setFocus] = useState("chest");
  const [oversize, setOversize] = useState(false);
  const [chart, setChart] = useState("top");
  const chartRef = useRef(null);

  useEffect(() => {
    Promise.all([getBody(), getProfile()]).then(([body, profile]) => {
      setGender(body?.gender ?? profile.gender ?? "");
      setHeight(Math.round(num(body?.height ?? profile.height, 175)));
      setWeight(Math.round(num(body?.weight ?? profile.weight, 70)));
      setMeasured(body?.measured || {});
      setSources(body?.sources || {});
      setOversize(splitList(profile.fits).includes("Оверсайз"));
      setReady(true);
    });
  }, []);

  const body = useMemo(() => ({ gender, height, weight, measured }), [gender, height, weight, measured]);
  const { values, estimated } = useMemo(() => fullBody(body), [body]);
  const sizes = useMemo(() => sizesFor(body, { oversize }), [body, oversize]);
  const focused = MEASURES.find((m) => m.id === focus);
  const charts = CHARTS.filter((c) => !c.male || gender !== "female");
  const table = useMemo(() => sizeChart(charts.some((c) => c.id === chart) ? chart : "top", body), [chart, body, charts]);
  const CHART_OF = { top: "top", jeans: "bottom", shirt: "shirt", shoes: "shoes" };
  const openChart = (id) => { setChart(CHART_OF[id] || "top"); chartRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }); };

  const persist = async (next) => {
    await saveBody(next);
    const profile = await getProfile();
    await saveProfile({ ...profile, gender: next.gender, height: `${next.height} см`, weight: `${next.weight} кг`, sizes: sizesSummary(next) });
  };
  const save = async () => {
    await persist({ ...body, sources });
    onToast?.("Мерки сохранены — подберу размер в покупках");
  };
  const setOwn = (id, value) => {
    const next = { ...measured };
    if (value === undefined) delete next[id]; else next[id] = value;
    setMeasured(next);
    if (sources[id]) { const rest = { ...sources }; delete rest[id]; setSources(rest); }
  };
  const applyPhoto = async ({ height: h, values: found }) => {
    const nextMeasured = { ...measured, ...found };
    const nextSources = { ...sources, ...Object.fromEntries(Object.keys(found).map((id) => [id, "photo"])) };
    setHeight(h); setMeasured(nextMeasured); setSources(nextSources); // the photo screen closes itself after the palette question
    await persist({ gender, height: h, weight, measured: nextMeasured, sources: nextSources });
    onToast?.("Мерки по фото сохранены — можно поправить ползунками");
  };

  if (!ready) return null;
  return (
    <section className="screen sizes">
      <div className="subscreen-top">
        <button type="button" className="round-button round-button--lg" aria-label="Назад" onClick={onBack}><Icon name="back" size={22} width={2} /></button>
        <span className="tiny-text">Всё хранится на телефоне</span>
      </div>
      <h1 className="screen-title screen-title--sub">Мерки и размеры</h1>

      <div className="body3d-card rise">
        <Suspense fallback={<div className="body3d"><span className="shimmer body3d__loading" /></div>}>
          <Body3D gender={gender} height={height} weight={weight} values={values} focus={focus} />
        </Suspense>
        <span className="stage__caption">Потяни, чтобы повернуть · подсвечено: {focused?.label.toLowerCase()}</span>
      </div>

      <button type="button" className="photo-cta rise" onClick={() => setPhotoOpen(true)}>
        <span className="row-card__icon"><Icon name="camera" size={22} /></span>
        <span><b>Мерки по фото</b><small>Можно без помощника: поставь телефон — он сам скажет, как встать. Фото не уходит с телефона.</small></span>
        <Icon name="chevron" size={20} width={2} />
      </button>

      <div className="choice-row sizes__gender" role="radiogroup" aria-label="Фигура">
        {GENDERS.map(([id, label]) => <button type="button" role="radio" key={id || "none"} aria-checked={gender === id} className={`option-pill${gender === id ? " is-on" : ""}`} onClick={() => setGender(id)}>{id ? label : "Нейтральная"}</button>)}
      </div>

      <div className="panel">
        <label className="field-v2 slider-field"><span>Рост <b>{height} см</b></span><input type="range" min="140" max="210" step="1" value={height} onChange={(e) => setHeight(Number(e.target.value))} /></label>
        <label className="field-v2 slider-field"><span>Вес <b>{weight} кг</b></span><input type="range" min="40" max="150" step="1" value={weight} onChange={(e) => setWeight(Number(e.target.value))} /></label>
      </div>

      <div className="section-head"><span className="section-title">Мерки</span><span className="tiny-text">не знаешь — оставь оценку</span></div>
      <div className="panel measures">
        {MEASURES.map((m) => {
          const own = !estimated.has(m.id);
          const label = gender === "female" && m.female ? m.female : m.label;
          return (
            <div key={m.id} className={`measure${focus === m.id ? " is-focus" : ""}`} onPointerDown={() => setFocus(m.id)} onFocus={() => setFocus(m.id)}>
              <label className="field-v2 slider-field">
                <span>{label} <b>{m.id === "foot" ? values[m.id].toFixed(1) : values[m.id]} см</b></span>
                <input type="range" min={m.min} max={m.max} step={m.step} value={values[m.id]} onChange={(e) => setOwn(m.id, Number(e.target.value))} />
              </label>
              <div className="measure__meta">
                {own && sources[m.id] === "photo"
                  ? <span className="tag tag--small tag--photo">по фото</span>
                  : <span className={`tag tag--small${own ? " tag--own" : ""}`}>{own ? "твоя мерка" : "оценка"}</span>}
                {own && <button type="button" className="text-button" onClick={() => setOwn(m.id, undefined)}>вернуть оценку</button>}
              </div>
              {focus === m.id && <p className="tiny-text measure__how">{m.how}</p>}
            </div>
          );
        })}
      </div>

      <div className="section-head"><span className="section-title">Твои размеры</span><span className="tiny-text">EN 13402 · Mondopoint</span></div>
      <div className="size-grid">
        {sizes.map((s, i) => (
          <button type="button" key={s.id} className="size-card rise" style={{ animationDelay: `${i * 0.05}s` }} onClick={() => openChart(s.id)} aria-label={`${s.label}: ${s.value}. Открыть размерную сетку`}>
            <span className="tiny-text">{s.label}</span>
            <span className="size-card__value">{s.value}</span>
            <span className="tiny-text">{s.detail}</span>
            {s.note && <span className="size-card__note">{s.note}</span>}
            {s.estimated && <span className="tag tag--small">по оценке</span>}
          </button>
        ))}
      </div>
      <p className="tiny-text">У брендов свои таблицы, поэтому это отправная точка. Чем больше своих мерок, тем точнее размер.</p>

      <div className="section-head" ref={chartRef}><span className="section-title">Размерная сетка</span><span className="tiny-text">твоя строка выделена</span></div>
      <div className="filter-row chart-tabs" role="tablist" aria-label="Размерная сетка">
        {charts.map((c) => <button type="button" role="tab" key={c.id} aria-selected={chart === c.id} className={`filter-pill${chart === c.id ? " is-on" : ""}`} onClick={() => setChart(c.id)}>{c.label}</button>)}
      </div>
      <div className="size-table-wrap panel">
        <table className="size-table">
          <thead><tr>{table.columns.map((c) => <th key={c} scope="col">{c}</th>)}</tr></thead>
          <tbody>
            {table.rows.map((r) => (
              <tr key={String(r.cells[0])} className={r.me ? "is-me" : ""} aria-current={r.me ? "true" : undefined}>
                {r.cells.map((c, i) => <td key={i}>{i === 0 && r.me ? <><b>{c}</b> <span className="size-table__me">ты</span></> : c}</td>)}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="tiny-text">{table.note}</p>

      <button type="button" className="btn btn--dark btn--block btn--tall" onClick={save}><Icon name="check" size={18} width={2.2} /> Сохранить</button>

      {photoOpen && (
        <Suspense fallback={null}>
          <PhotoMeasure gender={gender} height={height} weight={weight} current={values} onClose={() => setPhotoOpen(false)} onSave={applyPhoto} />
        </Suspense>
      )}
    </section>
  );
}
