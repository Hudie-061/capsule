import { useEffect, useRef, useState } from "react";
import { Check, Trash, UploadSimple } from "@phosphor-icons/react";
import { normalizeImage } from "./lib/image.js";
import { clearFeedback, EMPTY_PROFILE, getLearned, getModelReference, getProfile, getSettings, saveLearned, saveProfile, saveSettings, setModelReference } from "./lib/settings.js";

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

export function SettingsView() {
  const [settings, setSettings] = useState(null);
  const [profile, setProfile] = useState(EMPTY_PROFILE);
  const [reference, setReference] = useState(null);
  const [learned, setLearned] = useState([]);
  const [newRule, setNewRule] = useState("");
  const [status, setStatus] = useState("");
  const [checking, setChecking] = useState("");
  const fileRef = useRef(null);

  useEffect(() => {
    getSettings().then(setSettings);
    getProfile().then(setProfile);
    getLearned().then(setLearned);
    getModelReference().then((blob) => setReference(blob ? URL.createObjectURL(blob) : null));
  }, []);

  if (!settings) return null;

  const flash = (text) => { setStatus(text); setTimeout(() => setStatus(""), 2500); };

  const saveAccess = async () => {
    const next = await saveSettings({ proxyUrl: settings.proxyUrl, accessCode: settings.accessCode, modeledPhotos: settings.modeledPhotos });
    setSettings(next);
    flash("Сохранено");
  };

  const check = async () => {
    setChecking("Проверяю…");
    try {
      const response = await fetch(`${settings.proxyUrl.replace(/\/$/, "")}/status`, { headers: { "X-Access-Code": settings.accessCode.trim() } });
      const value = await response.json().catch(() => ({}));
      if (response.status === 401) throw new Error("Код доступа не подошёл");
      if (!response.ok) throw new Error(value.error || `Сервер ответил ${response.status}`);
      setChecking(`Работает. Привет, ${value.user}! Сегодня осталось: картинок ${value.remaining.image}, запросов ${value.remaining.text}.`);
    } catch (e) { setChecking(e.message === "Failed to fetch" ? "Нет связи с сервером. Проверь адрес." : e.message); }
  };

  const pickReference = async (file) => {
    if (!file) return;
    const blob = await normalizeImage(file, 1536);
    await setModelReference(blob);
    setReference(URL.createObjectURL(blob));
    flash("Фото сохранено");
  };

  const removeReference = async () => { await setModelReference(null); setReference(null); };

  return (
    <section className="settings-view">
      <div className="settings-block">
        <h2>Мой стиль</h2>
        <p className="settings-help">Стилист учитывает это при каждом подборе. Можно писать как угодно, своими словами.</p>
        <div className="settings-grid">
          {PROFILE_FIELDS.map(([key, label, placeholder]) => (
            <div className="import-field" key={key}>
              <label htmlFor={`p-${key}`}>{label}</label>
              <input id={`p-${key}`} value={profile[key] || ""} placeholder={placeholder} onChange={(e) => setProfile({ ...profile, [key]: e.target.value })} />
            </div>
          ))}
        </div>
        <div className="settings-actions">
          <button type="button" className="primary-button" onClick={async () => { await saveProfile(profile); flash("Профиль сохранён"); }}><Check size={15} /> Сохранить профиль</button>
          <button type="button" className="secondary-button" onClick={async () => { if (window.confirm("Стереть все оценки образов?")) { await clearFeedback(); flash("Оценки стёрты"); } }}>Сбросить оценки</button>
        </div>
      </div>

      <div className="settings-block">
        <h2>Что запомнил стилист</h2>
        <p className="settings-help">Правила из твоих комментариев к образам. Они важнее профиля. Можно удалить лишнее или дописать своё.</p>
        {learned.length ? (
          <ul className="learned-list">
            {learned.map((rule) => (
              <li key={rule}><span>{rule}</span><button type="button" className="import-icon-button" aria-label={`Забыть: ${rule}`} onClick={async () => setLearned(await saveLearned(learned.filter((r) => r !== rule)))}><Trash size={15} /></button></li>
            ))}
          </ul>
        ) : <p className="settings-help">Пока пусто. Напиши комментарий к образу во вкладке «Образы».</p>}
        <div className="learned-add">
          <input value={newRule} placeholder="Например: не предлагать белые кроссовки" onChange={(e) => setNewRule(e.target.value)} />
          <button type="button" className="secondary-button" onClick={async () => { if (!newRule.trim()) return; setLearned(await saveLearned([...learned, newRule])); setNewRule(""); }}>Добавить</button>
        </div>
      </div>

      <div className="settings-block">
        <h2>Фото для примерки</h2>
        <p className="settings-help">Твоё фото в полный рост: на нём Gemini «надевает» вещи. Хранится только на этом устройстве и отправляется в Google лишь при генерации.</p>
        <div className="reference-row">
          {reference ? <img className="reference-preview" src={reference} alt="Фото для примерки" /> : <div className="reference-preview reference-preview--empty">Нет фото</div>}
          <div className="settings-actions settings-actions--column">
            <input ref={fileRef} type="file" accept="image/*" hidden onChange={(e) => { pickReference(e.target.files?.[0]); e.target.value = ""; }} />
            <button type="button" className="secondary-button" onClick={() => fileRef.current?.click()}><UploadSimple size={15} /> {reference ? "Заменить" : "Загрузить фото"}</button>
            {reference && <button type="button" className="secondary-button" onClick={removeReference}><Trash size={15} /> Удалить</button>}
            <label className="toggle-row"><input type="checkbox" checked={settings.modeledPhotos} onChange={(e) => setSettings({ ...settings, modeledPhotos: e.target.checked })} /> Делать фото «на мне» при добавлении вещи</label>
          </div>
        </div>
      </div>

      <div className="settings-block">
        <h2>Доступ</h2>
        <p className="settings-help">Адрес сервера и личный код тебе даст владелец приложения.</p>
        <div className="settings-grid">
          <div className="import-field"><label htmlFor="proxy">Адрес сервера</label><input id="proxy" value={settings.proxyUrl} placeholder="https://capsule-proxy.имя.workers.dev" onChange={(e) => setSettings({ ...settings, proxyUrl: e.target.value })} /></div>
          <div className="import-field"><label htmlFor="code">Код доступа</label><input id="code" value={settings.accessCode} autoComplete="off" onChange={(e) => setSettings({ ...settings, accessCode: e.target.value })} /></div>
        </div>
        <div className="settings-actions">
          <button type="button" className="primary-button" onClick={saveAccess}><Check size={15} /> Сохранить</button>
          <button type="button" className="secondary-button" onClick={async () => { await saveAccess(); check(); }}>Проверить связь</button>
        </div>
        {checking && <p className="settings-help">{checking}</p>}
      </div>
      {status && <p className="settings-toast" role="status">{status}</p>}
    </section>
  );
}
