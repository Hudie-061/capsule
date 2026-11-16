// «Покупки» (design/V2-Shopping.dc.html) — the owner's main bet: dress well and save money.
// 1. What the capsule is missing comes from the `gaps` task, with "+N образов" counted on the device.
// 2. For the selected piece the `prices` task finds offers in the chosen country (Google Shopping via
//    SerpApi), sorted by price with delivery, with a "best price" badge. Until the owner adds the
//    search key, the screen honestly falls back to search links in that country's shops.
// 3. «Купил здесь» records a purchase; the saving vs the most expensive offer adds up for the month.
import { useCallback, useEffect, useMemo, useState } from "react";
import { COUNTRIES, countryById, money, storeLinks } from "./lib/countries.js";
import { kv } from "./lib/db.js";
import { getGapsCache, inMonth, saveGapsCache } from "./lib/daily.js";
import { SetupError, pricesTask } from "./lib/gemini.js";
import { plural } from "./lib/plural.js";
import { addPurchase, getFeedback, getLearned, getProfile, getPurchases, getSettings, saveSettings } from "./lib/settings.js";
import { findGaps } from "./lib/stylist.js";
import { GarmentIcon, Icon, Sheet, Spinner, isDressItem } from "./ui.jsx";

const FILTERS = [{ id: "all", label: "Все" }, { id: "new", label: "Новые" }, { id: "used", label: "Б/у" }];
const PRIORITY = { high: "в первую очередь", medium: "желательно", low: "по желанию" };
const DAY = 24 * 60 * 60 * 1000;

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

const deliveryText = (offer, currency) => (offer.delivery === 0 ? "Бесплатная доставка" : offer.delivery ? `+${money(offer.delivery, currency)} доставка` : "Доставка уточняется на сайте");

// Offers are kept on the device for a day, so going back and forth costs nothing.
const offersKey = (country, query) => `offers:${country}:${query.toLowerCase()}`;

export function ShoppingView({ items, setupReady, focus, refreshKey, onOpenAccess }) {
  const [cache, setCache] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [selected, setSelected] = useState(0);
  const [filter, setFilter] = useState("all");
  const [country, setCountry] = useState(null);
  const [countryOpen, setCountryOpen] = useState(false);
  const [offers, setOffers] = useState({ status: "idle", data: null, error: "" });
  const [pricesOff, setPricesOff] = useState(false);
  const [purchases, setPurchases] = useState([]);
  const [bought, setBought] = useState("");

  useEffect(() => { getSettings().then((s) => setCountry(s.country)); getPurchases().then(setPurchases); }, []);

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
  const place = countryById(country);
  const currency = offers.data?.currency || place.currency;

  // Offers for the selected piece in the selected country.
  useEffect(() => {
    if (!query || !country || !setupReady) return undefined;
    let alive = true;
    const key = offersKey(country, query);
    (async () => {
      const saved = await kv.get(key, null);
      if (!alive) return;
      if (saved && Date.now() - Date.parse(saved.at) < DAY) { setOffers({ status: "done", data: saved, error: "" }); return; }
      if (pricesOff) { setOffers({ status: "off", data: null, error: "" }); return; }
      setOffers({ status: "loading", data: null, error: "" });
      try {
        const data = await pricesTask({ query, country });
        if (!alive) return;
        await kv.set(key, data);
        setOffers({ status: "done", data, error: "" });
      } catch (e) {
        if (!alive) return;
        if (e.code === "prices_not_configured") { setPricesOff(true); setOffers({ status: "off", data: null, error: "" }); }
        else setOffers({ status: "error", data: null, error: e.message });
      }
    })();
    return () => { alive = false; };
  }, [query, country, setupReady, pricesOff]);

  const list = useMemo(() => (offers.data?.offers || []).filter((o) => filter === "all" || o.condition === filter), [offers.data, filter]);
  const maxTotal = list.length ? Math.max(...list.map((o) => o.total)) : 0;
  const best = list[0];
  const bestSaving = best ? Math.round(maxTotal - best.total) : 0;

  const thisMonth = new Date().toISOString().slice(0, 7);
  const monthPurchases = purchases.filter((p) => String(p.at).startsWith(thisMonth) && p.currency === currency);
  const saved = monthPurchases.reduce((sum, p) => sum + (p.saving || 0), 0);

  const markBought = async (offer) => {
    const all = offers.data?.offers || [];
    const top = all.length ? Math.max(...all.map((o) => o.total)) : offer.total;
    const next = await addPurchase({ title: offer.title, store: offer.store, link: offer.link, total: offer.total, maxTotal: top, saving: Math.max(0, Math.round((top - offer.total) * 100) / 100), currency, gap: gap?.item || "" });
    setPurchases([...next]);
    setBought(offer.link);
  };

  const chooseCountry = async (id) => {
    setCountryOpen(false);
    setCountry(id);
    await saveSettings({ country: id });
  };

  const links = storeLinks(country || "be").filter((s) => filter === "all" || s.cond === filter);

  return (
    <section className="screen shopping">
      <div className="shop-head rise">
        <h1 className="screen-title">Покупки</h1>
        <button type="button" className="pill-chip" onClick={() => setCountryOpen(true)} aria-label={`Страна поиска: ${place.name}`}>
          <Icon name="map" size={16} width={2} /><span>{place.name}</span>
        </button>
      </div>

      <div className="hero-card rise" style={{ animationDelay: ".04s" }}>
        <div className="hero-card__text">
          <span className="hero-card__label">Сэкономлено {inMonth()}</span>
          <span className="hero-card__value">{money(saved, currency) || money(0, currency)}</span>
          <span className="hero-card__label">
            {monthPurchases.length ? `на ${monthPurchases.length} ${plural(monthPurchases.length, ["покупке", "покупках", "покупках"])} · сравнили цены с доставкой` : "Купил по лучшей цене — отметь, посчитаю экономию"}
          </span>
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
            <button type="button" key={`${g.item}-${i}`} className={`gap-card rise${i === selected ? " is-on" : ""}`} style={{ animationDelay: `${i * 0.05}s` }} aria-pressed={i === selected} onClick={() => { setSelected(i); setBought(""); }}>
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
            <span className="tiny-text">цена с доставкой</span>
          </div>

          {offers.status === "loading" && (
            <div className="offer-list">{[0, 1, 2].map((i) => <span key={i} className="offer offer--skeleton shimmer" />)}</div>
          )}

          {offers.status === "done" && (
            list.length ? (
              <div className="offer-list" key={`${query}-${filter}-${country}`}>
                {list.map((o, i) => (
                  <div key={o.link} className={`offer rise${i === 0 ? " is-best" : ""}`} style={{ animationDelay: `${i * 0.05}s` }}>
                    <a className="offer__main" href={o.link} target="_blank" rel="noopener noreferrer">
                      <span className="offer__icon">{o.image ? <img src={o.image} alt="" loading="lazy" referrerPolicy="no-referrer" /> : <GarmentIcon item={gap} size={38} />}</span>
                      <span className="offer__text">
                        <span className="offer__title"><span className="strong-text">{o.store}</span><span className="tag tag--small">{o.condition === "used" ? "Б/у" : "Новое"}</span></span>
                        <span className="offer__name">{o.title}</span>
                        <span className="tiny-text">{deliveryText(o, currency)}</span>
                      </span>
                      <span className="offer__price">
                        <span className="offer__total">{money(o.total, currency)}</span>
                        {i === 0 && bestSaving > 0 && <span className="badge-best">Лучшая · −{money(bestSaving, currency)}</span>}
                      </span>
                    </a>
                    <button type="button" className={`offer__bought${bought === o.link ? " is-on" : ""}`} onClick={() => markBought(o)} disabled={bought === o.link}>
                      {bought === o.link ? <><Icon name="check" size={14} width={2.4} /> Отмечено</> : "Купил здесь"}
                    </button>
                  </div>
                ))}
              </div>
            ) : <p className="muted-text">{filter === "all" ? "Ничего не нашлось. Попробуй другую вещь или страну." : "В этом фильтре пусто — посмотри «Все»."}</p>
          )}

          {offers.status === "error" && <p className="error-text">{offers.error}</p>}

          {(offers.status === "off" || offers.status === "error" || offers.status === "done") && (
            <>
              {offers.status !== "done" && (
                <div className="offer-list">
                  {links.map((s, i) => (
                    <a key={s.id} className={`offer offer--link rise${i === 0 ? " is-best" : ""}`} style={{ animationDelay: `${i * 0.06}s` }} href={s.url(query)} target="_blank" rel="noopener noreferrer">
                      <span className="offer__icon"><GarmentIcon item={gap} size={38} /></span>
                      <span className="offer__text">
                        <span className="offer__title"><span className="strong-text">{s.name}</span><span className="tag tag--small">{s.cond === "new" ? "Новое" : "Б/у"}</span></span>
                        <span className="tiny-text">{s.note}</span>
                      </span>
                      <span className="offer__go"><Icon name="external" size={18} width={2} /></span>
                    </a>
                  ))}
                </div>
              )}
              {offers.status === "done" && links.length > 0 && (
                <div className="more-links">
                  <span className="tiny-text">Поискать ещё:</span>
                  {links.map((s) => <a key={s.id} className="filter-pill" href={s.url(query)} target="_blank" rel="noopener noreferrer">{s.name}</a>)}
                </div>
              )}
              <p className="tiny-text center-text">
                {offers.status === "off" ? `Ищем «${query}». Сравнение цен с доставкой включится, когда владелец подключит поиск.` : offers.status === "done" ? `«${query}» · ${place.name}${offers.data?.cached ? " · сохранено на сутки" : ""}` : `Ищем «${query}» по ссылкам.`}
              </p>
            </>
          )}
        </>
      )}

      <Sheet open={countryOpen} onClose={() => setCountryOpen(false)} title="Где искать" subtitle="Страна для цен, доставки и сайтов б/у">
        <div className="chip-row">
          {COUNTRIES.map((c) => <button type="button" key={c.id} className={`chip${c.id === country ? " is-on" : ""}`} aria-pressed={c.id === country} onClick={() => chooseCountry(c.id)}>{c.id === country && <Icon name="check" size={14} width={2.6} />}{c.name}</button>)}
        </div>
      </Sheet>
    </section>
  );
}
