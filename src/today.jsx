// «Сегодня» — outfit of the day (design/V2-Today.dc.html).
// Front of the card: the pieces; tap one to swap it from your own wardrobe.
// Back of the card: the mannequin with callouts, or an AI try-on on your photo.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { flushSync } from "react-dom";
import { clearTryOns, defaultMode, formatDay, getDayPlan, getTiming, getTryOn, saveDayPlan, saveTryOn, targetDate } from "./lib/daily.js";
import { SetupError, tryOnOutfit } from "./lib/gemini.js";
import { normalizeImage } from "./lib/image.js";
import { outfitAnchors, renderOutfit } from "./lib/mannequin.js";
import { addFeedback, amendFeedback, getFeedback, getLearned, getModelReference, getProfile, getSettings, saveLearned, setModelReference } from "./lib/settings.js";
import { getActivePalette } from "./lib/palette-mode.js";
import { dressForWeather, readWeather } from "./lib/weather.js";
import { learnFromComment, planOutfits } from "./lib/stylist.js";
import { kindOf } from "./lib/kinds.js";
import { contrastLevel, paletteLab } from "./lib/colors.js";
import { Crossfade, GarmentIcon, HintChips, Icon, Segmented, Sheet, SwapIcon, WaitLine, isDressItem } from "./ui.jsx";

// What the stylist does while the outfits are being made (shown step by step while waiting).
const PLAN_STEPS = ["Смотрю твой гардероб…", "Подбираю сочетания цветов…", "Проверяю контраст и пропорции…", "Выбираю лучшие образы…"];

const LIKE_REASONS = ["Общий вайб", "Сочетание цветов", "Подчёркивает фигуру", "Удобно на каждый день"];
// What the stylist takes from each tap, said back to the user right away.
const LIKE_LEARNED = {
  "Общий вайб": "больше образов в таком настроении",
  "Сочетание цветов": "чаще такие сочетания цветов",
  "Подчёркивает фигуру": "чаще силуэты, которые подчёркивают фигуру",
  "Удобно на каждый день": "больше удобных образов на каждый день",
};
const dislikeLearned = (reason) => (reason.startsWith("Не нравится: ") ? `реже предлагать «${reason.slice(13)}»` : `учту «${reason.toLowerCase()}» в следующих образах`);
const DISLIKE_REASONS = ["Не мой стиль", "Цвета не сочетаются", "Слишком просто", "Не по погоде", "Слишком мешковато", "Скрывает фигуру"];
const OCCASION_CHIPS = ["Учёба", "Работа", "Спорт", "Свидание", "Дождь", "Холодно", "Тепло"];
const PART_ORDER = { wholebody_up: 0, upperbody: 1, lowerbody: 2, shoes: 3, accessories_up: 4 };
const SWAP_TITLE = { wholebody_up: "Заменить верхнюю одежду", upperbody: "Заменить верх", lowerbody: "Заменить низ", shoes: "Заменить обувь", accessories_up: "Заменить аксессуар" };

// Outerwear (not a dress), and the layers people take off indoors: a coat over a top, scarves, headwear.
const isOuter = (p) => p.part === "wholebody_up" && !isDressItem(p);
// A blazer stays on indoors.
const isOutdoorLayer = (p, pieces) => (isOuter(p) && kindOf(p) !== "blazer" && pieces.some((q) => q.part === "upperbody")) || (p.part === "accessories_up" && ["scarf", "cap", "hat", "beanie"].includes(kindOf(p)));
// A piece can be left out when what remains is still a full outfit.
const canRemove = (p, pieces) => (isOuter(p) || p.part === "accessories_up") && isWearable(pieces.filter((q) => q.id !== p.id));

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
const BOX = { w: 320, h: 340, fx: 64, fy: 8, scale: 0.32, label: 99 }; // label = 31% of the box, as in v2.css
// Callout labels sit at the sides; each line points at the item's own place on the figure.
function callouts(pieces, body) {
  const byId = new Map(pieces.map((p) => [p.id, p]));
  const list = outfitAnchors(pieces, body)
    .map((a) => ({ piece: byId.get(a.id), side: a.side, x: BOX.fx + a.x * BOX.scale, y: BOX.fy + a.y * BOX.scale }))
    .filter((c) => c.piece);
  for (const side of ["left", "right"]) {
    let last = -Infinity;
    list.filter((c) => c.side === side).sort((a, b) => a.y - b.y).forEach((c) => {
      c.ly = Math.min(BOX.h - 20, Math.max(20, c.y, last + 38));
      last = c.ly;
    });
  }
  return list;
}

function Mannequin({ board, pieces, body, open, onToggle, onPick }) {
  const marks = useMemo(() => callouts(pieces, body), [pieces, body]);
  const pct = (value, total) => `${(value / total) * 100}%`;
  return (
    <div className="mannequin">
      <button type="button" className="mannequin__figure" style={{ left: pct(BOX.fx, BOX.w), top: pct(BOX.fy, BOX.h), width: pct(600 * BOX.scale, BOX.w), height: pct(1000 * BOX.scale, BOX.h) }} onClick={onToggle} aria-expanded={open} aria-label={open ? "Скрыть подписи вещей" : "Показать подписи вещей"}>
        <Crossfade k={board || "none"} className="mannequin__xfade">
          {board ? <img src={board} alt={`Манекен: ${pieces.map((p) => p.name).join(", ")}`} /> : <span className="shimmer mannequin__placeholder" />}
        </Crossfade>
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
              style={{ [c.side]: pct(4, BOX.w), top: pct(c.ly - 17, BOX.h), animationDelay: `${i * 0.03}s` }}
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

// What the phone understood from «Повод и погода», said back before the outfits are made again.
const isWarmCoat = (p) => isOuter(p) && kindOf(p) !== "blazer";
function WeatherLine({ text, hasOuter }) {
  const w = readWeather(text);
  if (!w.known) return <p className="tiny-text">Напиши градусы и погоду — например «+6, ветер», и я одену по погоде.</p>;
  const plan = w.needOuter ? (hasOuter ? "в каждом образе будет куртка или пальто" : "куртки или пальто в гардеробе нет — добавь их через ＋") : w.noOuter ? "без куртки и пальто" : "верхняя одежда — по желанию";
  return <p className="weather-line fade" key={w.label}><Icon name="check" size={14} width={2.6} /> Понял: {w.label}{w.feels !== null && w.feels !== w.temp ? ` (ощущается как ${w.feels > 0 ? "+" : ""}${w.feels} °C)` : ""} — {plan}.</p>;
}

// ---- screen ---------------------------------------------------------------------------------
export function TodayView({ items, loaded, setupReady, onNavigate, onAdd, onOpenAccess, onToast }) {
  const [mode, setMode] = useState(null);
  const [plan, setPlan] = useState(null);
  const [status, setStatus] = useState("idle");
  const [error, setError] = useState("");
  const [swapId, setSwapId] = useState(null);
  const [flipped, setFlipped] = useState(false);
  const [flipMove, setFlipMove] = useState(""); // "in" | "out" while the card turns with its wind-up
  const [arrived, setArrived] = useState(""); // the piece that just came into the outfit (flies in along an arc)
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
  const [lastLiked, setLastLiked] = useState("");
  const [indoor, setIndoor] = useState(false); // mannequin without coat, scarf and hat
  const [adding, setAdding] = useState(false); // sheet for putting outerwear back
  const photoRef = useRef(null);
  const ticketRef = useRef(0); // ignores a slow plan request after the day was switched
  const [figure, setFigure] = useState({}); // gender, height, weight from the profile shape the mannequin

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
  const outdoor = pieces.filter((p) => isOutdoorLayer(p, pieces));
  const shown = indoor ? pieces.filter((p) => !outdoor.includes(p)) : pieces;
  const shownKey = shown.map((p) => p.id).join("+");

  useEffect(() => { getTiming().then((t) => setMode(defaultMode(t))); }, []);
  useEffect(() => { getProfile().then((p) => setFigure({ gender: p.gender, height: p.height, weight: p.weight })); }, []);
  useEffect(() => {
    getModelReference().then((blob) => setHasReference(Boolean(blob)));
    const onSettings = () => getModelReference().then((blob) => setHasReference(Boolean(blob)));
    window.addEventListener("capsule:settings", onSettings);
    return () => window.removeEventListener("capsule:settings", onSettings);
  }, []);

  // The latest plan, also between a tap and the next render: edits read it from here, so two quick edits
  // (a swap still flying in, then an addition) never work on an old copy and undo each other.
  const planRef = useRef(plan);
  planRef.current = plan;
  const store = useCallback(async (next) => {
    planRef.current = next;
    setPlan(next);
    if (date) await saveDayPlan(date, next);
  }, [date]);

  const generate = useCallback(async (occasion = plan?.occasion || "") => {
    if (!date) return;
    const ticket = ++ticketRef.current;
    setStatus("loading"); setError(""); setFlipped(false); setCalloutsOpen(false);
    try {
      const when = `${evening ? "Образ на завтра" : "Образ на сегодня"}, ${formatDay(date).toLowerCase()}`;
      // the weather only from the person's own words; the palette in the chosen mode (simple or extended)
      const palette = await getActivePalette();
      const outfits = await planOutfits({
        items: itemsRef.current, profile: await getProfile(), feedback: await getFeedback(), learned: await getLearned(),
        occasion: occasion ? `${when}. ${occasion}` : when, count: 5, palette,
        weather: readWeather(occasion), source: occasion, colors: palette?.mode || "", country: (await getSettings()).country,
      });
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
    Promise.all([getDayPlan(date), getActivePalette().catch(() => null)]).then(([saved, palette]) => {
      if (!alive) return;
      let clean = cleanPlan(saved, new Map(itemsRef.current.map((i) => [i.id, i])));
      // A plan made before the weather check (or by an older Worker): «+6 и ветрено» without a jacket gets
      // one from the wardrobe now, without asking the stylist again. Outfits edited by hand stay as they are.
      if (clean?.occasion) {
        const outfits = dressForWeather(clean.outfits, itemsRef.current, readWeather(clean.occasion), { source: clean.occasion, pal: palette ? paletteLab(palette) : null, contrast: contrastLevel(palette?.contrast) });
        if (outfits.some((o, i) => o !== clean.outfits[i] && o.itemIds.join("+") !== clean.outfits[i].itemIds.join("+"))) {
          clean = { ...clean, outfits, chosen: null };
          saveDayPlan(date, clean);
        }
      }
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
    renderOutfit(shown, { tuck: outfit?.tuck, ...figure }).then((url) => alive && setBoard(url)).catch(() => alive && setBoard(null));
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [flipped, shownKey, outfit?.tuck, figure]);

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
      if (reason) onToast?.(`Запомнил: ${dislikeLearned(reason)}`);
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
    onToast?.(evening ? "Образ на завтра готов. Похожие буду предлагать чаще" : "Хорошего дня! Похожие образы буду предлагать чаще");
  };

  const toggleLikeReason = async (reason) => {
    const next = new Set(likeReasons);
    if (next.has(reason)) next.delete(reason); else { next.add(reason); setLastLiked(reason); }
    setLikeReasons(next);
    if (likeAt) await amendFeedback(likeAt, { reasons: [...next] });
  };

  // `arc`: the new tile flies in along an arc (when the piece does not fly over from the sheet itself)
  const swapTo = async (itemId, { arc = true } = {}) => {
    const current = swapId;
    setSwapId(null);
    const latest = planRef.current;
    if (!latest?.outfits?.[latest.index] || !current || current === itemId) return;
    const outfits = latest.outfits.map((o, i) => (i === latest.index ? { ...o, itemIds: [...new Set(o.itemIds.map((id) => (id === current ? itemId : id)))], edited: true } : o));
    await store({ ...latest, outfits, chosen: null });
    setLikeAt(null);
    if (arc) setArrived(itemId);
  };

  // The piece picked in a sheet flies from its card to its place in the outfit: one shared element across
  // both states (like Framer Motion's layoutId), done by the browser's own View Transitions. Where the
  // browser has none, or the phone asks for less motion, the tile arrives along an arc instead.
  const [flying, setFlying] = useState("");
  const flyInto = (id, apply) => {
    const canFly = typeof document.startViewTransition === "function" && !window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    if (!canFly) { apply({ arc: true }); return; }
    flushSync(() => setFlying(id)); // the card in the sheet gets the shared name before the "before" picture
    const transition = document.startViewTransition(() => { flushSync(() => { apply({ arc: false }); }); });
    transition.finished.finally(() => setFlying(""));
  };
  const flyName = (id) => (flying === id ? { viewTransitionName: "piece-fly" } : undefined);

  const changePieces = async (update) => {
    const latest = planRef.current;
    if (!latest?.outfits?.[latest.index]) return;
    const outfits = latest.outfits.map((o, i) => (i === latest.index ? { ...o, itemIds: update(o.itemIds), edited: true } : o));
    await store({ ...latest, outfits, chosen: null });
    setLikeAt(null);
  };
  const removePiece = (id) => { setSwapId(null); changePieces((ids) => ids.filter((x) => x !== id)); };
  const addPiece = (id, { arc = true } = {}) => { setAdding(false); if (arc) setArrived(id); changePieces((ids) => [...ids.filter((x) => x !== id), id]); };

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
  // Pieces of the same category that are not in the outfit yet: picking one already worn (a bracelet
  // next to the watch) only duplicated it, so the watch just disappeared.
  const alternatives = useMemo(() => {
    if (!swapping) return [];
    const worn = new Set(outfit?.itemIds || []);
    const same = items.filter((i) => i.part === swapping.part && isDressItem(i) === isDressItem(swapping) && !worn.has(i.id));
    return [swapping, ...same];
  }, [swapping, items, outfit]);

  // «＋ Добавить»: outerwear when there is none, any accessory not worn yet, shoes when there are none.
  const addGroups = useMemo(() => {
    if (!outfit) return [];
    const worn = new Set(outfit.itemIds);
    const free = (p) => !worn.has(p.id);
    return [
      { id: "outer", label: "Верхняя одежда", items: !pieces.some(isOuter) && pieces.some((p) => p.part === "upperbody") ? items.filter((p) => isOuter(p) && free(p)) : [] },
      { id: "accessories", label: "Аксессуары", items: items.filter((p) => p.part === "accessories_up" && free(p)) },
      { id: "shoes", label: "Обувь", items: !pieces.some((p) => p.part === "shoes") ? items.filter((p) => p.part === "shoes" && free(p)) : [] },
    ].filter((g) => g.items.length);
  }, [outfit, pieces, items]);

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
          <SwapIcon name={plan?.occasion ? "check" : "plus"} size={16} width={2} />
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
        {status === "loading" ? <WaitLine phrases={PLAN_STEPS} /> : <p className="muted-text center-text">Подбираю образ…</p>}
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
        <div className={`flip__inner${flipped ? " is-flipped" : ""}${flipMove ? ` flip-${flipMove}` : ""}`} onAnimationEnd={(e) => { if (e.target === e.currentTarget) setFlipMove(""); }}>
          <section className="look-card flip__face" aria-hidden={flipped} inert={flipped}>
           <Crossfade k={`${plan.index}:${outfit.title}`} className="look-card__body">
            <div className="look-card__head">
              <div className="look-card__heading">
                <div className="look-card__title">{outfit.title}</div>
                <div className="tag-row">{tags.map((t) => <span className="tag" key={t}>{t}</span>)}</div>
              </div>
              <button type="button" className="pill-button pill-button--dark" onClick={() => { setFlipMove("in"); setFlipped(true); setSwapId(null); }}>
                <Icon name="person" size={20} width={1.9} /> На человеке
              </button>
            </div>
            <div className="look-tiles" data-count={pieces.length + (addGroups.length ? 1 : 0)}>
              {pieces.map((p, i) => (
                <button type="button" key={p.id} className={`look-tile ${p.id === arrived ? "arrive" : "rise"}`} style={{ ...(p.id === arrived ? {} : { animationDelay: `${i * 0.03}s` }), ...flyName(p.id) }} onClick={() => setSwapId(p.id)} onAnimationEnd={() => { if (p.id === arrived) setArrived(""); }} aria-label={`Заменить: ${p.name}`}>
                  {p.thumbnail || p.image ? <img src={p.thumbnail || p.image} alt="" /> : <GarmentIcon item={p} size={92} dress={isDressItem(p)} />}
                  <span className="look-tile__name">{p.name}</span>
                  <span className="look-tile__swap" aria-hidden="true"><Icon name="swap" size={16} width={2} /></span>
                </button>
              ))}
              {addGroups.length > 0 && (
                <button type="button" className="look-tile look-tile--add rise" onClick={() => setAdding(true)} aria-label={`Добавить в образ: ${addGroups.map((g) => g.label.toLowerCase()).join(", ")}`}>
                  <Icon name="plus" size={28} width={1.6} />
                  <span className="look-tile__name">{addGroups.length === 1 ? addGroups[0].label : "Добавить"}</span>
                </button>
              )}
            </div>
            {outfit.why && <p className="look-card__why rise" style={{ animationDelay: `${(pieces.length + 1) * 0.03 + 0.04}s` }}>{outfit.why}</p>}
            <div className="rise" style={{ animationDelay: `${(pieces.length + 1) * 0.03 + 0.08}s` }}><HintChips tips={outfit.tips} label="Советы стилиста к образу" /></div>
           </Crossfade>
          </section>

          <section className="look-card flip__face flip__back" aria-hidden={!flipped} inert={!flipped}>
            <div className="look-card__head">
              <Segmented label="Как показать образ" className="segmented--wide" value={view} onChange={setView} options={[{ id: "mannequin", label: "Манекен" }, { id: "me", label: "На мне" }]} />
              <button type="button" className="pill-button" onClick={() => { setFlipMove("out"); setFlipped(false); }}><Icon name="grid" size={18} width={2} /> Вещи</button>
            </div>
            <div className="stage">
              {!me && (
                <>
                  <Mannequin board={board} pieces={shown} body={{ ...figure, tuck: outfit.tuck }} open={calloutsOpen} onToggle={() => setCalloutsOpen((v) => !v)} onPick={setSwapId} />
                  {outdoor.length > 0 && (
                    <button type="button" className={`stage__toggle${indoor ? " is-on" : ""}`} aria-pressed={indoor} onClick={() => setIndoor((v) => !v)}>
                      <Icon name={indoor ? "check" : "home"} size={16} width={2.2} /> В помещении
                    </button>
                  )}
                  <span className="stage__caption">{calloutsOpen ? "Нажми на вещь, чтобы заменить" : indoor ? "Без верхней одежды — как внутри" : "Нажми на манекен — покажу вещи"}</span>
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
              <div className="chip-row">{LIKE_REASONS.map((r) => <button type="button" key={r} className={`chip${likeReasons.has(r) ? " is-on" : ""}`} aria-pressed={likeReasons.has(r)} onClick={() => toggleLikeReason(r)}>{likeReasons.has(r) && <Icon name="check" size={14} width={2.6} />}{r}</button>)}</div>
              {likeReasons.has(lastLiked) && (
                <p className="learned-line fade" key={lastLiked} role="status">
                  <Icon name="check" size={14} width={2.6} /> Запомнил: {LIKE_LEARNED[lastLiked]}. Это учтётся уже в следующем образе.
                </p>
              )}
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
          {swapping && canRemove(swapping, pieces) && (
            <button type="button" className="alt-card alt-card--none rise" onClick={() => removePiece(swapping.id)}>
              <span className="alt-card__image alt-card__image--none"><Icon name="close" size={30} width={1.6} /></span>
              <span className="alt-card__text">
                <span className="strong-text">{isOuter(swapping) ? "Без верхней одежды" : "Без аксессуара"}</span>
                <span className="tiny-text">{isOuter(swapping) ? "Сегодня без неё" : "Убрать из образа"}</span>
              </span>
            </button>
          )}
          {alternatives.map((alt, i) => {
            const current = alt.id === swapping?.id;
            return (
              <button type="button" key={alt.id} className={`alt-card rise${current ? " is-current" : ""}`} style={{ animationDelay: `${i * 0.03}s` }} aria-pressed={current} onClick={() => (current ? swapTo(alt.id) : flyInto(alt.id, (o) => swapTo(alt.id, o)))}>
                <span className="alt-card__image" style={flyName(alt.id)}>
                  {alt.thumbnail || alt.image ? <img src={alt.thumbnail || alt.image} alt="" /> : <GarmentIcon item={alt} size={72} />}
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
        {alternatives.length < 2 && (
          <p className="muted-text">{pieces.some((p) => p.id !== swapping?.id && p.part === swapping?.part)
            ? "Остальные вещи этой категории уже в образе. Новую можно добавить кнопкой «＋» в гардеробе или найти в «Покупках»."
            : "Других вещей этой категории пока нет. Добавь их кнопкой «＋» или найди новую."}</p>
        )}
        {/* Not a copy of this piece: the stylist suggests different ones that suit the rest of the outfit. */}
        <button type="button" className="dark-link" onClick={() => {
          const piece = swapping;
          setSwapId(null);
          const outfit = pieces.filter((p) => p.id !== piece.id).map((p) => ({ name: p.name, part: p.part, color: p.color, kind: p.kind }));
          onNavigate("shopping", { focus: { replace: { name: piece.name, part: piece.part, kind: piece.kind, color: piece.color, outfit } } });
        }}>
          <span className="dark-link__icon"><Icon name="bag" size={20} width={1.9} /></span>
          <span className="dark-link__text"><span>Нет подходящих? Подберём другую</span><small>Другой цвет или фасон — под этот образ, в твоём размере</small></span>
          <Icon name="chevron" size={20} width={2} />
        </button>
      </Sheet>

      <Sheet open={adding} onClose={() => setAdding(false)} title="Добавить в образ" subtitle="Из твоего гардероба">
        {addGroups.map((group) => (
          <div className="add-group" key={group.id}>
            <span className="section-label">{group.label}</span>
            <div className="alt-grid">
              {group.items.map((alt, i) => (
                <button type="button" key={alt.id} className="alt-card rise" style={{ animationDelay: `${i * 0.03}s` }} onClick={() => flyInto(alt.id, (o) => addPiece(alt.id, o))}>
                  <span className="alt-card__image" style={flyName(alt.id)}>{alt.thumbnail || alt.image ? <img src={alt.thumbnail || alt.image} alt="" /> : <GarmentIcon item={alt} size={72} />}</span>
                  <span className="alt-card__text"><span className="strong-text">{alt.name}</span><span className="tiny-text">{[alt.brand, ...(alt.tags || []).slice(0, 2)].filter(Boolean).join(" · ") || " "}</span></span>
                </button>
              ))}
            </div>
          </div>
        ))}
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
        <WeatherLine text={occasionDraft} hasOuter={items.some(isWarmCoat)} />
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
