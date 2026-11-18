// «Профиль»: palette and reminder entry points, style profile, what the stylist learned,
// the try-on photo and access to the owner's server.
import { useEffect, useRef, useState } from "react";
import { clearTryOns, getPalette, getTiming } from "./lib/daily.js";
import { checkConnection } from "./lib/gemini.js";
import { normalizeImage } from "./lib/image.js";
import { clearFeedback, EMPTY_PROFILE, getFeedback, getLearned, getModelReference, getProfile, getSettings, saveLearned, saveProfile, saveSettings, setModelReference } from "./lib/settings.js";
import { COUNTRIES } from "./lib/countries.js";
import { plural } from "./lib/plural.js";
import { getBody, sizesSummary, wardrobeSizes } from "./lib/sizes.js";
import { AVOID, FITS, GENDERS, GOALS, PLACES, STYLES, genderLabel, joinList, splitList } from "./lib/style-options.js";
import { Icon } from "./ui.jsx";

const TIMING_LABEL = { morning: "Утром, на сегодня", evening: "С вечера, на завтра", both: "Оба раза" };

const top = (counts, n) => [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, n).map(([k]) => k);
const tally = (values) => values.reduce((map, v) => map.set(v, (map.get(v) || 0) + 1), new Map());

// «Что я о тебе знаю»: what the stylist has learned, counted on the device from ratings and rules.
// Shown back to the user so every tap visibly makes the app more theirs.
function KnowledgeCard({ items, feedback, learned, onShowRules }) {
  const liked = feedback.filter((f) => f.liked);
  const disliked = feedback.filter((f) => !f.liked);
  const names = new Map(items.map((i) => [i.id, i.name]));
  const loves = [
    ...top(tally(liked.flatMap((f) => f.reasons || []).filter((r) => !r.startsWith("Не нравится"))), 2).map((r) => r.toLowerCase()),
    ...top(tally(liked.flatMap((f) => f.itemIds || []).filter((id) => names.has(id))), 2).map((id) => names.get(id)),
  ];
  const avoids = top(tally(disliked.flatMap((f) => f.reasons || []).map((r) => (r.startsWith("Не нравится: ") ? r.slice(13) : r.toLowerCase()))), 3);
  const left = Math.max(0, 10 - feedback.length);
  return (
    <div className="knowledge rise">
      <span className="knowledge__label">Что я о тебе знаю</span>
      <div className="knowledge__stats">
        <span><b>{items.length}</b>{plural(items.length, ["вещь", "вещи", "вещей"])}</span>
        <span><b>{feedback.length}</b>{plural(feedback.length, ["оценка", "оценки", "оценок"])}</span>
        <span><b>{liked.length}</b>{plural(liked.length, ["лайк", "лайка", "лайков"])}</span>
        <span><b>{learned.length}</b>{plural(learned.length, ["правило", "правила", "правил"])}</span>
      </div>
      {loves.length > 0 && <p><span className="knowledge__key">Любишь</span>{loves.join(", ")}</p>}
      {avoids.length > 0 && <p><span className="knowledge__key">Не предлагаю</span>{avoids.join(", ")}</p>}
      {!loves.length && !avoids.length && <p className="knowledge__muted">Пока знаю только твой гардероб. Оценивай образы в «Сегодня» — каждый тап меняет следующий подбор.</p>}
      {left > 0 && (loves.length > 0 || avoids.length > 0) && <p className="knowledge__muted">Ещё {left} {left === 1 ? "оценка" : left < 5 ? "оценки" : "оценок"} — и подбор станет заметно точнее.</p>}
      {learned.length > 0 && <button type="button" className="text-button text-button--dark" onClick={onShowRules}>Правила стилиста ({learned.length})</button>}
    </div>
  );
}

// Chips for known answers plus the user's own words (kept as extra chips).
function ChipsField({ label, options, value, onChange }) {
  const chosen = splitList(value);
  const custom = chosen.filter((v) => !options.includes(v));
  const [draft, setDraft] = useState("");
  const [adding, setAdding] = useState(false);
  const toggle = (option) => onChange(joinList(chosen.includes(option) ? chosen.filter((v) => v !== option) : [...chosen, option]));
  const add = () => { if (draft.trim()) onChange(joinList([...chosen, draft.trim()])); setDraft(""); setAdding(false); };
  return (
    <div className="chips-field">
      <span className="chips-field__label">{label}</span>
      <div className="chip-row">
        {[...options, ...custom].map((o) => {
          const on = chosen.includes(o);
          return <button type="button" key={o} className={`chip${on ? " is-on" : ""}`} aria-pressed={on} onClick={() => toggle(o)}>{on && <Icon name="check" size={14} width={2.6} />}{o}</button>;
        })}
        {adding ? (
          <span className="chip-input"><input autoFocus value={draft} maxLength={40} placeholder="Своё" onChange={(e) => setDraft(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") add(); if (e.key === "Escape") setAdding(false); }} onBlur={add} /></span>
        ) : <button type="button" className="chip chip--add" onClick={() => setAdding(true)}><Icon name="plus" size={14} width={2.4} /> своё</button>}
      </div>
    </div>
  );
}

// «Ты»: who the stylist dresses, with sizes. Opens the measurements screen with the 3D body.
// Sizes: the user's own choices and the clothes that fit come first, then the measurements.
function YouCard({ profile, body, chosen, owned, onOpen }) {
  const facts = [profile.gender ? genderLabel(profile.gender) : "", profile.height, profile.weight].filter(Boolean).join(" · ");
  const sizes = sizesSummary(body, { chosen, owned, gender: profile.gender });
  return (
    <button type="button" className="you-card rise" onClick={onOpen}>
      <span className="you-card__avatar"><Icon name="ruler" size={24} /></span>
      <span className="you-card__text">
        <span className="you-card__label">Ты</span>
        <span className="strong-text">{facts || "Пол, рост и мерки"}</span>
        <span className="tiny-text">{sizes ? `Размеры: ${sizes}` : "Мерки по фото или вручную — подберу размер и покажу 3D-фигуру"}</span>
      </span>
      <Icon name="chevron" size={20} width={2} />
    </button>
  );
}

export function SettingsView({ items = [], focus, onOpen, onToast, onRestartOnboarding }) {
  const [settings, setSettings] = useState(null);
  const [profile, setProfile] = useState(EMPTY_PROFILE);
  const [reference, setReference] = useState(null);
  const [learned, setLearned] = useState([]);
  const [newRule, setNewRule] = useState("");
  const [checking, setChecking] = useState({ tone: "", text: "" });
  const [palette, setPalette] = useState(null);
  const [timing, setTiming] = useState(null);
  const [feedback, setFeedback] = useState([]);
  const [body, setBody] = useState(null);
  const [settingsOpen, setSettingsOpen] = useState(focus === "access");
  const fileRef = useRef(null);
  const accessRef = useRef(null);
  const rulesRef = useRef(null);

  useEffect(() => {
    getSettings().then(setSettings);
    getProfile().then(setProfile);
    getLearned().then(setLearned);
    getPalette().then(setPalette);
    getTiming().then(setTiming);
    getFeedback().then(setFeedback);
    getBody().then(setBody);
    getModelReference().then((blob) => setReference(blob ? URL.createObjectURL(blob) : null));
  }, []);

  useEffect(() => {
    if (focus === "access" && settings) { setSettingsOpen(true); setTimeout(() => accessRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }), 50); }
  }, [focus, settings]);

  if (!settings) return null;

  const saveAccess = async () => {
    const next = await saveSettings({ proxyUrl: settings.proxyUrl, accessCode: settings.accessCode, modeledPhotos: settings.modeledPhotos });
    setSettings(next);
    return next;
  };

  const check = async () => {
    setChecking({ tone: "", text: "Проверяю…" });
    try {
      await saveAccess();
      const value = await checkConnection();
      setChecking({ tone: "ok", text: `Работает. Привет, ${value.user}! Сегодня осталось: картинок ${value.remaining.image}, запросов ${value.remaining.text}${value.features ? `, поиск цен ${value.features.prices ? `включён (${value.remaining.search})` : "пока не подключён"}` : ""}.` });
    } catch (e) {
      setChecking({ tone: "error", text: e.message });
    }
  };

  const pickReference = async (file) => {
    if (!file) return;
    const blob = await normalizeImage(file, 1536);
    await setModelReference(blob);
    await clearTryOns();
    setReference(URL.createObjectURL(blob));
    onToast?.("Фото сохранено");
  };

  const removeReference = async () => { await setModelReference(null); await clearTryOns(); setReference(null); };

  return (
    <section className="screen profile">
      <h1 className="screen-title rise">Профиль</h1>

      <KnowledgeCard items={items} feedback={feedback} learned={learned} onShowRules={() => rulesRef.current?.scrollIntoView({ behavior: "smooth", block: "start" })} />

      <YouCard profile={profile} body={body || (Number.parseInt(profile.height, 10) ? { gender: profile.gender, height: Number.parseInt(profile.height, 10), weight: Number.parseInt(profile.weight, 10) || 70 } : null)}
        chosen={settings.chosenSizes} owned={wardrobeSizes(items, body?.gender || profile.gender)} onOpen={() => onOpen("sizes")} />

      <button type="button" className="palette-teaser rise" onClick={() => onOpen("palette")}>
        <span className="palette-teaser__text">
          <span className="palette-teaser__label">Моя палитра</span>
          <span className="palette-teaser__title">{palette?.result?.season || "Узнай свой цветотип"}</span>
          <span className="palette-teaser__swatches">
            {(palette?.result?.best || [{ hex: "#B07A4F" }, { hex: "#6F6B3E" }, { hex: "#A8553A" }, { hex: "#C19A6B" }, { hex: "#9AA58A" }]).slice(0, 6).map((c, i) => <span key={i} style={{ background: c.hex }} />)}
          </span>
        </span>
        <Icon name="chevron" size={22} width={2} />
      </button>

      <button type="button" className="row-card rise" style={{ animationDelay: ".04s" }} onClick={() => onOpen("timing")}>
        <span className="row-card__icon"><Icon name="bell" size={22} /></span>
        <span className="row-card__text"><span className="strong-text">Когда присылать образ</span><span className="tiny-text">{timing ? `${TIMING_LABEL[timing.mode]}${timing.mode !== "evening" ? ` · ${timing.morning}` : ""}${timing.mode !== "morning" ? ` · ${timing.evening}` : ""}` : ""}</span></span>
        <Icon name="chevron" size={20} width={2} />
      </button>

      <div className="panel rise" style={{ animationDelay: ".08s" }}>
        <h2 className="panel__title">Мой стиль</h2>
        <p className="muted-text">Отметь, что нравится. Стилист учитывает это в каждом образе и в покупках.</p>
        <ChipsField label="Стили" options={STYLES} value={profile.styles} onChange={(v) => setProfile({ ...profile, styles: v })} />
        <ChipsField label="Фасоны" options={FITS} value={profile.fits} onChange={(v) => setProfile({ ...profile, fits: v })} />
        <ChipsField label="Чего хочу от образов" options={GOALS} value={profile.goal} onChange={(v) => setProfile({ ...profile, goal: v })} />
        <ChipsField label="Куда хожу чаще всего" options={PLACES} value={profile.places} onChange={(v) => setProfile({ ...profile, places: v })} />
        <ChipsField label="Никогда не предлагать" options={AVOID} value={profile.avoid} onChange={(v) => setProfile({ ...profile, avoid: v })} />
        <div className="form-grid">
          <label className="field-v2"><span>Цвета, которые идут <small>заполнит «Моя палитра»</small></span><input value={profile.palette || ""} placeholder="кремовый, бежевый, серый" onChange={(e) => setProfile({ ...profile, palette: e.target.value })} /></label>
          <label className="field-v2"><span>Что ещё учесть</span><input value={profile.notes || ""} placeholder="ношу очки, люблю карманы" onChange={(e) => setProfile({ ...profile, notes: e.target.value })} /></label>
        </div>
        <div className="row-gap">
          <button type="button" className="btn btn--dark btn--small" onClick={async () => { await saveProfile(profile); onToast?.("Стиль сохранён — учту в следующих образах"); }}><Icon name="check" size={16} width={2.2} /> Сохранить</button>
          <button type="button" className="btn btn--outline btn--small" onClick={async () => { if (window.confirm("Стереть все оценки образов?")) { await clearFeedback(); setFeedback([]); onToast?.("Оценки стёрты"); } }}>Сбросить оценки</button>
        </div>
      </div>

      <div className="panel" ref={rulesRef}>
        <h2 className="panel__title">Правила стилиста</h2>
        <p className="muted-text">Правила из твоих комментариев к образам. Они важнее профиля. Можно удалить лишнее или дописать своё.</p>
        {learned.length ? (
          <ul className="rule-list">
            {learned.map((rule) => (
              <li key={rule}><span>{rule}</span><button type="button" className="round-button round-button--sm" aria-label={`Забыть: ${rule}`} onClick={async () => setLearned(await saveLearned(learned.filter((r) => r !== rule)))}><Icon name="close" size={14} width={2.2} /></button></li>
            ))}
          </ul>
        ) : <p className="tiny-text">Пока пусто. Нажми «Другой образ» и напиши своими словами, что не так.</p>}
        <div className="inline-form">
          <input value={newRule} placeholder="Например: не предлагать белые кроссовки" onChange={(e) => setNewRule(e.target.value)} />
          <button type="button" className="btn btn--outline btn--small" onClick={async () => { if (!newRule.trim()) return; setLearned(await saveLearned([...learned, newRule])); setNewRule(""); }}>Добавить</button>
        </div>
      </div>

      <button type="button" className={`settings-toggle${settingsOpen ? " is-open" : ""}`} aria-expanded={settingsOpen} onClick={() => setSettingsOpen((v) => !v)}>
        <span><span className="strong-text">Настройки</span><span className="tiny-text">Страна для покупок, фото для примерки, доступ</span></span>
        <Icon name="chevron" size={20} width={2} />
      </button>

      {settingsOpen && (<>
      <div className="panel rise">
        <h2 className="panel__title">Страна для покупок</h2>
        <p className="muted-text">Где искать цены с доставкой и сайты б/у.</p>
        <div className="chip-row">
          {COUNTRIES.map((c) => <button type="button" key={c.id} className={`chip${settings.country === c.id ? " is-on" : ""}`} aria-pressed={settings.country === c.id} onClick={async () => setSettings(await saveSettings({ country: c.id }))}>{settings.country === c.id && <Icon name="check" size={14} width={2.6} />}{c.name}</button>)}
        </div>
      </div>

      <div className="panel">
        <h2 className="panel__title">Фото для примерки</h2>
        <p className="muted-text">Твоё фото в полный рост: с него ИИ берёт только лицо и фигуру, а одежду заменяет на образ. Лучше всего: стоя прямо, лицом к камере, руки вдоль тела, хороший свет. Хранится только на этом устройстве и отправляется в Google лишь при генерации.</p>
        <div className="reference-row">
          {reference ? <img className="reference-photo" src={reference} alt="Фото для примерки" /> : <div className="reference-photo reference-photo--empty"><Icon name="camera" size={26} /></div>}
          <div className="reference-actions">
            <input ref={fileRef} type="file" accept="image/*" hidden onChange={(e) => { pickReference(e.target.files?.[0]); e.target.value = ""; }} />
            <button type="button" className="btn btn--outline btn--small" onClick={() => fileRef.current?.click()}>{reference ? "Заменить" : "Загрузить фото"}</button>
            {reference && <button type="button" className="btn btn--ghost btn--small" onClick={removeReference}>Удалить</button>}
            <label className="toggle"><input type="checkbox" checked={settings.modeledPhotos} onChange={async (e) => { const next = { ...settings, modeledPhotos: e.target.checked }; setSettings(next); setSettings(await saveSettings({ modeledPhotos: next.modeledPhotos })); }} /> <span>Делать фото «на мне» для каждой новой вещи <small className="tiny-text">тратит 1 картинку на вещь · позже в премиум</small></span></label>
          </div>
        </div>
      </div>

      <div className="panel" ref={accessRef}>
        <h2 className="panel__title">Доступ</h2>
        <p className="muted-text">Код доступа тебе даст владелец приложения. Адрес сервера обычно уже вписан.</p>
        <div className="form-grid">
          <label className="field-v2"><span>Код доступа</span><input value={settings.accessCode} autoComplete="off" autoCapitalize="off" spellCheck={false} onChange={(e) => setSettings({ ...settings, accessCode: e.target.value })} /></label>
          <label className="field-v2"><span>Адрес сервера</span><input value={settings.proxyUrl} inputMode="url" autoCapitalize="off" spellCheck={false} placeholder="https://capsule-proxy.имя.workers.dev" onChange={(e) => setSettings({ ...settings, proxyUrl: e.target.value })} /></label>
        </div>
        <div className="row-gap">
          <button type="button" className="btn btn--dark btn--small" onClick={check}>Сохранить и проверить</button>
        </div>
        {checking.text && <p className={`status-line${checking.tone ? ` status-line--${checking.tone}` : ""}`} role="status">{checking.text}</p>}
        <p className="tiny-text">Адрес этого приложения: {window.location.origin}</p>
      </div>
      </>)}

      {onRestartOnboarding && <button type="button" className="text-button center-text restart-link" onClick={onRestartOnboarding}>Пройти знакомство заново</button>}
    </section>
  );
}
