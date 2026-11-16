// «Сегодня» — outfit of the day (design/V2-Today.dc.html).
// Front of the card: the pieces; tap one to swap it from your own wardrobe.
// Back of the card: the mannequin with callouts, or an AI try-on on your photo.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { clearTryOns, defaultMode, formatDay, getDayPlan, getTiming, getTryOn, saveDayPlan, saveTryOn, targetDate } from "./lib/daily.js";
import { SetupError, tryOnOutfit } from "./lib/gemini.js";
import { normalizeImage } from "./lib/image.js";
import { renderOutfit } from "./lib/mannequin.js";
import { addFeedback, amendFeedback, getFeedback, getLearned, getModelReference, getProfile, saveLearned, setModelReference } from "./lib/settings.js";
import { learnFromComment, planOutfits } from "./lib/stylist.js";
import { GarmentIcon, Icon, Segmented, Sheet, isDressItem } from "./ui.jsx";

const LIKE_REASONS = ["Общий вайб", "Сочетание цветов", "Подчёркивает фигуру", "Удобно на каждый день"];
const DISLIKE_REASONS = ["Не мой стиль", "Цвета не сочетаются", "Слишком просто", "Не по погоде", "Слишком мешковато", "Скрывает фигуру"];
const OCCASION_CHIPS = ["Учёба", "Работа", "Спорт", "Свидание", "Дождь", "Холодно", "Тепло"];
const PART_ORDER = { wholebody_up: 0, upperbody: 1, lowerbody: 2, shoes: 3, accessories_up: 4 };
const SWAP_TITLE = { wholebody_up: "Заменить верхнюю одежду", upperbody: "Заменить верх", lowerbody: "Заменить низ", shoes: "Заменить обувь", accessories_up: "Заменить аксессуар" };

function isWearable(pieces) {
  const parts = pieces.map((p) => p.part);
  return pieces.some(isDressItem) || (parts.includes("lowerbody") && (parts.includes("upperbody") || parts.includes("wholebody_up")));
}

// Drop items that were deleted from the wardrobe since the plan was made.
function cleanPlan(plan, byId) {
  if (!plan || !Array.isArray(plan.outfits)) return null;
  const outfits = plan.outfits
    .map((o) => ({ ...o, itemIds: (o.itemIds || []).filter((id) => byId.has(id)) }))
    .filter((o) => isWearable(o.itemIds.map((id) => byId.get(id))));
  if (!outfits.length) return null;
  return { ...plan, outfits, index: Math.min(Math.max(0, plan.index || 0), outfits.length - 1) };
}

// ---- mannequin with callouts --------------------------------------------------------------
// Coordinates of the 600×1000 canvas from lib/mannequin.js, drawn inside a 320×300 box.
const BOX = { w: 320, h: 300, fx: 76, fy: 10, scale: 0.28, label: 99 }; // label = 31% of the box, as in v2.css
const ANCHORS = { outer: [165, 300, "left"], top: [345, 250, "right"], dress: [335, 430, "right"], bottom: [335, 650, "right"], shoes: [245, 915, "left"], accessory: [520, 320, "right"] };

function callouts(pieces) {
  const seen = new Set();
  const list = [];
  for (const piece of pieces) {
    const slot = isDressItem(piece) ? "dress" : { wholebody_up: "outer", upperbody: "top", lowerbody: "bottom", shoes: "shoes", accessories_up: "accessory" }[piece.part];
    if (!slot || seen.has(slot)) continue; // the canvas draws only the first piece of each kind
    seen.add(slot);
    const [ax, ay, side] = ANCHORS[slot];
    list.push({ piece, side, x: BOX.fx + ax * BOX.scale, y: BOX.fy + ay * BOX.scale });
  }
  for (const side of ["left", "right"]) {
    let last = -Infinity;
    list.filter((c) => c.side === side).sort((a, b) => a.y - b.y).forEach((c) => {
      c.ly = Math.min(BOX.h - 20, Math.max(20, c.y, last + 40));
      last = c.ly;
    });
  }
  return list;
}

function Mannequin({ board, pieces, open, onToggle, onPick }) {
  const marks = useMemo(() => callouts(pieces), [pieces]);
  const pct = (value, total) => `${(value / total) * 100}%`;
  return (
    <div className="mannequin">
      <button type="button" className="mannequin__figure" style={{ left: pct(BOX.fx, BOX.w), top: pct(BOX.fy, BOX.h), width: pct(600 * BOX.scale, BOX.w), height: pct(1000 * BOX.scale, BOX.h) }} onClick={onToggle} aria-expanded={open} aria-label={open ? "Скрыть подписи вещей" : "Показать подписи вещей"}>
        {board ? <img key={board} className="fade" src={board} alt={`Манекен: ${pieces.map((p) => p.name).join(", ")}`} /> : <span className="shimmer mannequin__placeholder" />}
      </button>
      {open && (
        <>
          <svg className="mannequin__lines fade" viewBox={`0 0 ${BOX.w} ${BOX.h}`} aria-hidden="true">
            {marks.map((c) => (
              <g key={c.piece.id}>
                <path d={`M${c.side === "left" ? 4 + BOX.label : BOX.w - 4 - BOX.label} ${c.ly} L${c.x} ${c.y}`} stroke="#1E1B18" strokeWidth="1.5" fill="none" />
                <circle cx={c.x} cy={c.y} r="4" fill="#1E1B18" />
              </g>
            ))}
          </svg>
          {marks.map((c, i) => (
            <button
              key={c.piece.id}
              type="button"
              className="callout pop"
              style={{ [c.side]: pct(4, BOX.w), top: pct(c.ly - 17, BOX.h), animationDelay: `${i * 0.06}s` }}
              onClick={() => onPick(c.piece.id)}
              aria-label={`Заменить: ${c.piece.name}`}
            >
              <span className="callout__dot" style={{ background: c.piece.color || "#8a7f72" }} aria-hidden="true" />
              <span>{c.piece.name}</span>
            </button>
          ))}
        </>
      )}
    </div>
  );
}

// ---- screen ---------------------------------------------------------------------------------
export function TodayView({ items, loaded, setupReady, onNavigate, onAdd, onOpenAccess, onToast }) {
  const [mode, setMode] = useState(null);
  const [plan, setPlan] = useState(null);
  const [status, setStatus] = useState("idle");
  const [error, setError] = useState("");
  const [swapId, setSwapId] = useState(null);
  const [flipped, setFlipped] = useState(false);
  const [view, setView] = useState("mannequin");
  const [calloutsOpen, setCalloutsOpen] = useState(false);
  const [board, setBoard] = useState(null);
  const [tryon, setTryon] = useState({ status: "idle", url: null, error: "" });
  const [hasReference, setHasReference] = useState(false);
  const [dislikeOpen, setDislikeOpen] = useState(false);
  const [comment, setComment] = useState("");
  const [occasionOpen, setOccasionOpen] = useState(false);
  const [occasionDraft, setOccasionDraft] = useState("");
  const [likeAt, setLikeAt] = useState(null);
  const [likeReasons, setLikeReasons] = useState(new Set());
  const [zoom, setZoom] = useState(null);
  const photoRef = useRef(null);
  const ticketRef = useRef(0); // ignores a slow plan request after the day was switched

  const byId = useMemo(() => new Map(items.map((item) => [item.id, item])), [items]);
  const itemsRef = useRef(items);
  itemsRef.current = items;
  const date = useMemo(() => (mode ? targetDate(mode) : null), [mode]);
  const evening = mode === "evening";
  const counts = useMemo(() => ({ tops: items.filter((i) => i.part === "upperbody" || (i.part === "wholebody_up" && !isDressItem(i))).length, bottoms: items.filter((i) => i.part === "lowerbody").length, dresses: items.filter(isDressItem).length }), [items]);
  const enough = counts.dresses > 0 || (counts.tops > 0 && counts.bottoms > 0);

  const outfit = plan?.outfits?.[plan.index] || null;
  const pieces = useMemo(() => (outfit ? outfit.itemIds.map((id) => byId.get(id)).filter(Boolean).sort((a, b) => (PART_ORDER[a.part] ?? 9) - (PART_ORDER[b.part] ?? 9)) : []), [outfit, byId]);
  const piecesKey = pieces.map((p) => p.id).join("+");

  useEffect(() => { getTiming().then((t) => setMode(defaultMode(t))); }, []);
  useEffect(() => {
    getModelReference().then((blob) => setHasReference(Boolean(blob)));
    const onSettings = () => getModelReference().then((blob) => setHasReference(Boolean(blob)));
    window.addEventListener("capsule:settings", onSettings);
    return () => window.removeEventListener("capsule:settings", onSettings);
  }, []);

  const store = useCallback(async (next) => {
    setPlan(next);
    if (date) await saveDayPlan(date, next);
  }, [date]);

  const generate = useCallback(async (occasion = plan?.occasion || "") => {
    if (!date) return;
    const ticket = ++ticketRef.current;
    setStatus("loading"); setError(""); setFlipped(false); setCalloutsOpen(false);
    try {
      const when = `${evening ? "Образ на завтра" : "Образ на сегодня"}, ${formatDay(date).toLowerCase()}`;
      const outfits = await planOutfits({ items: itemsRef.current, profile: await getProfile(), feedback: await getFeedback(), learned: await getLearned(), occasion: occasion ? `${when}. ${occasion}` : when, count: 5 });
      if (!outfits.length) throw new Error("Не получилось собрать образ. Добавь ещё вещей или попробуй снова.");
      const next = { outfits, index: 0, chosen: null, occasion };
      await saveDayPlan(date, next);
      if (ticket !== ticketRef.current) return;
      setPlan(next);
      setLikeAt(null); setLikeReasons(new Set());
      setStatus("idle");
    } catch (e) {
      if (ticket !== ticketRef.current) return;
      setError(e.message);
      setStatus(e instanceof SetupError ? "setup" : "error");
    }
  }, [date, evening, plan?.occasion]);

  // Load the plan for the chosen day, or make one.
  useEffect(() => {
    if (!date || !loaded) return undefined;
    let alive = true;
    ticketRef.current += 1;
    setPlan(null); setFlipped(false); setCalloutsOpen(false); setLikeAt(null); setLikeReasons(new Set());
    getDayPlan(date).then((saved) => {
      if (!alive) return;
      const clean = cleanPlan(saved, new Map(itemsRef.current.map((i) => [i.id, i])));
      if (clean) { setPlan(clean); setStatus("idle"); }
      else if (enough && setupReady) generate(saved?.occasion || "");
      else setStatus("idle");
    });
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [date, loaded, enough, setupReady]);

  // Mannequin board: drawn locally from the cutouts, free and instant.
  useEffect(() => {
    if (!flipped || !pieces.length) return undefined;
    let alive = true;
    renderOutfit(pieces, { tuck: outfit?.tuck }).then((url) => alive && setBoard(url)).catch(() => alive && setBoard(null));
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [flipped, piecesKey, outfit?.tuck]);

  // Cached try-on for this exact set of pieces.
  useEffect(() => {
    let url = null;
    let alive = true;
    setTryon({ status: "idle", url: null, error: "" });
    if (pieces.length) {
      getTryOn(pieces.map((p) => p.id)).then((blob) => {
        if (!alive || !blob) return;
        url = URL.createObjectURL(blob);
        setTryon({ status: "done", url, error: "" });
      });
    }
    return () => { alive = false; if (url) URL.revokeObjectURL(url); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [piecesKey]);

  const nextOutfit = async () => {
    if (!plan) return generate();
    if (plan.index + 1 < plan.outfits.length) {
      await store({ ...plan, index: plan.index + 1, chosen: null });
      setFlipped(false); setCalloutsOpen(false); setLikeAt(null); setLikeReasons(new Set());
    } else {
      await generate();
    }
  };

  const dislike = async (reason, text = "") => {
    setDislikeOpen(false);
    const words = text.trim();
    setComment("");
    if (outfit && (reason || words)) {
      await addFeedback({ title: outfit.title, itemIds: outfit.itemIds, tuck: outfit.tuck, liked: false, reasons: reason ? [reason] : [], comment: words });
      if (words) {
        learnFromComment({ comment: words, outfitItems: pieces, liked: false, learned: await getLearned() })
          .then(async (learned) => { await saveLearned(learned.rules); if (learned.remembered) onToast?.(`Запомнил: ${learned.remembered}`); })
          .catch((e) => onToast?.(`Оценка сохранена, но комментарий не запомнился: ${e.message}`));
      }
    }
    await nextOutfit();
  };

  const wear = async () => {
    if (!outfit || plan.chosen) return;
    const list = await addFeedback({ title: outfit.title, itemIds: outfit.itemIds, tuck: outfit.tuck, liked: true, reasons: [], comment: "" });
    setLikeAt(list[list.length - 1]?.at || null);
    setLikeReasons(new Set());
    await store({ ...plan, chosen: { at: new Date().toISOString() } });
    onToast?.(evening ? "Отлично, образ на завтра готов" : "Отлично, хорошего дня");
  };

  const toggleLikeReason = async (reason) => {
    const next = new Set(likeReasons);
    if (next.has(reason)) next.delete(reason); else next.add(reason);
    setLikeReasons(next);
    if (likeAt) await amendFeedback(likeAt, { reasons: [...next] });
  };

  const swapTo = async (itemId) => {
    const current = swapId;
    setSwapId(null);
    if (!plan || !outfit || !current || current === itemId) return;
    const outfits = plan.outfits.map((o, i) => (i === plan.index ? { ...o, itemIds: o.itemIds.map((id) => (id === current ? itemId : id)), edited: true } : o));
    await store({ ...plan, outfits, chosen: null });
    setLikeAt(null);
  };

  const runTryOn = async (file) => {
    setTryon({ status: "loading", url: null, error: "" });
    try {
      let reference;
      if (file) {
        reference = await normalizeImage(file, 1536);
        await setModelReference(reference);
        await clearTryOns();
        setHasReference(true);
      } else {
        reference = await getModelReference();
      }
      if (!reference) throw new Error("Сначала выбери своё фото в полный рост.");
      const worn = pieces.slice(0, 5);
      const garments = await Promise.all(worn.map((p) => fetch(p.image).then((r) => r.blob())));
      const blob = await tryOnOutfit({ person: reference, garments, items: worn, tuck: outfit?.tuck });
      await saveTryOn(pieces.map((p) => p.id), blob);
      setTryon({ status: "done", url: URL.createObjectURL(blob), error: "" });
    } catch (e) {
      setTryon({ status: "idle", url: null, error: e.message });
    }
  };

  const swapping = swapId ? byId.get(swapId) : null;
  const alternatives = useMemo(() => {
    if (!swapping) return [];
    const same = items.filter((i) => i.part === swapping.part && isDressItem(i) === isDressItem(swapping));
    return [swapping, ...same.filter((i) => i.id !== swapping.id)];
  }, [swapping, items]);

  const tags = [
    ...(plan?.occasion ? plan.occasion.split(",").map((s) => s.trim()).filter(Boolean).slice(0, 2) : [formatDay(date || new Date()).split(",")[0]]),
    ...(outfit?.tuck ? ["Верх заправлен"] : []),
  ];

  if (!mode) return null;

  const header = (
    <>
      <div className="today-top rise">
        <span className="muted-text">{evening ? `Завтра · ${formatDay(date).toLowerCase()}` : formatDay(date)}</span>
        <button type="button" className="pill-chip" onClick={() => { setOccasionDraft(plan?.occasion || ""); setOccasionOpen(true); }}>
          <Icon name={plan?.occasion ? "check" : "plus"} size={16} width={2} />
          <span>{plan?.occasion || "Повод и погода"}</span>
        </button>
      </div>
      <div className="today-title-row">
        <h1 className="screen-title">{evening ? "На завтра" : "На сегодня"}</h1>
        <Segmented
          label="Когда подбирать образ"
          className="segmented--icons"
          value={mode}
          onChange={setMode}
          options={[{ id: "morning", icon: "sun", aria: "Образ утром, на сегодня" }, { id: "evening", icon: "moon", aria: "Образ с вечера, на завтра" }]}
        />
      </div>
    </>
  );

  let body;
  if (!loaded) {
    body = <div className="look-card look-card--empty"><span className="shimmer look-skeleton" /></div>;
  } else if ((!setupReady && !outfit) || status === "setup") {
    body = (
      <div className="look-card look-card--empty rise">
        <span className="empty-icon"><Icon name="key" size={26} /></span>
        <div className="card-title">Нужен код доступа</div>
        <p className="muted-text">{error || "Стилисту нужен код от владельца приложения. Его вводят один раз."}</p>
        <button type="button" className="btn btn--dark" onClick={onOpenAccess}>Ввести код</button>
      </div>
    );
  } else if (!enough && !outfit) {
    body = (
      <div className="look-card look-card--empty rise">
        <span className="empty-icon"><Icon name="hanger" size={26} /></span>
        <div className="card-title">Добавь пару вещей</div>
        <p className="muted-text">Для первого образа нужен хотя бы один верх и один низ (сейчас: верх — {counts.tops}, низ — {counts.bottoms}). Можно сфотографировать сразу несколько вещей на одном фото.</p>
        <button type="button" className="btn btn--dark" onClick={onAdd}><Icon name="plus" size={18} width={2} /> Добавить вещи</button>
      </div>
    );
  } else if (status === "loading" || (!outfit && status === "idle")) {
    body = (
      <div className="look-card look-card--loading" aria-busy="true">
        <div className="look-card__head"><span className="shimmer skeleton-line" /></div>
        <div className="look-tiles">{[0, 1, 2, 3].map((i) => <span key={i} className="shimmer look-tile" />)}</div>
        <p className="muted-text center-text">Подбираю образ…</p>
      </div>
    );
  } else if (status === "error" || !outfit) {
    body = (
      <div className="look-card look-card--empty rise">
        <div className="card-title">Не получилось</div>
        <p className="muted-text">{error || "Попробуй ещё раз."}</p>
        <button type="button" className="btn btn--dark" onClick={() => generate()}>Попробовать снова</button>
      </div>
    );
  } else {
    const me = view === "me";
    body = (
      <div className="flip">
        <div className={`flip__inner${flipped ? " is-flipped" : ""}`}>
          <section className="look-card flip__face" aria-hidden={flipped} inert={flipped}>
            <div className="look-card__head">
              <div className="look-card__heading">
                <div className="look-card__title">{outfit.title}</div>
                <div className="tag-row">{tags.map((t) => <span className="tag" key={t}>{t}</span>)}</div>
              </div>
              <button type="button" className="pill-button pill-button--dark" onClick={() => { setFlipped(true); setSwapId(null); }}>
                <Icon name="person" size={20} width={1.9} /> На человеке
              </button>
            </div>
            <div className="look-tiles" data-count={pieces.length}>
              {pieces.map((p, i) => (
                <button type="button" key={p.id} className="look-tile rise" style={{ animationDelay: `${i * 0.05}s` }} onClick={() => setSwapId(p.id)} aria-label={`Заменить: ${p.name}`}>
                  {p.thumbnail || p.image ? <img src={p.thumbnail || p.image} alt="" /> : <GarmentIcon part={p.part} color={p.color} size={92} dress={isDressItem(p)} />}
                  <span className="look-tile__name">{p.name}</span>
                  <span className="look-tile__swap" aria-hidden="true"><Icon name="swap" size={16} width={2} /></span>
                </button>
              ))}
            </div>
            {outfit.why && <p className="look-card__why">{outfit.why}</p>}
          </section>

          <section className="look-card flip__face flip__back" aria-hidden={!flipped} inert={!flipped}>
            <div className="look-card__head">
              <Segmented label="Как показать образ" className="segmented--wide" value={view} onChange={setView} options={[{ id: "mannequin", label: "Манекен" }, { id: "me", label: "На мне" }]} />
              <button type="button" className="pill-button" onClick={() => setFlipped(false)}><Icon name="grid" size={18} width={2} /> Вещи</button>
            </div>
            <div className="stage">
              {!me && (
                <>
                  <Mannequin board={board} pieces={pieces} open={calloutsOpen} onToggle={() => setCalloutsOpen((v) => !v)} onPick={setSwapId} />
                  <span className="stage__caption">{calloutsOpen ? "Нажми на вещь, чтобы заменить" : "Нажми на манекен — покажу вещи"}</span>
                </>
              )}
              {me && tryon.status === "done" && (
                <>
                  <button type="button" className="stage__photo-button" onClick={() => setZoom(tryon.url)} aria-label="Открыть примерку на весь экран">
                    <img className="stage__photo fade" src={tryon.url} alt="ИИ-примерка образа на тебе" />
                  </button>
                  <button type="button" className="stage__caption stage__caption--button" onClick={() => runTryOn()}>Примерить заново</button>
                </>
              )}
              {me && tryon.status === "loading" && (
                <div className="stage__loading"><span className="shimmer stage__shimmer" /><span className="strong-text">Примеряю образ…</span></div>
              )}
              {me && tryon.status === "idle" && (
                <div className="upload-box rise">
                  <span className="upload-box__icon"><Icon name="camera" size={28} /></span>
                  <span className="card-title">Примерь на себе</span>
                  <span className="muted-text">{hasReference ? "Твоё фото уже есть. Одна примерка — одна картинка из дневного лимита." : "Загрузи одно фото в полный рост — ИИ наденет на тебя этот образ"}</span>
                  {!hasReference && <span className="tiny-text">Лучше всего: стоя прямо, лицом к камере, руки вдоль тела, хороший свет, простая одежда.</span>}
                  {hasReference ? (
                    <div className="row-gap">
                      <button type="button" className="btn btn--dark" onClick={() => runTryOn()}>Примерить</button>
                      <button type="button" className="btn btn--ghost" onClick={() => photoRef.current?.click()}>Другое фото</button>
                    </div>
                  ) : <button type="button" className="btn btn--dark" onClick={() => photoRef.current?.click()}>Выбрать фото</button>}
                  {tryon.error && <span className="error-text">{tryon.error}</span>}
                  <span className="tiny-text">Фото хранится только у тебя</span>
                </div>
              )}
              <input ref={photoRef} type="file" accept="image/*" hidden onChange={(e) => { const file = e.target.files?.[0]; e.target.value = ""; if (file) runTryOn(file); }} />
            </div>
          </section>
        </div>
      </div>
    );
  }

  const ready = Boolean(outfit) && status === "idle";
  return (
    <section className="screen today">
      {header}
      {body}
      {ready && (
        <>
          <div className="action-row">
            <button type="button" className="btn btn--outline btn--grow1" onClick={() => setDislikeOpen(true)}>Другой образ</button>
            <button type="button" className={`btn btn--dark btn--grow2 btn--lift${plan.chosen ? " is-done" : ""}`} onClick={wear} aria-pressed={Boolean(plan.chosen)}>
              {plan.chosen ? <><Icon name="check" size={18} width={2.2} /> {evening ? "Надену завтра" : "Надену сегодня"}</> : evening ? "Готово, надену завтра" : "Надену сегодня"}
            </button>
          </div>
          {plan.chosen && likeAt ? (
            <div className="like-reasons rise">
              <span className="muted-text">Что зацепило? <span className="tiny-text">необязательно</span></span>
              <div className="chip-row">{LIKE_REASONS.map((r) => <button type="button" key={r} className={`chip${likeReasons.has(r) ? " is-on" : ""}`} onClick={() => toggleLikeReason(r)}>{r}</button>)}</div>
            </div>
          ) : <p className="hint-text">Нажми на вещь, чтобы заменить её</p>}
        </>
      )}

      {zoom && (
        <div className="photo-viewer fade" role="dialog" aria-modal="true" aria-label="Примерка на весь экран">
          <img src={zoom} alt="ИИ-примерка образа на тебе" />
          <button type="button" className="btn btn--light btn--small" onClick={() => setZoom(null)}>Закрыть</button>
        </div>
      )}

      <Sheet open={Boolean(swapping)} onClose={() => setSwapId(null)} title={swapping ? (isDressItem(swapping) ? "Заменить платье" : SWAP_TITLE[swapping.part]) : ""} subtitle="Из твоего гардероба · той же категории">
        <div className="alt-grid">
          {alternatives.map((alt, i) => {
            const current = alt.id === swapping?.id;
            return (
              <button type="button" key={alt.id} className={`alt-card rise${current ? " is-current" : ""}`} style={{ animationDelay: `${i * 0.04}s` }} aria-pressed={current} onClick={() => swapTo(alt.id)}>
                <span className="alt-card__image">
                  {alt.thumbnail || alt.image ? <img src={alt.thumbnail || alt.image} alt="" /> : <GarmentIcon part={alt.part} color={alt.color} size={72} />}
                  {current && <span className="badge-dark">Сейчас</span>}
                </span>
                <span className="alt-card__text">
                  <span className="strong-text">{alt.name}</span>
                  <span className="tiny-text">{[alt.brand, ...(alt.tags || []).slice(0, 2)].filter(Boolean).join(" · ") || " "}</span>
                </span>
              </button>
            );
          })}
        </div>
        {alternatives.length < 2 && <p className="muted-text">Других вещей этой категории пока нет. Добавь их кнопкой «＋» или найди новую.</p>}
        <button type="button" className="dark-link" onClick={() => { const piece = swapping; setSwapId(null); onNavigate("shopping", { focus: { label: `Похожее на: ${piece.name}`, part: piece.part, color: piece.color, query: piece.name } }); }}>
          <span className="dark-link__icon"><Icon name="bag" size={20} width={1.9} /></span>
          <span className="dark-link__text"><span>Нет подходящих? Найдём дешевле</span><small>Новое и б/у — в магазинах Бельгии</small></span>
          <Icon name="chevron" size={20} width={2} />
        </button>
      </Sheet>

      <Sheet open={dislikeOpen} onClose={() => setDislikeOpen(false)} title="Почему не этот?" subtitle="Один тап — и стилист учтёт это в следующих образах">
        <div className="chip-row">
          {[...DISLIKE_REASONS, ...pieces.map((p) => `Не нравится: ${p.name}`)].map((r) => <button type="button" key={r} className="chip" onClick={() => dislike(r)}>{r}</button>)}
        </div>
        <label className="field-v2">
          <span>Своими словами <small>стилист запомнит</small></span>
          <textarea rows="2" value={comment} onChange={(e) => setComment(e.target.value)} placeholder="Например: не люблю бэгги-джинсы, хочу с узкой талией" />
        </label>
        <div className="action-row">
          <button type="button" className="btn btn--outline btn--grow1" onClick={() => dislike(null)}>Просто другой</button>
          <button type="button" className="btn btn--dark btn--grow1" disabled={!comment.trim()} onClick={() => dislike(null, comment)}>Отправить</button>
        </div>
      </Sheet>

      <Sheet open={occasionOpen} onClose={() => setOccasionOpen(false)} title="Повод и погода" subtitle="Стилист учтёт это и подберёт образ заново">
        <label className="field-v2">
          <span>Куда идёшь, какая погода</span>
          <input value={occasionDraft} onChange={(e) => setOccasionDraft(e.target.value)} placeholder="Учёба, +8 и дождь" maxLength={140} />
        </label>
        <div className="chip-row">
          {OCCASION_CHIPS.map((c) => <button type="button" key={c} className="chip" onClick={() => setOccasionDraft((v) => (v.trim() ? `${v.trim().replace(/,$/, "")}, ${c.toLowerCase()}` : c))}>{c}</button>)}
        </div>
        <div className="action-row">
          {plan?.occasion && <button type="button" className="btn btn--outline btn--grow1" onClick={() => { setOccasionOpen(false); generate(""); }}>Сбросить</button>}
          <button type="button" className="btn btn--dark btn--grow2" disabled={!enough || !setupReady} onClick={() => { setOccasionOpen(false); generate(occasionDraft.trim()); }}>Подобрать заново</button>
        </div>
      </Sheet>
    </section>
  );
}
