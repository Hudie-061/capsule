// «Профиль»: palette and reminder entry points, style profile, what the stylist learned,
// the try-on photo and access to the owner's server.
import { useEffect, useRef, useState } from "react";
import { clearTryOns, getPalette, getTiming } from "./lib/daily.js";
import { checkConnection } from "./lib/gemini.js";
import { normalizeImage } from "./lib/image.js";
import { clearFeedback, EMPTY_PROFILE, getLearned, getModelReference, getProfile, getSettings, saveLearned, saveProfile, saveSettings, setModelReference } from "./lib/settings.js";
import { Icon } from "./ui.jsx";

const PROFILE_FIELDS = [
  ["height", "Рост", "185 см"],
  ["weight", "Вес", "80 кг"],
  ["build", "Телосложение", "спортивное, широкие плечи"],
  ["goal", "Чего хочу от образов", "подчеркнуть фигуру"],
  ["styles", "Любимые стили", "street, немного sport"],
  ["fits", "Любимые фасоны", "оверсайз верх, бэгги с высокой посадкой"],
  ["palette", "Цвета, которые идут", "кремовый, бежевый, серый"],
  ["avoid", "Никогда не предлагать", "узкие штаны, индиго-деним"],
  ["notes", "Что ещё учесть", "хожу на учёбу и в зал"],
];
const TIMING_LABEL = { morning: "Утром, на сегодня", evening: "С вечера, на завтра", both: "Оба раза" };

export function SettingsView({ focus, onOpen, onToast }) {
  const [settings, setSettings] = useState(null);
  const [profile, setProfile] = useState(EMPTY_PROFILE);
  const [reference, setReference] = useState(null);
  const [learned, setLearned] = useState([]);
  const [newRule, setNewRule] = useState("");
  const [checking, setChecking] = useState({ tone: "", text: "" });
  const [palette, setPalette] = useState(null);
  const [timing, setTiming] = useState(null);
  const fileRef = useRef(null);
  const accessRef = useRef(null);

  useEffect(() => {
    getSettings().then(setSettings);
    getProfile().then(setProfile);
    getLearned().then(setLearned);
    getPalette().then(setPalette);
    getTiming().then(setTiming);
    getModelReference().then((blob) => setReference(blob ? URL.createObjectURL(blob) : null));
  }, []);

  useEffect(() => {
    if (focus === "access" && settings) accessRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
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
      setChecking({ tone: "ok", text: `Работает. Привет, ${value.user}! Сегодня осталось: картинок ${value.remaining.image}, запросов ${value.remaining.text}.` });
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
        <p className="muted-text">Стилист учитывает это при каждом подборе. Можно писать как угодно, своими словами.</p>
        <div className="form-grid">
          {PROFILE_FIELDS.map(([key, label, placeholder]) => (
            <label className="field-v2" key={key}>
              <span>{label}</span>
              <input value={profile[key] || ""} placeholder={placeholder} onChange={(e) => setProfile({ ...profile, [key]: e.target.value })} />
            </label>
          ))}
        </div>
        <div className="row-gap">
          <button type="button" className="btn btn--dark btn--small" onClick={async () => { await saveProfile(profile); onToast?.("Профиль сохранён"); }}><Icon name="check" size={16} width={2.2} /> Сохранить</button>
          <button type="button" className="btn btn--outline btn--small" onClick={async () => { if (window.confirm("Стереть все оценки образов?")) { await clearFeedback(); onToast?.("Оценки стёрты"); } }}>Сбросить оценки</button>
        </div>
      </div>

      <div className="panel">
        <h2 className="panel__title">Что запомнил стилист</h2>
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

      <div className="panel">
        <h2 className="panel__title">Фото для примерки</h2>
        <p className="muted-text">Твоё фото в полный рост: с него ИИ берёт только лицо и фигуру, а одежду заменяет на образ. Лучше всего: стоя прямо, лицом к камере, руки вдоль тела, хороший свет. Хранится только на этом устройстве и отправляется в Google лишь при генерации.</p>
        <div className="reference-row">
          {reference ? <img className="reference-photo" src={reference} alt="Фото для примерки" /> : <div className="reference-photo reference-photo--empty"><Icon name="camera" size={26} /></div>}
          <div className="reference-actions">
            <input ref={fileRef} type="file" accept="image/*" hidden onChange={(e) => { pickReference(e.target.files?.[0]); e.target.value = ""; }} />
            <button type="button" className="btn btn--outline btn--small" onClick={() => fileRef.current?.click()}>{reference ? "Заменить" : "Загрузить фото"}</button>
            {reference && <button type="button" className="btn btn--ghost btn--small" onClick={removeReference}>Удалить</button>}
            <label className="toggle"><input type="checkbox" checked={settings.modeledPhotos} onChange={async (e) => { const next = { ...settings, modeledPhotos: e.target.checked }; setSettings(next); setSettings(await saveSettings({ modeledPhotos: next.modeledPhotos })); }} /> <span>Делать фото «на мне» при добавлении вещи</span></label>
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
    </section>
  );
}
