// «Покупки» (design/V2-Shopping.dc.html) — the owner's main bet: dress well and save money.
// 1. What the capsule is missing comes from the `gaps` task, with "+N образов" counted on the device.
// 2. For the selected piece the `prices` task finds offers in the chosen country (Google Shopping via
//    SerpApi), sorted by price with delivery, with a "best price" badge. «Популярные» (default) keeps
//    only mass-market chains (src/lib/chains.js), at most 2 per chain and 10 in all. Tapping an offer
//    asks the `offer` task for the product page on the shop's own site (Google's own product links
//    often open empty); without it the link goes to the chain's search for that product.
//    Each chain also gets a free search link on its own site. Until the owner adds the search key,
//    the screen honestly falls back to those links.
// 3. «Купил здесь» records a purchase; the saving vs the most expensive offer adds up for the month.
// 4. «Мой размер»: the size for this kind of piece (from «Мерки и размеры», or estimated from the
//    profile's height and weight) is added to the search; the chip turns it off.
import { useCallback, useEffect, useMemo, useState } from "react";
import { chainLinks, chainOffers, offerFallback, queryGender, searchChains } from "./lib/chains.js";
import { COUNTRIES, countryById, money, storeLinks } from "./lib/countries.js";
import { kv } from "./lib/db.js";
import { getGapsCache, inMonth, saveGapsCache } from "./lib/daily.js";
import { kindOf } from "./lib/kinds.js";
import { bodyOrProfile, getBody, sizeForKind } from "./lib/sizes.js";
import { splitList } from "./lib/style-options.js";
import { SetupError, offerLinkTask, pricesTask } from "./lib/gemini.js";
import { plural } from "./lib/plural.js";
import { addPurchase, getFeedback, getLearned, getProfile, getPurchases, getSettings, saveSettings } from "./lib/settings.js";
import { findGaps } from "./lib/stylist.js";
import { GarmentIcon, Icon, Sheet, Spinner, isDressItem } from "./ui.jsx";

const FILTERS = [{ id: "chains", label: "Популярные" }, { id: "new", label: "Все новые" }, { id: "used", label: "Б/у" }];
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

const idOf = (offer) => offer.id || offer.link;
const discount = (offer) => (offer.oldPrice > offer.price ? Math.round((1 - offer.price / offer.oldPrice) * 100) : 0);

const deliveryText = (offer, currency) => (offer.delivery === 0 ? "Бесплатная доставка" : offer.delivery ? `+${money(offer.delivery, currency)} доставка` : "Доставка уточняется на сайте");

// Offers are kept on the device for a day, so going back and forth costs nothing.
// v3: «Популярные» and «все магазины» are separate searches, checked for the right type of piece.
const offersKey = (country, mode, query, sale) => `offers4:${country}:${mode}${sale ? ":sale" : ""}:${query.toLowerCase()}`;

export function ShoppingView({ items, setupReady, focus, refreshKey, onOpenAccess, onOpenSizes }) {
  const [cache, setCache] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [selected, setSelected] = useState(0);
  const [filter, setFilter] = useState("chains");
  const [country, setCountry] = useState(null);
  const [countryOpen, setCountryOpen] = useState(false);
  const [offers, setOffers] = useState({ status: "idle", data: null, error: "" });
  const [pricesOff, setPricesOff] = useState(false);
  const [purchases, setPurchases] = useState([]);
  const [bought, setBought] = useState("");
  const [fit, setFit] = useState({ body: null, oversize: false });
  const [sizeOn, setSizeOn] = useState(true);
  const [saleOnly, setSaleOnly] = useState(false); // Black Friday: only discounted offers
  const [direct, setDirect] = useState({}); // offer id → the product page on the shop's site
  const [opening, setOpening] = useState("");
  const [blocked, setBlocked] = useState("");

  useEffect(() => {
    getSettings().then((s) => { setCountry(s.country); setSizeOn(s.sizeInSearch); setSaleOnly(s.saleOnly); });
    getPurchases().then(setPurchases);
    Promise.all([getBody(), getProfile()]).then(([body, profile]) => setFit({ body: bodyOrProfile(body, profile), oversize: splitList(profile.fits).includes("Оверсайз") }));
  }, []);

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
    return focus ? [{ item: focus.label, part: focus.part, kind: focus.kind, color: focus.color, query: focus.query, pairsWith: [], priority: "medium", why: "Похожие вещи — новые и б/у.", focus: true }, ...list] : list;
  }, [cache, focus]);
  const gap = gaps[Math.min(selected, gaps.length - 1)] || null;
  const size = gap ? sizeForKind(kindOf(gap), fit.body, { oversize: fit.oversize }) : null;
  const sizable = gap ? Boolean(sizeForKind(kindOf(gap), { height: 175 })) : false;
  const baseQuery = gap ? gap.query || gap.item : "";
  // «Популярные» searches each chain without the size: in Google Shopping "size 50" pulls in second-hand
  // listings that mention the size, and the chains show every size on the product page anyway.
  // «Все новые» and «Б/у» search all shops once, with the size when the chip is on.
  const mode = filter === "chains" ? "chains" : "all";
  const sized = mode === "all" && size && sizeOn;
  const query = sized ? `${baseQuery} ${size.query}` : baseQuery; // to the Worker
  const shownQuery = sized ? `${baseQuery} ${size.shown}` : baseQuery; // to the user and shop links
  const place = countryById(country);
  const currency = offers.data?.currency || place.currency;
  const gender = queryGender(baseQuery, fit.body?.gender);

  // Offers for the selected piece in the selected country. «Популярные» spends one search per chain
  // (cached for a day); the search in all shops runs only when «Все новые» or «Б/у» is opened.
  useEffect(() => {
    if (!query || !country || !setupReady || !gap) return undefined;
    let alive = true;
    const key = offersKey(country, mode, query, saleOnly);
    (async () => {
      const saved = await kv.get(key, null);
      if (!alive) return;
      if (saved && Date.now() - Date.parse(saved.at) < DAY) { setOffers({ status: "done", data: saved, error: "" }); return; }
      if (pricesOff) { setOffers({ status: "off", data: null, error: "" }); return; }
      setOffers({ status: "loading", data: null, error: "" });
      try {
        const want = { name: gap.item, kind: kindOf(gap), color: gap.color };
        const data = await pricesTask({ query, country, want, sale: saleOnly, chains: mode === "chains" ? searchChains(gap) : [] });
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, mode, country, setupReady, pricesOff, saleOnly]);

  const list = useMemo(() => {
    const all = offers.data?.offers || [];
    return filter === "chains" ? chainOffers(all) : all.filter((o) => o.condition === filter).slice(0, 12);
  }, [offers.data, filter]);
  const maxTotal = list.length ? Math.max(...list.map((o) => o.total)) : 0;
  const best = list[0];
  const bestSaving = best ? Math.round(maxTotal - best.total) : 0;

  const thisMonth = new Date().toISOString().slice(0, 7);
  const monthPurchases = purchases.filter((p) => String(p.at).startsWith(thisMonth) && p.currency === currency);
  const saved = monthPurchases.reduce((sum, p) => sum + (p.saving || 0), 0);

  const markBought = async (offer) => {
    const all = offers.data?.offers || [];
    const top = all.length ? Math.max(...all.map((o) => o.total)) : offer.total;
    const next = await addPurchase({ title: offer.title, store: offer.store, link: direct[idOf(offer)] || "", total: offer.total, maxTotal: top, saving: Math.max(0, Math.round((top - offer.total) * 100) / 100), currency, gap: gap?.item || "" });
    setPurchases([...next]);
    setBought(idOf(offer));
  };

  // The first tap asks the Worker for the shop's own product page (one search, cached for a week),
  // then opens it. If the browser blocks a tab opened after the wait, the card's link already points
  // there, so a second tap opens it.
  const openOffer = async (event, offer) => {
    const id = idOf(offer);
    if (direct[id] || !offer.token) return; // the link itself goes to the shop
    event.preventDefault();
    if (opening) return;
    setOpening(id);
    setBlocked("");
    let link = "";
    try { link = (await offerLinkTask({ token: offer.token, store: offer.store })).link || ""; } catch { /* the chain's search instead */ }
    const target = link || offerFallback(offer, country || "be", gender);
    setDirect((d) => ({ ...d, [id]: target }));
    setOpening("");
    const tab = window.open(target, "_blank");
    if (!tab) { setBlocked(id); return; }
    try { tab.opener = null; } catch { /* already another site */ }
  };

  const toggleSale = async () => {
    const next = !saleOnly;
    setSaleOnly(next);
    setBought("");
    await saveSettings({ saleOnly: next });
  };

  const toggleSize = async () => {
    const next = !sizeOn;
    setSizeOn(next);
    setBought("");
    await saveSettings({ sizeInSearch: next });
  };

  const chooseCountry = async (id) => {
    setCountryOpen(false);
    setCountry(id);
    await saveSettings({ country: id });
  };

  // Free links: search on the chains' own sites (or second-hand sites for «Б/у»), plus Google Shopping.
  const linkCountry = country || "be";
  const links = filter === "used"
    ? storeLinks(linkCountry).filter((s) => s.cond === "used").map((s) => ({ ...s, href: s.url(shownQuery) }))
    : [
      ...chainLinks(linkCountry, baseQuery, { shoes: gap?.part === "shoes", gender }).map((c) => ({ ...c, cond: "new", href: c.url, note: c.own ? "Поиск прямо на сайте магазина" : "Поиск Google по сайту магазина" })),
      ...storeLinks(linkCountry).filter((s) => s.cond === "new").map((s) => ({ ...s, href: s.url(shownQuery) })),
    ];

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
      {gap && size && (
        <div className="my-size fade" key={`size-${gap.item}`}>
          <button type="button" className={`my-size__chip${sizeOn ? " is-on" : ""}`} aria-pressed={sizeOn} onClick={toggleSize}>
            {sizeOn && <Icon name="check" size={14} width={2.6} />}
            <span>Мой размер <b>{size.value}</b></span>
          </button>
          <span className="tiny-text">
            {[size.detail, size.estimated ? "по оценке" : "по меркам", mode === "chains" ? "выбери его на сайте магазина" : sizeOn ? "ищу его" : "ищу все размеры"].filter(Boolean).join(" · ")}
          </span>
          {size.note && <span className="size-card__note my-size__note">{size.note}</span>}
        </div>
      )}
      {gap && !size && sizable && onOpenSizes && (
        <button type="button" className="text-button my-size__add" onClick={onOpenSizes}><Icon name="ruler" size={14} width={2} /> Укажи рост и мерки — буду искать твой размер</button>
      )}
      {error && error !== "setup" && gaps.length > 0 && <p className="error-text">{error}</p>}

      {gap && (
        <>
          <div className="section-head">
            <div className="filter-row" role="group" aria-label="Состояние">
              {FILTERS.map((f) => <button type="button" key={f.id} className={`filter-pill${filter === f.id ? " is-on" : ""}`} aria-pressed={filter === f.id} onClick={() => setFilter(f.id)}>{f.label}</button>)}
            </div>
          </div>
          <div className="sale-row">
            <button type="button" className={`sale-chip${saleOnly ? " is-on" : ""}`} aria-pressed={saleOnly} onClick={toggleSale}>
              {saleOnly ? <Icon name="check" size={14} width={2.6} /> : <span aria-hidden="true">%</span>} Только со скидкой
            </button>
            <span className="tiny-text">цена с доставкой</span>
          </div>

          {offers.status === "loading" && (
            <div className="offer-list">{[0, 1, 2].map((i) => <span key={i} className="offer offer--skeleton shimmer" />)}</div>
          )}

          {offers.status === "done" && (
            list.length ? (
              <div className="offer-list" key={`${query}-${filter}-${country}`}>
                {list.map((o, i) => {
                  const id = idOf(o);
                  const off = discount(o);
                  return (
                    <div key={id} className={`offer rise${i === 0 ? " is-best" : ""}`} style={{ animationDelay: `${i * 0.05}s` }}>
                      <a className="offer__main" href={direct[id] || offerFallback(o, linkCountry, gender)} target="_blank" rel="noopener noreferrer" onClick={(e) => openOffer(e, o)} aria-busy={opening === id}>
                        <span className="offer__icon">{o.image ? <img src={o.image} alt="" loading="lazy" referrerPolicy="no-referrer" /> : <GarmentIcon item={gap} size={38} />}</span>
                        <span className="offer__text">
                          <span className="offer__title">
                            <span className="strong-text">{o.store}</span>
                            <span className="tag tag--small">{o.condition === "used" ? "Б/у" : "Новое"}</span>
                            {off > 0 && <span className="tag tag--small tag--sale">−{off}%</span>}
                          </span>
                          <span className="offer__name">{o.title}</span>
                          <span className={`tiny-text${blocked === id ? " offer__hint" : ""}`}>
                            {opening === id ? "Открываю сайт магазина…" : blocked === id ? "Ссылка готова — нажми ещё раз" : deliveryText(o, currency)}
                          </span>
                        </span>
                        <span className="offer__price">
                          {opening === id ? <Spinner label="Открываю" /> : <span className="offer__total">{money(o.total, currency)}</span>}
                          {off > 0 && opening !== id && <span className="offer__old">{money(o.oldPrice, currency)}</span>}
                          {i === 0 && bestSaving > 0 && <span className="badge-best">Лучшая · −{money(bestSaving, currency)}</span>}
                        </span>
                      </a>
                      <button type="button" className={`offer__bought${bought === id ? " is-on" : ""}`} onClick={() => markBought(o)} disabled={bought === id}>
                        {bought === id ? <><Icon name="check" size={14} width={2.4} /> Отмечено</> : "Купил здесь"}
                      </button>
                    </div>
                  );
                })}
              </div>
            ) : (
              <p className="muted-text">
                {saleOnly
                  ? "Со скидкой такой вещи сейчас не нашлось. Выключи «Только со скидкой» или поищи прямо на сайтах."
                  : filter === "chains"
                  ? "В популярных магазинах такой вещи не нашлось. Поищи прямо у них на сайте или посмотри «Все новые»."
                  : filter === "new" ? "Новых предложений нет — посмотри «Б/у» или сайты магазинов." : "Б/у предложений нет — поищи на сайтах ниже."}
              </p>
            )
          )}

          {offers.status === "error" && <p className="error-text">{offers.error}</p>}

          {(offers.status === "off" || offers.status === "error" || offers.status === "done") && (
            <>
              {(offers.status !== "done" || !list.length) && (
                <div className="offer-list">
                  {links.map((s, i) => (
                    <a key={s.id} className={`offer offer--link rise${i === 0 ? " is-best" : ""}`} style={{ animationDelay: `${i * 0.06}s` }} href={s.href} target="_blank" rel="noopener noreferrer">
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
              {offers.status === "done" && list.length > 0 && links.length > 0 && (
                <div className="more-links">
                  <span className="tiny-text">{filter === "used" ? "Поискать ещё:" : "Искать на сайтах:"}</span>
                  {links.map((s) => <a key={s.id} className="filter-pill" href={s.href} target="_blank" rel="noopener noreferrer">{s.name}</a>)}
                </div>
              )}
              <p className="tiny-text center-text">
                {offers.status === "off" ? `Ищем «${shownQuery}». Сравнение цен с доставкой включится, когда владелец подключит поиск.` : offers.status === "done" ? `«${shownQuery}» · ${place.name}${filter === "chains" ? " · до 2 вещей из магазина" : ""}${saleOnly ? " · только скидки" : ""}${offers.data?.cached ? " · сохранено на сутки" : ""}` : `Ищем «${shownQuery}» по ссылкам.`}
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
