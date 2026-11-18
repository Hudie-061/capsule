// First launch: a short path to a personal app, every step skippable.
// welcome → access code (only if missing) → who you are → usual sizes → style quiz → first items.
// Answers go into the same style profile the stylist reads, so they can be changed in «Профиль».
// The usual sizes («Какой размер обычно носишь?») are the same choice as the size sheet in «Покупки»
// (settings.chosenSizes): three taps instead of a tape measure.
import { Suspense, lazy, useEffect, useMemo, useState } from "react";
import { kv } from "./lib/db.js";
import { checkConnection } from "./lib/gemini.js";
import { getProfile, getSettings, saveProfile, saveSettings } from "./lib/settings.js";
import { getBody, saveBody, sizeForKind, sizeLabel } from "./lib/sizes.js";
import { SizeChips } from "./size-chips.jsx";
import { GarmentIcon, Icon } from "./ui.jsx";

// The usual sizes asked at first launch: [size system, label, a kind of piece for the estimate].
const USUAL = [["letter", "Футболки, свитеры, худи", "t-shirt"], ["wl", "Джинсы", "jeans"], ["euBottom", "Брюки и юбки, EU", "trousers", "female"], ["shoe", "Обувь, EU", "sneakers"]];

import { AVOID, FITS, GENDERS, PLACES, STYLES } from "./lib/style-options.js";

// MediaPipe and the measuring code load only if the user opens «Мерки по фото».
const PhotoMeasure = lazy(() => import("./photo-measure.jsx").then((m) => ({ default: m.PhotoMeasure })));

export const isOnboardingDone = async () => Boolean((await kv.get("onboarding", null))?.done);
const finishOnboarding = () => kv.set("onboarding", { done: true, at: new Date().toISOString() });

const join = (set) => [...set].join(", ");
const split = (text) => new Set(String(text || "").split(",").map((s) => s.trim()).filter(Boolean));

function Chips({ options, value, onChange, label }) {
  return (
    <div className="chip-row" role="group" aria-label={label}>
      {options.map((o) => {
        const on = value.has(o);
        return (
          <button type="button" key={o} className={`chip${on ? " is-on" : ""}`} aria-pressed={on} onClick={() => {
            const next = new Set(value);
            if (on) next.delete(o); else next.add(o);
            onChange(next);
          }}>{on && <Icon name="check" size={14} width={2.6} />}{o}</button>
        );
      })}
    </div>
  );
}

export function Onboarding({ needsAccess, onDone, onAddItems }) {
  const steps = useMemo(() => ["welcome", ...(needsAccess ? ["access"] : []), "about", "sizes", "style", "items"], [needsAccess]);
  const [usual, setUsual] = useState({}); // { letter: "M", wl: { w: 32, l: 32 }, shoe: 43 } — only what was tapped
  const [index, setIndex] = useState(0);
  const step = steps[index];
  const [code, setCode] = useState("");
  const [check, setCheck] = useState({ busy: false, error: "", ok: "" });
  const [gender, setGender] = useState("");
  const [height, setHeight] = useState(175);
  const [weight, setWeight] = useState(70);
  const [bodyTouched, setBodyTouched] = useState(false);
  const [styles, setStyles] = useState(new Set());
  const [fits, setFits] = useState(new Set());
  const [avoid, setAvoid] = useState(new Set());
  const [places, setPlaces] = useState(new Set());
  const [photoOpen, setPhotoOpen] = useState(false);
  const [photoDone, setPhotoDone] = useState(null);

  useEffect(() => {
    getProfile().then((p) => {
      if (p.gender) setGender(p.gender);
      const h = Number.parseInt(p.height, 10); if (h >= 140 && h <= 210) { setHeight(h); setBodyTouched(true); }
      const w = Number.parseInt(p.weight, 10); if (w >= 40 && w <= 150) setWeight(w);
      setStyles(split(p.styles)); setFits(split(p.fits)); setAvoid(split(p.avoid)); setPlaces(split(p.places));
    });
    getSettings().then((s) => { setCode(s.accessCode || ""); setUsual(s.chosenSizes || {}); });
  }, []);

  const saveUsual = async () => {
    const s = await getSettings();
    const picked = Object.fromEntries(Object.entries(usual).filter(([, v]) => v != null));
    await saveSettings({ chosenSizes: { ...s.chosenSizes, ...picked } });
  };
  // a hint from height and weight, so the question is easy to answer («примерно M»)
  const roughBody = bodyTouched ? { gender, height, weight, measured: {} } : null;
  const roughSize = (kind) => (roughBody ? sizeForKind(kind, roughBody)?.value || "" : "");

  const save = async () => {
    const p = await getProfile();
    await saveProfile({
      ...p,
      gender,
      height: bodyTouched ? `${height} см` : p.height,
      weight: bodyTouched ? `${weight} кг` : p.weight,
      styles: styles.size ? join(styles) : p.styles,
      fits: fits.size ? join(fits) : p.fits,
      avoid: avoid.size ? join(avoid) : p.avoid,
      places: places.size ? join(places) : p.places,
    });
  };

  const next = async () => {
    if (step === "about" || step === "style") await save();
    if (step === "sizes") await saveUsual();
    setIndex((i) => Math.min(i + 1, steps.length - 1));
  };
  const back = () => setIndex((i) => Math.max(0, i - 1));
  const finish = async (addItems) => {
    if (addItems) onAddItems(); // first, while the tap still counts as a user gesture (needed for the file picker on iOS)
    await save();
    await finishOnboarding();
    onDone();
  };

  // measurements from photos go straight into the stored body, like «Мерки и размеры» does
  const applyPhoto = async ({ height: h, values }) => {
    const body = (await getBody()) || {};
    await saveBody({
      ...body, gender, height: h, weight,
      measured: { ...(body.measured || {}), ...values },
      sources: { ...(body.sources || {}), ...Object.fromEntries(Object.keys(values).map((id) => [id, "photo"])) },
    });
    setHeight(h); setBodyTouched(true); // the photo screen stays open for the palette question
    setPhotoDone(values);
  };

  const verify = async () => {
    setCheck({ busy: true, error: "", ok: "" });
    try {
      await saveSettings({ accessCode: code });
      const value = await checkConnection();
      setCheck({ busy: false, error: "", ok: `Привет, ${value.user}!` });
      setTimeout(() => setIndex((i) => i + 1), 700);
    } catch (e) {
      setCheck({ busy: false, error: e.message, ok: "" });
    }
  };

  return (
    <div className="onboarding" role="dialog" aria-modal="true" aria-label="Знакомство с приложением">
      <div className="onboarding__inner">
        <div className="onboarding__top">
          <div className="onboarding__dots" aria-label={`Шаг ${index + 1} из ${steps.length}`}>
            {steps.map((s, i) => <span key={s} className={i <= index ? "is-on" : ""} />)}
          </div>
          <button type="button" className="text-button" onClick={() => finish(false)}>Пропустить</button>
        </div>

        <div className="onboarding__body rise" key={step}>
          {step === "welcome" && (
            <>
              <span className="onboarding__brand">Капсула</span>
              <h1 className="screen-title">Твой гардероб, который сам собирает образы</h1>
              <ul className="onboarding__values">
                <li><span className="row-card__icon"><Icon name="today" size={22} /></span><span><b>Образ дня из твоих вещей</b><small>утром на сегодня или с вечера на завтра</small></span></li>
                <li><span className="row-card__icon"><Icon name="swap" size={22} /></span><span><b>Любую вещь заменишь одним тапом</b><small>и сразу увидишь образ на манекене</small></span></li>
                <li><span className="row-card__icon"><Icon name="bag" size={22} /></span><span><b>Подскажу, чего не хватает</b><small>и где это купить, новое или б/у</small></span></li>
              </ul>
              <p className="tiny-text">Займёт меньше минуты. Всё можно поменять потом в «Профиле».</p>
            </>
          )}

          {step === "access" && (
            <>
              <h1 className="screen-title">Код доступа</h1>
              <p className="muted-text lead-text">Приложение пока в закрытом тесте. Код тебе даст владелец — вводится один раз.</p>
              <label className="field-v2"><span>Код</span><input value={code} autoComplete="off" autoCapitalize="off" spellCheck={false} onChange={(e) => setCode(e.target.value)} placeholder="например: 7f3a91c2e8" /></label>
              {check.error && <p className="status-line status-line--error">{check.error}</p>}
              {check.ok && <p className="status-line status-line--ok">{check.ok}</p>}
            </>
          )}

          {step === "about" && (
            <>
              <h1 className="screen-title">Расскажи о себе</h1>
              <p className="muted-text lead-text">Чтобы манекен был похож на тебя, а в магазинах искались вещи нужного кроя.</p>
              <div className="field-v2">
                <span>Кто ты</span>
                <div className="choice-row" role="radiogroup" aria-label="Пол">
                  {GENDERS.map(([id, label]) => <button type="button" role="radio" key={id || "none"} aria-checked={gender === id} className={`option-pill${gender === id ? " is-on" : ""}`} onClick={() => setGender(id)}>{label}</button>)}
                </div>
              </div>
              <label className="field-v2 slider-field">
                <span>Рост <b>{height} см</b></span>
                <input type="range" min="140" max="210" step="1" value={height} onChange={(e) => { setHeight(Number(e.target.value)); setBodyTouched(true); }} />
              </label>
              <label className="field-v2 slider-field">
                <span>Вес <b>{weight} кг</b></span>
                <input type="range" min="40" max="150" step="1" value={weight} onChange={(e) => { setWeight(Number(e.target.value)); setBodyTouched(true); }} />
              </label>
              <p className="tiny-text">Рост и вес нужны только для пропорций манекена и подсказок по размеру. Хранятся на телефоне.</p>
              <button type="button" className="photo-cta" onClick={() => setPhotoOpen(true)}>
                <span className="row-card__icon"><Icon name="camera" size={22} /></span>
                <span><b>Мерки по фото</b><small>Можно без помощника: поставь телефон — он сам скажет, как встать, и посчитает обхваты. Фото не уходит с телефона.</small></span>
                <Icon name="chevron" size={20} width={2} />
              </button>
              {photoDone && (
                <p className="status-line status-line--ok">
                  Мерки по фото сохранены: {[["chest", "грудь"], ["waist", "талия"], ["hips", "бёдра"]].filter(([id]) => photoDone[id]).map(([id, name]) => `${name} ${photoDone[id]}`).join(", ")} см. Поправить можно в «Профиле».
                </p>
              )}
              {photoOpen && (
                <Suspense fallback={null}>
                  <PhotoMeasure gender={gender} height={height} weight={weight} onClose={() => setPhotoOpen(false)} onSave={applyPhoto} />
                </Suspense>
              )}
            </>
          )}

          {step === "sizes" && (
            <>
              <h1 className="screen-title">Какой размер обычно носишь?</h1>
              <p className="muted-text lead-text">Три тапа вместо сантиметровой ленты — по ним ищу вещи в магазинах. Не помнишь — пропусти: посчитаю по росту и весу, по фото или по бирке на твоих вещах.</p>
              <div className="usual-sizes">
                {USUAL.filter(([, , , only]) => !only || only === gender).map(([system, label, kind]) => {
                  const rough = roughSize(kind);
                  return (
                    <div key={system}>
                      <SizeChips system={system} gender={gender} label={label} value={usual[system] ?? null} scroll
                        onChange={(v) => setUsual((u) => ({ ...u, [system]: v }))} />
                      {usual[system] != null
                        ? <p className="usual-sizes__hint">Выбрано: {sizeLabel(system, usual[system])}</p>
                        : rough && <p className="usual-sizes__hint">По росту и весу примерно {rough}</p>}
                    </div>
                  );
                })}
              </div>
              <p className="tiny-text">Поменять можно в «Покупках» — у каждой вещи есть «Мой размер».</p>
            </>
          )}

          {step === "style" && (
            <>
              <h1 className="screen-title">Твой стиль</h1>
              <p className="muted-text lead-text">Отметь, что нравится. Дальше стилист будет учиться на твоих оценках.</p>
              <div className="onboarding__group"><span className="section-label">Стили</span><Chips label="Стили" options={STYLES} value={styles} onChange={setStyles} /></div>
              <div className="onboarding__group"><span className="section-label">Фасоны</span><Chips label="Фасоны" options={FITS} value={fits} onChange={setFits} /></div>
              <div className="onboarding__group"><span className="section-label">Куда ходишь чаще всего</span><Chips label="Поводы" options={PLACES} value={places} onChange={setPlaces} /></div>
              <div className="onboarding__group"><span className="section-label">Никогда не предлагать</span><Chips label="Никогда не предлагать" options={AVOID} value={avoid} onChange={setAvoid} /></div>
            </>
          )}

          {step === "items" && (
            <>
              <div className="onboarding__tiles" aria-hidden="true">
                <span><GarmentIcon item={{ kind: "hoodie" }} color="#A9A39B" size={64} /></span>
                <span><GarmentIcon item={{ kind: "jeans" }} color="#3C4A63" size={64} /></span>
                <span><GarmentIcon item={{ kind: "sneakers" }} color="#FFFFFF" size={64} /></span>
              </div>
              <h1 className="screen-title">Добавь первые вещи</h1>
              <p className="muted-text lead-text">Сфотографируй 3–5 вещей — первый образ соберу сразу. Можно сфотографировать себя в образе: найду каждую вещь, а добавлю только те, что ты отметишь.</p>
            </>
          )}
        </div>

        <div className="onboarding__actions">
          {step === "welcome" && <button type="button" className="btn btn--dark btn--block btn--tall" onClick={next}>Начать</button>}
          {step === "access" && (
            <>
              <button type="button" className="btn btn--dark btn--block btn--tall" disabled={!code.trim() || check.busy} onClick={verify}>{check.busy ? "Проверяю…" : "Проверить и дальше"}</button>
              <button type="button" className="btn btn--ghost" onClick={next}>У меня пока нет кода</button>
            </>
          )}
          {(step === "about" || step === "sizes" || step === "style") && (
            <div className="action-row">
              <button type="button" className="btn btn--outline btn--grow1" onClick={back}>Назад</button>
              <button type="button" className="btn btn--dark btn--grow2" onClick={next}>Дальше</button>
            </div>
          )}
          {step === "items" && (
            <>
              <button type="button" className="btn btn--dark btn--block btn--tall" onClick={() => finish(true)}><Icon name="plus" size={20} width={2} /> Добавить вещи</button>
              <button type="button" className="btn btn--ghost" onClick={() => finish(false)}>Позже</button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
