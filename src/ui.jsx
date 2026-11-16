// Small shared pieces of the v2 design: icons, garment silhouettes, the sliding toggle
// and the bottom sheet. Shapes and sizes follow design/V2-*.dc.html.
import { useEffect, useState } from "react";

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

// ---- garment silhouettes (viewBox 0 0 120 120) --------------------------------------------
const SHAPES = {
  jacket: "M42 16 L60 24 L78 16 L102 30 L108 104 L86 104 L84 58 L80 104 L40 104 L36 58 L34 104 L12 104 L18 30 Z",
  tee: "M40 18 L52 14 Q60 24 68 14 L80 18 L106 38 L94 54 L84 47 L84 106 L36 106 L36 47 L26 54 L14 38 Z",
  pants: "M38 10 L82 10 L90 110 L66 110 L60 46 L54 110 L30 110 Z",
  shoes: "M12 76 L16 52 Q30 58 42 48 L58 58 Q82 66 102 70 Q110 72 110 82 L110 88 L12 88 Z",
  dress: "M44 12 L60 20 L76 12 L84 38 L76 52 L100 108 L20 108 L44 52 L36 38 Z",
  bag: "M22 46 L98 46 L104 106 L16 106 Z M42 46 Q42 20 60 20 Q78 20 78 46 L70 46 Q70 28 60 28 Q50 28 50 46 Z",
};

const PART_SHAPE = { wholebody_up: "jacket", upperbody: "tee", lowerbody: "pants", shoes: "shoes", accessories_up: "bag" };
export const isDressItem = (item) => item?.part === "wholebody_up" && /dress|jumpsuit|платье|сарафан|комбинезон/i.test(`${item.name || ""} ${(item.tags || []).join(" ")}`);

export function GarmentIcon({ part, color = "#8a7f72", size = 48, dress = false, outline = true }) {
  const shape = dress ? "dress" : PART_SHAPE[part] || "tee";
  return (
    <svg aria-hidden="true" width={size} height={size} viewBox="0 0 120 120">
      <path d={SHAPES[shape]} fill={color} fillRule="evenodd" stroke={outline ? "#1E1B18" : "none"} strokeOpacity={shape === "shoes" ? 0.3 : 0.25} strokeWidth="2" style={{ transition: "fill .4s" }} />
    </svg>
  );
}

// ---- sliding segmented toggle -------------------------------------------------------------
// options: [{ id, label?, icon?, aria? }]
export function Segmented({ options, value, onChange, label, tone = "light", className = "", role = "group" }) {
  const index = Math.max(0, options.findIndex((o) => o.id === value));
  const isTabs = role === "tablist";
  return (
    <div className={`segmented segmented--${tone} ${className}`} role={role} aria-label={label} style={{ "--count": options.length, "--index": index }}>
      <span className="segmented__thumb" aria-hidden="true" />
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
export function Sheet({ open, onClose, title, subtitle, children, className = "" }) {
  const [mounted, setMounted] = useState(open);
  const [shown, setShown] = useState(false);

  useEffect(() => {
    if (open) {
      setMounted(true);
      let inner;
      const outer = requestAnimationFrame(() => { inner = requestAnimationFrame(() => setShown(true)); });
      return () => { cancelAnimationFrame(outer); cancelAnimationFrame(inner); };
    }
    setShown(false);
    const timer = setTimeout(() => setMounted(false), 420);
    return () => clearTimeout(timer);
  }, [open]);

  useEffect(() => {
    if (!open) return undefined;
    const onKey = (event) => { if (event.key === "Escape") onClose(); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!mounted) return null;
  return (
    <div className={`sheet-layer${shown ? " is-open" : ""}`}>
      <div className="sheet-backdrop" onClick={onClose} />
      <div className={`sheet ${className}`} role="dialog" aria-modal="true" aria-label={title}>
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
        <div className="sheet__body">{children}</div>
      </div>
    </div>
  );
}

export function Spinner({ label }) {
  return <span className="spinner" role="status" aria-label={label || "Загрузка"} />;
}
