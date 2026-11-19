// Small shared pieces of the v2 design: icons, garment silhouettes, the sliding toggle
// and the bottom sheet. Shapes and sizes follow design/V2-*.dc.html.
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { kindOf } from "./lib/kinds.js";

const stroke = { fill: "none", stroke: "currentColor", strokeLinecap: "round", strokeLinejoin: "round" };

const ICONS = {
  sun: <><circle cx="12" cy="12" r="4" /><path d="M12 3v2M12 19v2M3 12h2M19 12h2M5.6 5.6l1.4 1.4M17 17l1.4 1.4M5.6 18.4L7 17M17 7l1.4-1.4" /></>,
  today: <><circle cx="12" cy="12" r="4" /><path d="M12 2v2M12 20v2M2 12h2M20 12h2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" /></>,
  moon: <path d="M20 14.5A8 8 0 0 1 9.5 4a7 7 0 1 0 10.5 10.5Z" />,
  both: <><path d="M4 12a8 8 0 0 1 13.7-5.7L20 8.5" /><path d="M20 4v4.5h-4.5" /><path d="M20 12a8 8 0 0 1-13.7 5.7L4 15.5" /><path d="M4 20v-4.5h4.5" /></>,
  hanger: <><path d="M10 6a2 2 0 1 1 3 1.7c-.6.4-1 .9-1 1.6V10" /><path d="M12 10 L3 16.5 Q2 18 4 18 L20 18 Q22 18 21 16.5 Z" /></>,
  bag: <><path d="M5 8h14l-1 12H6Z" /><path d="M9 8V6a3 3 0 0 1 6 0v2" /></>,
  profile: <><circle cx="12" cy="8" r="4" /><path d="M4 21c1.5-4 4.5-6 8-6s6.5 2 8 6" /></>,
  plus: <path d="M12 5v14M5 12h14" />,
  swap: <path d="M4 8h13l-3-3M20 16H7l3 3" />,
  person: <><circle cx="12" cy="5" r="2.5" /><path d="M8 21l1-8-3-1 2-4h8l2 4-3 1 1 8" /></>,
  grid: <><rect x="4" y="4" width="7" height="7" rx="1.5" /><rect x="13" y="4" width="7" height="7" rx="1.5" /><rect x="4" y="13" width="7" height="7" rx="1.5" /><rect x="13" y="13" width="7" height="7" rx="1.5" /></>,
  close: <path d="M6 6l12 12M18 6L6 18" />,
  chevron: <path d="M9 5l7 7-7 7" />,
  back: <path d="M15 5l-7 7 7 7" />,
  camera: <><path d="M4 8h3l2-3h6l2 3h3v11H4Z" /><circle cx="12" cy="13" r="3.5" /></>,
  trend: <><path d="M3 17l6-6 4 4 8-8" /><path d="M15 7h6v6" /></>,
  share: <><path d="M12 15V3M7 8l5-5 5 5" /><path d="M5 13v7h14v-7" /></>,
  star: <path d="M12 3l2.4 5.6L20 9.5l-4.3 3.9L17 19l-5-3-5 3 1.3-5.6L4 9.5l5.6-.9Z" />,
  refresh: <><path d="M20 12a8 8 0 1 1-2.3-5.7" /><path d="M20 4v5h-5" /></>,
  check: <path d="M5 12.5l4.5 4.5L19 7.5" />,
  external: <><path d="M14 5h5v5" /><path d="M19 5l-8 8" /><path d="M18 14v5H5V6h5" /></>,
  bell: <><path d="M6 16V11a6 6 0 0 1 12 0v5l1.5 2h-15Z" /><path d="M10 20.5a2 2 0 0 0 4 0" /></>,
  map: <><path d="M12 21s-6.5-5.6-6.5-11a6.5 6.5 0 0 1 13 0C18.5 15.4 12 21 12 21Z" /><circle cx="12" cy="10" r="2.4" /></>,
  ruler: <><path d="M3 15.5 15.5 3 21 8.5 8.5 21Z" /><path d="M7 11.5l1.8 1.8M10 8.5l1.8 1.8M13 5.5l1.8 1.8" /></>,
  home: <path d="M4 11.5 12 4l8 7.5V20h-5.5v-6h-5v6H4Z" />,
  key: <><circle cx="8" cy="15" r="4" /><path d="M11 12l8-8M16 7l2 2" /></>,
  palette: <><path d="M12 3a9 9 0 1 0 0 18c1.2 0 2-.8 2-1.8 0-1.4-1.3-1.8-1.3-3 0-1 .8-1.7 1.8-1.7H17a4 4 0 0 0 4-4C21 6.5 17 3 12 3Z" /><circle cx="7.5" cy="11" r="1.2" /><circle cx="10.5" cy="7.5" r="1.2" /><circle cx="15" cy="7.5" r="1.2" /></>,
};

export function Icon({ name, size = 24, width = 1.8, className, color }) {
  return (
    <svg aria-hidden="true" className={className} width={size} height={size} viewBox="0 0 24 24" {...stroke} strokeWidth={width} style={color ? { color } : undefined}>
      {ICONS[name]}
    </svg>
  );
}

// ---- item silhouettes by exact type (viewBox 0 0 120 120) ---------------------------------
// fill: the item's colour; line: details drawn on top; ring: items drawn as a thick coloured line.
const SHAPES = {
  "t-shirt": { fill: "M40 18 L52 14 Q60 24 68 14 L80 18 L106 38 L94 54 L84 47 L84 106 L36 106 L36 47 L26 54 L14 38 Z" },
  shirt: { fill: "M42 16 L52 12 L60 22 L68 12 L78 16 L104 34 L110 74 L96 76 L90 50 L88 108 L32 108 L30 50 L24 76 L10 74 L16 34 Z", line: "M52 12 L56 26 L60 22 L64 26 L68 12 M60 24 L60 106 M60 46 h0.1 M60 66 h0.1 M60 86 h0.1" },
  hoodie: { fill: "M40 30 Q38 12 60 12 Q82 12 80 30 L104 42 L110 98 L96 100 L90 58 L90 108 L30 108 L30 58 L24 100 L10 98 L16 42 Z", line: "M44 30 Q60 46 76 30 M54 40 L54 54 M66 40 L66 54 M42 84 L78 84 L82 102 L38 102 Z" },
  sweater: { fill: "M40 18 Q60 30 80 18 L104 34 L110 98 L96 100 L90 54 L88 108 L32 108 L30 54 L24 100 L10 98 L16 34 Z", line: "M42 20 Q60 32 78 20 M32 100 L88 100" },
  jacket: { fill: "M42 16 L60 24 L78 16 L102 30 L108 104 L86 104 L84 58 L80 104 L40 104 L36 58 L34 104 L12 104 L18 30 Z", line: "M60 24 L60 104 M44 84 L52 84 M68 84 L76 84" },
  blazer: { fill: "M42 14 L60 22 L78 14 L102 28 L108 106 L86 106 L84 58 L80 106 L40 106 L36 58 L34 106 L12 106 L18 28 Z", line: "M46 16 L60 62 L74 16 M60 62 L60 106 M60 72 h0.1 M60 88 h0.1 M42 80 L52 80" },
  coat: { fill: "M42 8 L60 16 L78 8 L100 20 L106 114 L84 114 L82 54 L80 116 L40 116 L38 54 L36 114 L14 114 L20 20 Z", line: "M46 10 L60 52 L74 10 M60 52 L60 116 M66 64 h0.1 M66 82 h0.1 M66 100 h0.1" },
  dress: { fill: "M44 12 L60 20 L76 12 L84 38 L76 52 L100 108 L20 108 L44 52 L36 38 Z", line: "M38 52 L82 52" },
  trousers: { fill: "M38 10 L82 10 L90 110 L66 110 L60 46 L54 110 L30 110 Z", line: "M38 18 L82 18" },
  jeans: { fill: "M38 10 L82 10 L90 110 L66 110 L60 46 L54 110 L30 110 Z", line: "M38 18 L82 18 M42 18 Q44 30 54 28 M78 18 Q76 30 66 28 M60 18 L60 40" },
  shorts: { fill: "M34 22 L86 22 L94 76 L66 78 L60 50 L54 78 L26 76 Z", line: "M34 30 L86 30" },
  skirt: { fill: "M40 20 L80 20 L98 102 L22 102 Z", line: "M40 28 L80 28 M52 28 L46 102 M68 28 L74 102" },
  sneakers: { fill: "M12 76 L16 52 Q30 58 42 48 L58 58 Q82 66 102 70 Q110 72 110 82 L110 88 L12 88 Z", line: "M12 80 L110 80 M46 56 L52 62 M52 54 L58 60" },
  boots: { fill: "M32 12 L62 12 L64 66 Q92 70 104 80 Q110 84 110 94 L110 104 L30 104 Z", line: "M30 96 L110 96 M32 22 L62 22" },
  loafers: { fill: "M12 84 L18 66 Q40 72 60 64 Q86 66 104 76 Q110 80 110 88 L110 94 L12 94 Z", line: "M12 88 L110 88 M48 70 Q58 76 68 68" },
  bag: { fill: "M22 46 L98 46 L104 106 L16 106 Z M42 46 Q42 20 60 20 Q78 20 78 46 L70 46 Q70 28 60 28 Q50 28 50 46 Z", line: "M22 62 L98 62" },
  backpack: { fill: "M32 32 Q32 14 60 14 Q88 14 88 32 L92 108 L28 108 Z", line: "M42 70 L78 70 L78 98 L42 98 Z M50 14 Q50 6 60 6 Q70 6 70 14" },
  cap: { fill: "M22 76 Q22 36 60 36 Q98 36 98 76 Z M60 76 L114 76 Q114 88 96 88 L60 88 Z", line: "M60 36 L60 76" },
  beanie: { fill: "M26 84 Q26 28 60 28 Q94 28 94 84 Z", line: "M24 70 L96 70 M24 86 L96 86 M24 70 L24 86 M96 70 L96 86" },
  hat: { fill: "M38 66 Q38 30 60 30 Q82 30 82 66 Z M10 68 Q60 52 110 68 Q60 84 10 68 Z", line: "M38 58 Q60 64 82 58" },
  scarf: { fill: "M28 22 Q60 40 92 22 L96 40 Q60 60 24 40 Z M60 44 L78 48 L74 110 L58 110 Z", line: "M58 100 L74 100" },
  tie: { fill: "M54 12 L66 12 L70 24 L64 30 L74 96 L60 112 L46 96 L56 30 L50 24 Z" },
  belt: { fill: "M6 50 L114 50 L114 70 L6 70 Z", line: "M70 46 L90 46 L90 74 L70 74 Z M78 60 L96 60" },
  chain: { ring: "M28 20 Q60 100 92 20", line: "M60 74 m-7 0 a7 7 0 1 0 14 0 a7 7 0 1 0 -14 0" },
  watch: { fill: "M48 6 L72 6 L72 114 L48 114 Z", line: "M60 60 m-22 0 a22 22 0 1 0 44 0 a22 22 0 1 0 -44 0 M60 46 L60 60 L70 66" },
  glasses: { ring: "M16 60 a20 20 0 1 0 40 0 a20 20 0 1 0 -40 0 M64 60 a20 20 0 1 0 40 0 a20 20 0 1 0 -40 0 M56 56 Q60 50 64 56" },
  sunglasses: { fill: "M14 50 L56 50 Q56 78 36 78 Q14 78 14 50 Z M64 50 L106 50 Q106 78 86 78 Q64 78 64 50 Z", line: "M56 52 Q60 46 64 52 M8 50 L112 50" },
  bracelet: { ring: "M60 60 m-34 0 a34 22 0 1 0 68 0 a34 22 0 1 0 -68 0" },
  ring: { ring: "M60 66 m-26 0 a26 26 0 1 0 52 0 a26 26 0 1 0 -52 0", line: "M60 30 m-9 0 a9 9 0 1 0 18 0 a9 9 0 1 0 -18 0" },
  earrings: { ring: "M38 26 L38 44 M82 26 L82 44", line: "M38 64 m-12 0 a12 16 0 1 0 24 0 a12 16 0 1 0 -24 0 M82 64 m-12 0 a12 16 0 1 0 24 0 a12 16 0 1 0 -24 0" },
};

export const isDressItem = (item) => item?.part === "wholebody_up" && /dress|jumpsuit|платье|сарафан|комбинезон/i.test(`${item.kind || ""} ${item.name || ""} ${(item.tags || []).join(" ")}`);

// item: anything with part / kind / name (wardrobe item, shopping gap). `part` alone still works.
export function GarmentIcon({ item, part, color, size = 48, dress = false, outline = true }) {
  const kind = dress ? "dress" : kindOf(item || { part });
  const shape = SHAPES[kind] || SHAPES["t-shirt"];
  const fill = color || item?.color || "#8a7f72";
  const edge = outline ? "#1E1B18" : "none";
  return (
    <svg aria-hidden="true" width={size} height={size} viewBox="0 0 120 120">
      {shape.fill && <path d={shape.fill} fill={fill} fillRule="evenodd" stroke={edge} strokeOpacity="0.28" strokeWidth="2" strokeLinejoin="round" style={{ transition: "fill .4s" }} />}
      {shape.ring && <path d={shape.ring} fill="none" stroke={fill} strokeWidth="8" strokeLinecap="round" style={{ transition: "stroke .4s" }} />}
      {shape.ring && outline && <path d={shape.ring} fill="none" stroke="#1E1B18" strokeOpacity="0.25" strokeWidth="1.5" />}
      {shape.line && <path d={shape.line} fill="none" stroke="#1E1B18" strokeOpacity="0.35" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />}
    </svg>
  );
}

// ---- sliding segmented toggle -------------------------------------------------------------
// options: [{ id, label?, icon?, aria? }]
export function Segmented({ options, value, onChange, label, tone = "light", className = "", role = "group" }) {
  const index = Math.max(0, options.findIndex((o) => o.id === value));
  const isTabs = role === "tablist";
  // the knob stretches 12 % while it travels to the new option
  const [moving, setMoving] = useState(false);
  const last = useRef(index);
  useEffect(() => {
    if (last.current === index) return undefined;
    last.current = index;
    setMoving(true);
    const timer = setTimeout(() => setMoving(false), 360);
    return () => clearTimeout(timer);
  }, [index]);
  return (
    <div className={`segmented segmented--${tone} ${className}`} role={role} aria-label={label} style={{ "--count": options.length, "--index": index }}>
      <span className={`segmented__thumb${moving ? " is-moving" : ""}`} aria-hidden="true" />
      {options.map((o) => (
        <button
          key={o.id}
          type="button"
          role={isTabs ? "tab" : undefined}
          aria-selected={isTabs ? o.id === value : undefined}
          aria-pressed={isTabs ? undefined : o.id === value}
          aria-label={o.aria}
          className={o.id === value ? "is-on" : ""}
          onClick={() => onChange(o.id)}
        >
          {o.icon ? <Icon name={o.icon} size={18} width={1.9} /> : o.label}
        </button>
      ))}
    </div>
  );
}

// ---- bottom sheet ---------------------------------------------------------------------------
// Stays mounted for the slide-out, so both directions animate (0.4s, design easing).
// Drawn on top of the page (a portal), so the screen behind can step back while it is open
// (`has-sheet` on <body>, staging); dragging the grip or the title down closes it, like system sheets.
let openSheets = 0;
export function Sheet({ open, onClose, title, subtitle, children, className = "" }) {
  const [mounted, setMounted] = useState(open);
  const [shown, setShown] = useState(false);
  const [drag, setDrag] = useState(0);
  const dragFrom = useRef(null);

  useEffect(() => {
    if (!shown) return undefined;
    openSheets += 1;
    document.body.classList.add("has-sheet");
    return () => {
      openSheets = Math.max(0, openSheets - 1);
      if (!openSheets) document.body.classList.remove("has-sheet");
    };
  }, [shown]);

  const dragStart = (e) => {
    if (e.target.closest("button") || (e.button !== undefined && e.button !== 0)) return;
    dragFrom.current = e.clientY;
    e.currentTarget.setPointerCapture?.(e.pointerId);
  };
  // down: follows the finger; up: a rubber band that gives a little, harder and harder, then snaps back
  const dragMove = (e) => {
    if (dragFrom.current === null) return;
    const dy = e.clientY - dragFrom.current;
    setDrag(dy >= 0 ? dy : -Math.min(36, Math.sqrt(-dy) * 3));
  };
  const dragEnd = () => {
    if (dragFrom.current === null) return;
    dragFrom.current = null;
    if (drag > 90) onClose();
    setDrag(0);
  };

  useEffect(() => {
    if (open) {
      setMounted(true);
      let inner;
      const outer = requestAnimationFrame(() => { inner = requestAnimationFrame(() => setShown(true)); });
      return () => { cancelAnimationFrame(outer); cancelAnimationFrame(inner); };
    }
    setShown(false);
    const timer = setTimeout(() => setMounted(false), 340); // the exit is 20 % shorter than the entrance
    return () => clearTimeout(timer);
  }, [open]);

  useEffect(() => {
    if (!open) return undefined;
    const onKey = (event) => { if (event.key === "Escape") onClose(); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!mounted) return null;
  return createPortal(
    <div className={`sheet-layer${shown ? " is-open" : ""}`}>
      <div className="sheet-backdrop" onClick={onClose} style={drag > 0 ? { opacity: Math.max(0.2, 1 - drag / 400) } : undefined} />
      <div className={`sheet ${className}`} role="dialog" aria-modal="true" aria-label={title} style={drag ? { transform: `translateY(${drag}px)`, transition: "none" } : undefined}>
        <div className="sheet__drag" onPointerDown={dragStart} onPointerMove={dragMove} onPointerUp={dragEnd} onPointerCancel={dragEnd}>
          <div className="sheet__grip" aria-hidden="true" />
          {(title || subtitle) && (
            <div className="sheet__head">
              <div>
                {title && <div className="sheet__title">{title}</div>}
                {subtitle && <div className="sheet__subtitle">{subtitle}</div>}
              </div>
              <button type="button" className="round-button" aria-label="Закрыть" onClick={onClose}><Icon name="close" size={18} width={2.2} /></button>
            </div>
          )}
        </div>
        <div className="sheet__body">{children}</div>
      </div>
    </div>,
    document.body,
  );
}

// While the stylist (an AI call, 3–10 s) works: what is happening right now, a new step every ~1.6 s,
// so the wait never looks frozen (Doherty threshold: show progress within 0.4 s). Stops at the last
// step instead of looping, so it never pretends to be further along than it is.
export function WaitLine({ phrases, tone = "" }) {
  const [step, setStep] = useState(0);
  useEffect(() => {
    const timer = setInterval(() => setStep((n) => Math.min(n + 1, phrases.length - 1)), 1600);
    return () => clearInterval(timer);
  }, [phrases.length]);
  return (
    <p className={`wait-line${tone === "dark" ? " wait-line--dark" : ""}`} aria-live="polite">
      <span className="spinner" aria-hidden="true" />
      <span key={step} className="fade">{phrases[step]}</span>
    </p>
  );
}

export function Spinner({ label }) {
  return <span className="spinner" role="status" aria-label={label || "Загрузка"} />;
}

// Stylist notes as small chips; a tap opens a short explanation under them, a second tap closes it.
// tips: [{ title, why }] (or { label, value, why } for palette traits).
export function HintChips({ tips, tone = "light", label = "Почему так" }) {
  const [open, setOpen] = useState(-1);
  const [leaving, setLeaving] = useState(null); // the note on its way back into its chip: { index, arrow }
  const [arrow, setArrow] = useState(24); // where the note's arrow (and its growth) starts: under the chip
  const chips = useRef([]);
  const list = (tips || []).filter((t) => t && t.why && (t.title || t.label));
  const signature = list.map((t) => `${t.title || t.label}:${t.why}`).join("|");
  useEffect(() => { setOpen(-1); setLeaving(null); }, [signature]); // another outfit or palette closes the open note
  if (!list.length) return null;
  const arrowOf = (i) => { const b = chips.current[i]; return b ? Math.round(b.offsetLeft + Math.min(b.offsetWidth / 2, 28)) : 24; };
  const toggle = (i) => {
    if (open === i) { setLeaving({ index: i, arrow }); setOpen(-1); return; }
    setLeaving(null);
    setArrow(arrowOf(i));
    setOpen(i);
  };
  const shown = open >= 0 ? { index: open, arrow, leaving: false } : leaving ? { ...leaving, leaving: true } : null;
  return (
    <div className={`hint-chips hint-chips--${tone}`}>
      <div className="hint-chips__row" role="group" aria-label={label}>
        {list.map((t, i) => (
          <button type="button" key={`${t.title || t.label}-${i}`} ref={(el) => { chips.current[i] = el; }} className={`hint-chip${open === i ? " is-on" : ""}`} aria-expanded={open === i} onClick={() => toggle(i)}>
            <Icon name="star" size={12} width={2.2} />
            {t.title || <>{t.label}: <b>{t.value}</b></>}
          </button>
        ))}
      </div>
      {shown && list[shown.index] && (
        <p className={`hint-bubble${shown.leaving ? " is-leaving" : ""}`} role="status" key={`${shown.index}-${shown.leaving}`} style={{ "--arrow": `${shown.arrow}px` }}
          onAnimationEnd={() => { if (shown.leaving) setLeaving(null); }}>{list[shown.index].why}</p>
      )}
    </div>
  );
}

// An icon that changes (a plus becomes a check, a bell becomes a cross) melts into the next one: both are
// drawn on the same spot and cross-fade with a little blur, instead of one icon jumping into another.
export function SwapIcon({ name, size = 16, width = 2 }) {
  const [shown, setShown] = useState([name]);
  useEffect(() => {
    setShown((list) => (list[list.length - 1] === name ? list : [...list.filter((n) => n !== name), name].slice(-2)));
  }, [name]);
  return (
    <span className="swap-icon" aria-hidden="true">
      {shown.map((n) => <span key={n} className={n === name ? "" : "is-off"}><Icon name={n} size={size} width={width} /></span>)}
    </span>
  );
}

// Old and new content at the same time: when `k` changes (another outfit, another picture), the previous
// content stays on top for a moment and fades out while the new one fades in, with no empty frame between.
export function Crossfade({ k, children, className = "" }) {
  const prev = useRef({ k, children });
  const timer = useRef(0);
  const [ghost, setGhost] = useState(null);
  useLayoutEffect(() => {
    if (prev.current.k !== k) {
      setGhost({ k: prev.current.k, children: prev.current.children });
      clearTimeout(timer.current);
      timer.current = setTimeout(() => setGhost(null), 260);
    }
    prev.current = { k, children };
  });
  useEffect(() => () => clearTimeout(timer.current), []);
  return (
    <div className={`xfade ${className}`}>
      {ghost && <div className="xfade__old" aria-hidden="true" inert="" key={`old-${ghost.k}`}>{ghost.children}</div>}
      <div className={ghost ? "xfade__new" : ""} key={`new-${k}`}>{children}</div>
    </div>
  );
}
