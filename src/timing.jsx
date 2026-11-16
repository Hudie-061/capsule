// «Когда присылать образ» (design/Hybrid-Timing.dc.html, in v2 style).
// The choice already decides what «Сегодня» opens with. Real push reminders are a later step.
import { useEffect, useState } from "react";
import { EVENING_TIMES, MORNING_TIMES, getTiming, saveTiming } from "./lib/daily.js";
import { Icon } from "./ui.jsx";

const OPTIONS = [
  { id: "morning", icon: "sun", title: "Утром", desc: "Образ на сегодня — по погоде за окном" },
  { id: "evening", icon: "moon", title: "С вечера", desc: "Образ на завтра — успеешь собрать и погладить" },
  { id: "both", icon: "both", title: "Оба раза", desc: "Вечером план, утром поправка, если погода изменилась" },
];

export function TimingView({ onBack, onToast }) {
  const [timing, setTiming] = useState(null);
  useEffect(() => { getTiming().then(setTiming); }, []);
  if (!timing) return null;

  const evening = timing.mode !== "morning";
  const times = (list, key, label) => (
    <div className="time-row rise">
      <span className="time-row__label">{label}</span>
      {list.map((t) => <button type="button" key={t} className={`time-pill${timing[key] === t ? " is-on" : ""}`} aria-pressed={timing[key] === t} onClick={() => setTiming({ ...timing, [key]: t })}>{t}</button>)}
    </div>
  );

  return (
    <section className="screen timing">
      <div className="subscreen-top">
        <button type="button" className="round-button round-button--lg" aria-label="Назад" onClick={onBack}><Icon name="back" size={22} width={2} /></button>
      </div>
      <h1 className="screen-title screen-title--sub">Когда присылать образ?</h1>
      <p className="muted-text lead-text">Многие собираются с вечера — выбери, как удобно тебе. Это можно поменять в любой момент.</p>

      <div className="option-list" role="radiogroup" aria-label="Время подбора образа">
        {OPTIONS.map((o) => {
          const on = timing.mode === o.id;
          return (
            <button type="button" role="radio" aria-checked={on} key={o.id} className={`option-card${on ? " is-on" : ""}`} onClick={() => setTiming({ ...timing, mode: o.id })}>
              <span className="option-card__icon"><Icon name={o.icon} size={22} width={1.9} /></span>
              <span className="option-card__text"><span className="option-card__title">{o.title}</span><span className="muted-text">{o.desc}</span></span>
              <span className="radio-dot" aria-hidden="true"><span /></span>
            </button>
          );
        })}
      </div>

      <div className="section-label">Время уведомления</div>
      {timing.mode !== "evening" && times(MORNING_TIMES, "morning", "Утро")}
      {timing.mode !== "morning" && times(EVENING_TIMES, "evening", "Вечер")}

      <div className="section-label">Так будет выглядеть уведомление</div>
      <div className="push-preview rise" key={timing.mode}>
        <span className="push-preview__logo" aria-hidden="true">К</span>
        <span className="push-preview__text">
          <span className="push-preview__meta"><span>Капсула</span><span>{evening ? timing.evening : timing.morning}</span></span>
          <span className="strong-text">{evening ? "Образ на завтра готов" : "Образ на сегодня готов"}</span>
          <span className="muted-text">{evening ? "Загляни — образ на завтра уже собран из твоих вещей" : "Загляни — образ на сегодня уже собран из твоих вещей"}</span>
        </span>
      </div>
      <p className="tiny-text">Сами уведомления включим в следующей версии. Выбор уже работает: «Сегодня» открывается с нужным днём.</p>

      <button type="button" className="btn btn--dark btn--block btn--tall" onClick={async () => { await saveTiming(timing); onToast?.("Сохранено"); onBack(); }}>Сохранить</button>
    </section>
  );
}
