// Size chips for one size system (src/lib/sizes.js): letters, EU numbers, W/L for jeans, EU shoes.
// Used in «Покупки» (the size sheet) and in the first-launch question «Какой размер обычно носишь?».
// `value` and `onChange` use the picker's terms: "M", 42.5, { w: 32, l: 32 }.
import { useEffect, useRef } from "react";
import { sizeOptions } from "./lib/sizes.js";

// a long row scrolls sideways: bring the chosen chip into view without moving the page
function useCentered(selected) {
  const ref = useRef(null);
  useEffect(() => {
    const row = ref.current;
    const chip = row?.querySelector(".is-on");
    if (row && chip && row.scrollWidth > row.clientWidth) row.scrollLeft = chip.offsetLeft - row.offsetLeft - row.clientWidth / 2 + chip.clientWidth / 2;
  }, [selected]);
  return ref;
}

export function SizeChips({ system, gender = "", value, onChange, scroll = false, label = "" }) {
  const options = sizeOptions(system, gender);
  const wl = system === "wl";
  const mainRef = useCentered(wl ? value?.w : value);
  const secondRef = useCentered(value?.l);
  if (!options) return null;
  const row = `chip-row${scroll ? " chip-row--scroll" : ""}`;
  return (
    <div className="size-chips">
      <span className="section-label">{label || options.label}</span>
      <div className={row} role="group" aria-label={label || options.label} ref={mainRef}>
        {options.main.map((v) => {
          const on = wl ? value?.w === v : value === v;
          return (
            <button type="button" key={v} className={`chip size-chip${on ? " is-on" : ""}`} aria-pressed={on}
              onClick={() => onChange(on && !wl ? null : wl ? { w: v, l: value?.l || 32 } : v)}>{wl ? `W${v}` : v}</button>
          );
        })}
      </div>
      {options.second && (
        <>
          <span className="section-label">{options.secondLabel}</span>
          <div className={row} role="group" aria-label={options.secondLabel} ref={secondRef}>
            {options.second.map((v) => {
              const on = value?.l === v;
              return <button type="button" key={v} className={`chip size-chip${on ? " is-on" : ""}`} aria-pressed={on} onClick={() => onChange({ w: value?.w || 32, l: v })}>L{v}</button>;
            })}
          </div>
        </>
      )}
    </div>
  );
}
