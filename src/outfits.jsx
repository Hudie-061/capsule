import { useCallback, useEffect, useMemo, useState } from "react";
import { ArrowRight, ShoppingBag, Sparkle, ThumbsDown, ThumbsUp, User } from "@phosphor-icons/react";
import { tryOnOutfit } from "./lib/gemini.js";
import { renderOutfit } from "./lib/mannequin.js";
import { addFeedback, getFeedback, getLearned, getModelReference, getProfile, saveLearned } from "./lib/settings.js";
import { findGaps, learnFromComment, planOutfits } from "./lib/stylist.js";

const LIKE_REASONS = ["Общий вайб", "Сочетание цветов", "Подчёркивает фигуру", "Удобно на каждый день"];
const DISLIKE_REASONS = ["Не мой стиль", "Цвета не сочетаются", "Слишком просто", "Скрывает фигуру", "Слишком мешковато", "Не по погоде"];
const PRIORITY = { high: "в первую очередь", medium: "желательно", low: "по желанию" };

function OutfitCard({ outfit, items, index, total, onRated, onTryOn }) {
  const [board, setBoard] = useState(null);
  const [verdict, setVerdict] = useState(null);
  const [reasons, setReasons] = useState(new Set());
  const [comment, setComment] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [tryOn, setTryOn] = useState({ busy: false, url: null, error: "" });
  const pieces = outfit.itemIds.map((id) => items.find((item) => item.id === id)).filter(Boolean);

  useEffect(() => {
    let alive = true;
    setBoard(null); setVerdict(null); setReasons(new Set()); setComment(""); setError(""); setTryOn({ busy: false, url: null, error: "" });
    renderOutfit(pieces, { tuck: outfit.tuck }).then((url) => alive && setBoard(url)).catch((e) => alive && setError(e.message));
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [outfit]);

  const options = verdict === "like"
    ? [...LIKE_REASONS, ...(outfit.tuck ? ["Заправка зашла"] : []), ...pieces.map((p) => `Зацепило: ${p.name}`)]
    : [...DISLIKE_REASONS, ...(outfit.tuck ? ["Заправлять не моё"] : []), ...pieces.map((p) => `Не нравится: ${p.name}`)];

  const toggle = (reason) => setReasons((current) => {
    const next = new Set(current);
    if (next.has(reason)) next.delete(reason); else next.add(reason);
    return next;
  });

  const submit = async () => {
    if (!verdict) { setError("Сначала оцени образ"); return; }
    if (!reasons.size && !comment.trim()) { setError("Выбери вариант или напиши своими словами"); return; }
    setSaving(true);
    try { await onRated({ liked: verdict === "like", reasons: [...reasons], comment: comment.trim(), pieces }); }
    finally { setSaving(false); }
  };

  const runTryOn = async () => {
    setTryOn({ busy: true, url: null, error: "" });
    try {
      const reference = await getModelReference();
      if (!reference) throw new Error("Добавь своё фото в «Настройках», чтобы примерять образы.");
      const garmentBlobs = await Promise.all(pieces.map((p) => fetch(p.image).then((r) => r.blob())));
      const blob = await tryOnOutfit({ person: reference, garments: garmentBlobs, tuck: outfit.tuck });
      setTryOn({ busy: false, url: URL.createObjectURL(blob), error: "" });
      onTryOn?.();
    } catch (e) { setTryOn({ busy: false, url: null, error: e.message }); }
  };

  return (
    <article className="outfit-card">
      <div className="outfit-board">
        {board ? <img src={board} alt={`Образ: ${pieces.map((p) => p.name).join(", ")}`} /> : <div className="outfit-board__loading">Собираю образ…</div>}
        {tryOn.url && <img className="outfit-board__tryon" src={tryOn.url} alt="Примерка на тебе" />}
      </div>
      <div className="outfit-body">
        <p className="outfit-step">Образ {index + 1} из {total}</p>
        <h2 className="outfit-title">{outfit.title}</h2>
        <p className="outfit-why">{outfit.why}</p>
        <ul className="outfit-pieces">
          {pieces.map((p) => <li key={p.id}><span className="outfit-swatch" style={{ background: p.color }} />{p.name}</li>)}
          {outfit.tuck && <li className="outfit-note">Верх заправлен</li>}
        </ul>
        <div className="outfit-votes">
          <button type="button" className={`vote-button${verdict === "like" ? " is-like" : ""}`} onClick={() => { setVerdict("like"); setReasons(new Set()); setError(""); }}><ThumbsUp size={16} /> Нравится</button>
          <button type="button" className={`vote-button${verdict === "dislike" ? " is-dislike" : ""}`} onClick={() => { setVerdict("dislike"); setReasons(new Set()); setError(""); }}><ThumbsDown size={16} /> Не нравится</button>
        </div>
        {verdict && (
          <div className="outfit-reasons">
            <p>{verdict === "like" ? "Что зацепило?" : "Почему нет?"} <span>можно несколько</span></p>
            <div className="chip-row">
              {options.map((o) => <button type="button" key={o} className={`chip${reasons.has(o) ? " is-on" : ""}`} onClick={() => { toggle(o); setError(""); }}>{o}</button>)}
            </div>
            <div className="import-field outfit-comment">
              <label htmlFor="outfit-comment">Своими словами <span>стилист запомнит</span></label>
              <textarea id="outfit-comment" rows="2" value={comment} onChange={(e) => { setComment(e.target.value); setError(""); }} placeholder="Например: не люблю бэгги-джинсы, хочу с узкой талией" />
            </div>
          </div>
        )}
        {error && <p className="form-error">{error}</p>}
        <div className="outfit-actions">
          <button type="button" className="secondary-button" disabled={tryOn.busy} onClick={runTryOn}><User size={15} /> {tryOn.busy ? "Примеряю…" : "Примерить на мне"}</button>
          <button type="button" className="primary-button" disabled={saving} onClick={submit}>{saving ? "Запоминаю…" : index + 1 < total ? "Дальше" : "Готово"} <ArrowRight size={15} /></button>
        </div>
        {tryOn.error && <p className="form-error">{tryOn.error}</p>}
        <p className="outfit-hint">Примерка генерирует фото через Gemini и тратит лимит. Манекен бесплатный.</p>
      </div>
    </article>
  );
}

export function OutfitsView({ items, onOpenSettings }) {
  const [profile, setProfile] = useState(null);
  const [feedback, setFeedback] = useState([]);
  const [outfits, setOutfits] = useState([]);
  const [index, setIndex] = useState(0);
  const [occasion, setOccasion] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [gaps, setGaps] = useState(null);
  const [gapsBusy, setGapsBusy] = useState(false);
  const [remembered, setRemembered] = useState("");

  useEffect(() => { getProfile().then(setProfile); getFeedback().then(setFeedback); }, []);

  const counts = useMemo(() => ({
    tops: items.filter((i) => i.part === "upperbody").length,
    bottoms: items.filter((i) => i.part === "lowerbody").length,
  }), [items]);
  const enough = counts.tops >= 1 && counts.bottoms >= 1;
  const profileEmpty = profile && !Object.values(profile).some((v) => String(v || "").trim());
  const liked = feedback.filter((f) => f.liked).length;

  const generate = useCallback(async () => {
    setBusy(true); setError(""); setGaps(null);
    try {
      const planned = await planOutfits({ items, profile: await getProfile(), feedback: await getFeedback(), learned: await getLearned(), occasion, count: 5 });
      if (!planned.length) throw new Error("Не получилось собрать образы. Добавь ещё вещей или попробуй снова.");
      setOutfits(planned); setIndex(0);
    } catch (e) { setError(e.message); }
    finally { setBusy(false); }
  }, [items, occasion]);

  const rated = async ({ liked: isLiked, reasons, comment, pieces }) => {
    const outfit = outfits[index];
    const next = await addFeedback({ title: outfit.title, itemIds: outfit.itemIds, tuck: outfit.tuck, liked: isLiked, reasons, comment });
    setFeedback([...next]);
    setRemembered("");
    if (comment) {
      try {
        const learned = await learnFromComment({ comment, outfitItems: pieces, liked: isLiked, learned: await getLearned() });
        await saveLearned(learned.rules);
        if (learned.remembered) setRemembered(learned.remembered);
        else if (learned.ignored) setRemembered("");
      } catch (e) { setError(`Оценка сохранена, но запомнить комментарий не вышло: ${e.message}`); }
    }
    if (index + 1 < outfits.length) setIndex(index + 1);
    else { setOutfits([]); setIndex(0); }
  };

  const loadGaps = async () => {
    setGapsBusy(true); setError("");
    try { setGaps(await findGaps({ items, profile: await getProfile(), feedback: await getFeedback(), learned: await getLearned() })); }
    catch (e) { setError(e.message); }
    finally { setGapsBusy(false); }
  };

  if (!enough) {
    return (
      <section className="outfits-empty">
        <h2>Пока мало вещей</h2>
        <p>Чтобы собирать образы, нужен хотя бы один верх и один низ. Сейчас: верх — {counts.tops}, низ — {counts.bottoms}. Добавь фото во вкладке «Гардероб».</p>
      </section>
    );
  }

  return (
    <section className="outfits-view">
      {profileEmpty && <p className="outfits-banner">Заполни «Мой стиль» в <button type="button" className="link-button" onClick={onOpenSettings}>настройках</button> — образы станут точнее.</p>}
      {!outfits.length && (
        <div className="outfits-start">
          <div className="import-field">
            <label htmlFor="occasion">Повод или погода <span>необязательно</span></label>
            <input id="occasion" value={occasion} onChange={(e) => setOccasion(e.target.value)} placeholder="Учёба, +8 и дождь" />
          </div>
          <div className="outfits-start__actions">
            <button type="button" className="primary-button" disabled={busy} onClick={generate}><Sparkle size={15} /> {busy ? "Подбираю…" : "Собрать 5 образов"}</button>
            <button type="button" className="secondary-button" disabled={gapsBusy} onClick={loadGaps}><ShoppingBag size={15} /> {gapsBusy ? "Анализирую…" : "Что докупить"}</button>
          </div>
          <p className="outfit-hint">Оценено образов: {feedback.length}, понравилось: {liked}. Чем больше оценок, тем точнее подбор.</p>
        </div>
      )}
      {error && <p className="form-error">{error}</p>}
      {remembered && <p className="outfits-remembered">Запомнил: {remembered}</p>}
      {!!outfits.length && <OutfitCard outfit={outfits[index]} items={items} index={index} total={outfits.length} onRated={rated} />}
      {gaps && (
        <div className="gaps">
          <h2>Что докупить</h2>
          {gaps.summary && <p className="outfit-why">{gaps.summary}</p>}
          <ol>
            {gaps.items.map((gap) => (
              <li key={gap.item}>
                <strong>{gap.item}</strong> <span className={`priority priority--${gap.priority}`}>{PRIORITY[gap.priority] || gap.priority}</span>
                <p>{gap.why}</p>
                {!!gap.pairsWith.length && <p className="gaps-pairs">Сочетается с: {gap.pairsWith.map((id) => items.find((i) => i.id === id)?.name).filter(Boolean).join(", ")}</p>}
              </li>
            ))}
          </ol>
        </div>
      )}
    </section>
  );
}
