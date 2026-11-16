// «Покупки» (design/V2-Shopping.dc.html).
// What the capsule is missing comes from the real `gaps` task. Prices with delivery need the future
// `prices` task (see CLAUDE.md §6), so for now every row opens a real search in a Belgian shop,
// filtered by new / second-hand, instead of showing invented prices.
import { useCallback, useEffect, useMemo, useState } from "react";
import { getGapsCache, inMonth, saveGapsCache } from "./lib/daily.js";
import { SetupError } from "./lib/gemini.js";
import { plural } from "./lib/plural.js";
import { getFeedback, getLearned, getProfile } from "./lib/settings.js";
import { findGaps } from "./lib/stylist.js";
import { GarmentIcon, Icon, Spinner, isDressItem } from "./ui.jsx";

const STORES = [
  { id: "google", name: "Google Покупки", cond: "new", note: "Сравнение цен по магазинам Бельгии", url: (q) => `https://www.google.com/search?tbm=shop&gl=be&hl=ru&q=${encodeURIComponent(q)}` },
  { id: "vinted", name: "Vinted", cond: "used", note: "Б/у от людей · доставка в пункт выдачи", url: (q) => `https://www.vinted.be/catalog?search_text=${encodeURIComponent(q)}` },
  { id: "2dehands", name: "2dehands", cond: "used", note: "Объявления в Бельгии · часто самовывоз", url: (q) => `https://www.2dehands.be/q/${encodeURIComponent(q).replace(/%20/g, "+")}/` },
];
const FILTERS = [{ id: "all", label: "Все" }, { id: "new", label: "Новые" }, { id: "used", label: "Б/у" }];
const PRIORITY = { high: "в первую очередь", medium: "желательно", low: "по желанию" };

// How many new outfits the piece opens up, counted from the real wardrobe: a top goes with every
// bottom it pairs with, a bottom with every top, outerwear/shoes/accessories complete existing outfits.
function newOutfits(gap, items) {
  const paired = items.filter((i) => gap.pairsWith?.includes(i.id));
  const of = (part, list) => list.filter((i) => i.part === part && !isDressItem(i)).length;
  const count = (part) => of(part, paired) || of(part, items);
  const dresses = items.filter(isDressItem).length;
  const base = (list) => of("upperbody", list) * of("lowerbody", list) + list.filter(isDressItem).length;
  if (isDressItem({ part: gap.part, name: gap.item, kind: gap.kind })) return Math.max(1, items.filter((i) => i.part === "shoes").length);
  if (gap.part === "upperbody") return count("lowerbody");
  if (gap.part === "lowerbody") return count("upperbody") + of("wholebody_up", paired);
  const outfits = base(paired) || base(items) || dresses;
  return Math.min(outfits, 99);
}

function impact(gap, items) {
  const n = newOutfits(gap, items);
  if (!n) return PRIORITY[gap.priority] || "";
  return `+${n} ${plural(n, ["образ", "образа", "образов"])}`;
}

export function ShoppingView({ items, setupReady, focus, refreshKey, onOpenAccess }) {
  const [cache, setCache] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [selected, setSelected] = useState(0);
  const [filter, setFilter] = useState("all");

  const load = useCallback(async () => {
    setBusy(true); setError("");
    try {
      const result = await findGaps({ items, profile: await getProfile(), feedback: await getFeedback(), learned: await getLearned() });
      setCache(await saveGapsCache(result, items.length));
      setSelected(0);
    } catch (e) {
      setError(e instanceof SetupError ? "setup" : e.message);
    } finally {
      setBusy(false);
    }
  }, [items]);

  useEffect(() => {
    let alive = true;
    getGapsCache().then((saved) => {
      if (!alive) return;
      setCache(saved);
      const stale = !saved || refreshKey || Math.abs((saved.itemCount || 0) - items.length) >= 3;
      if (stale && setupReady && items.length >= 2) load();
    });
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [setupReady, refreshKey]);

  // A piece opened from «Сегодня» («Нет подходящих? Найдём дешевле») comes first.
  const gaps = useMemo(() => {
    const list = cache?.result?.items || [];
    return focus ? [{ item: focus.label, part: focus.part, color: focus.color, query: focus.query, pairsWith: [], priority: "medium", why: "Похожие вещи — новые и б/у.", focus: true }, ...list] : list;
  }, [cache, focus]);
  const gap = gaps[Math.min(selected, gaps.length - 1)] || null;
  const query = gap ? gap.query || gap.item : "";
  const stores = STORES.filter((s) => filter === "all" || s.cond === filter);

  return (
    <section className="screen shopping">
      <h1 className="screen-title rise">Покупки</h1>

      <div className="hero-card rise" style={{ animationDelay: ".04s" }}>
        <div className="hero-card__text">
          <span className="hero-card__label">Сэкономлено {inMonth()}</span>
          <span className="hero-card__value">€0</span>
          <span className="hero-card__label">Скоро: сравним цены с доставкой и покажем лучшую</span>
        </div>
        <span className="hero-card__icon"><Icon name="trend" size={26} /></span>
      </div>

      <div className="section-head">
        <span className="section-title">Чего не хватает капсуле</span>
        {cache && !busy ? <button type="button" className="text-button" onClick={load} disabled={!setupReady}><Icon name="refresh" size={14} width={2} /> обновить</button> : <span className="tiny-text">по твоему гардеробу</span>}
      </div>

      {error === "setup" || !setupReady ? (
        <div className="info-card rise"><span>Чтобы стилист нашёл, чего не хватает, нужен код доступа.</span><button type="button" className="btn btn--dark btn--small" onClick={onOpenAccess}>Ввести код</button></div>
      ) : busy && !gaps.length ? (
        <div className="gap-row">{[0, 1, 2].map((i) => <span key={i} className="gap-card shimmer gap-card--skeleton" />)}</div>
      ) : !gaps.length ? (
        <div className="info-card rise">
          <span>{items.length < 2 ? "Добавь хотя бы пару вещей — и стилист подскажет, что докупить." : error || "Нажми, чтобы стилист проверил гардероб."}</span>
          {items.length >= 2 && <button type="button" className="btn btn--dark btn--small" onClick={load}>Проверить</button>}
        </div>
      ) : (
        <div className="gap-row" role="group" aria-label="Чего не хватает">
          {gaps.map((g, i) => (
            <button type="button" key={`${g.item}-${i}`} className={`gap-card rise${i === selected ? " is-on" : ""}`} style={{ animationDelay: `${i * 0.05}s` }} aria-pressed={i === selected} onClick={() => setSelected(i)}>
              <span className="gap-card__icon"><GarmentIcon item={g} size={52} /></span>
              <span className="gap-card__name">{g.item}</span>
              <span className="gap-card__impact">{g.focus ? "из образа" : impact(g, items)}</span>
            </button>
          ))}
          {busy && <span className="gap-card gap-card--busy"><Spinner label="Обновляю" /></span>}
        </div>
      )}
      {gap?.why && <p className="muted-text gap-why fade" key={gap.item}>{gap.why}</p>}
      {error && error !== "setup" && gaps.length > 0 && <p className="error-text">{error}</p>}

      {gap && (
        <>
          <div className="section-head">
            <div className="filter-row" role="group" aria-label="Состояние">
              {FILTERS.map((f) => <button type="button" key={f.id} className={`filter-pill${filter === f.id ? " is-on" : ""}`} aria-pressed={filter === f.id} onClick={() => setFilter(f.id)}>{f.label}</button>)}
            </div>
            <span className="tiny-text">Бельгия</span>
          </div>
          <div className="offer-list" key={`${query}-${filter}`}>
            {stores.map((s, i) => (
              <a key={s.id} className={`offer rise${i === 0 ? " is-best" : ""}`} style={{ animationDelay: `${i * 0.06}s` }} href={s.url(query)} target="_blank" rel="noopener noreferrer">
                <span className="offer__icon"><GarmentIcon item={gap} size={38} /></span>
                <span className="offer__text">
                  <span className="offer__title"><span className="strong-text">{s.name}</span><span className="tag tag--small">{s.cond === "new" ? "Новое" : "Б/у"}</span></span>
                  <span className="tiny-text">{s.note}</span>
                </span>
                <span className="offer__go"><Icon name="external" size={18} width={2} /></span>
              </a>
            ))}
          </div>
          <p className="tiny-text center-text">Ищем «{query}». Цены с доставкой и бейдж лучшей цены появятся в следующем обновлении.</p>
        </>
      )}
    </section>
  );
}
