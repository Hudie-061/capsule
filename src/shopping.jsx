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
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { chainLinks, chainOffers, offerFallback, queryGender, searchChains, shopOrder, shopQueryFor, zalandoSearch } from "./lib/chains.js";
import { COUNTRIES, countryById, money, storeLinks } from "./lib/countries.js";
import { kv } from "./lib/db.js";
import { getGapsCache, getPalette, inMonth, saveGapsCache } from "./lib/daily.js";
import { kindOf } from "./lib/kinds.js";
import { bodyOrProfile, getBody, sizeForKind, sizeOptions, sizePick, sizeSystem } from "./lib/sizes.js";
import { splitList } from "./lib/style-options.js";
import { SetupError, offerLinkTask, pricesTask } from "./lib/gemini.js";
import { plural } from "./lib/plural.js";
import { addPurchase, getFeedback, getLearned, getProfile, getPurchases, getSettings, saveSettings } from "./lib/settings.js";
import { findGaps } from "./lib/stylist.js";
import { GarmentIcon, Icon, Sheet, Spinner, isDressItem } from "./ui.jsx";

// The refresh sheet: what to look for, the budget per piece and the mood. Ids match the Worker.
const WISH_CATEGORIES = [["jeans", "Джинсы"], ["trousers", "Брюки"], ["tees", "Футболки"], ["shirts", "Рубашки"], ["knit", "Свитеры и худи"], ["blazers", "Пиджаки"], ["outer", "Куртки и пальто"], ["shoes", "Обувь"], ["accessories", "Аксессуары"]];
const BUDGETS = [30, 50, 100, 0];
const MOODS = [["basic", "Базовое, ко всему"], ["statement", "Что-то интереснее"], ["", "Как решит стилист"]];

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
  const [fit, setFit] = useState({ body: null, oversize: false, gender: "" });
  const [chosenSizes, setChosenSizes] = useState({});
  const [sizeOpen, setSizeOpen] = useState(false);
  const [wishes, setWishes] = useState({ categories: [], budget: 50, style: "", note: "" });
  const [wishOpen, setWishOpen] = useState(false);
  const [dismissed, setDismissed] = useState([]);
  const [alts, setAlts] = useState({ key: null, status: "idle", items: [] }); // «Подберём другую» from «Сегодня»
  const rowRef = useRef(null);
  const [edges, setEdges] = useState({ left: false, right: false });
  const [sizeOn, setSizeOn] = useState(true);
  const [saleOnly, setSaleOnly] = useState(false); // Black Friday: only discounted offers
  const [direct, setDirect] = useState({}); // offer id → the product page on the shop's site
  const [opening, setOpening] = useState("");
  const [blocked, setBlocked] = useState("");

  useEffect(() => {
    getSettings().then((s) => { setCountry(s.country); setSizeOn(s.sizeInSearch); setSaleOnly(s.saleOnly); setChosenSizes(s.chosenSizes); setWishes(s.gapWishes); setDismissed(s.gapsDismissed); });
    getPurchases().then(setPurchases);
    Promise.all([getBody(), getProfile()]).then(([body, profile]) => setFit({ body: bodyOrProfile(body, profile), oversize: splitList(profile.fits).includes("Оверсайз"), gender: profile.gender || "" }));
  }, []);

  // What the stylist knows beyond the wardrobe: the wishes from the refresh sheet, what it suggested
  // before (so a refresh brings new pieces), what was closed with × and what was bought.
  const load = useCallback(async (w = wishes) => {
    setBusy(true); setError("");
    try {
      const settings = await getSettings();
      const result = await findGaps({
        items, profile: await getProfile(), feedback: await getFeedback(), learned: await getLearned(), palette: (await getPalette())?.result || null,
        wishes: w, shown: settings.gapsSeen.slice(0, 18), dismissed: settings.gapsDismissed.slice(0, 30),
        bought: (await getPurchases()).map((p) => p.gap).filter(Boolean).slice(-10),
      });
      setCache(await saveGapsCache(result, items.length));
      setSelected(0);
      const nextSeen = [...new Set([...(result.items || []).map((g) => g.item), ...settings.gapsSeen])].slice(0, 24);
      await saveSettings({ gapsSeen: nextSeen });
    } catch (e) {
      setError(e instanceof SetupError ? "setup" : e.message);
    } finally {
      setBusy(false);
    }
  }, [items, wishes]);

  // The budget row: one tap, saved for next time; the offers and the Zalando link follow it.
  const chooseBudget = async (b) => {
    const next = { ...wishes, budget: b, budgetSet: true };
    setWishes(next);
    setBought("");
    await saveSettings({ gapWishes: next });
  };

  const runWishes = async (w) => {
    w = { ...w, budgetSet: true };
    setWishOpen(false);
    setWishes(w);
    await saveSettings({ gapWishes: w });
    load(w);
  };

  // × on a card: never suggest this piece again.
  const dismiss = async (g) => {
    const next = [g.item, ...dismissed.filter((x) => x !== g.item)].slice(0, 30);
    setDismissed(next);
    await saveSettings({ gapsDismissed: next });
    if (cache?.result?.items) {
      setCache(await saveGapsCache({ ...cache.result, items: cache.result.items.filter((x) => x.item !== g.item) }, cache.itemCount));
      setSelected(0);
    }
  };

  // On a computer the row of cards scrolls with the mouse wheel and the arrows.
  const updateEdges = () => {
    const el = rowRef.current;
    if (el) setEdges({ left: el.scrollLeft > 4, right: el.scrollLeft + el.clientWidth < el.scrollWidth - 4 });
  };
  const scrollGaps = (dir) => rowRef.current?.scrollBy({ left: dir * rowRef.current.clientWidth * 0.8, behavior: "smooth" });
  useEffect(() => {
    const el = rowRef.current;
    if (!el) return undefined;
    updateEdges();
    const onWheel = (e) => {
      if (Math.abs(e.deltaY) <= Math.abs(e.deltaX) || el.scrollWidth <= el.clientWidth) return;
      const before = el.scrollLeft;
      el.scrollLeft += e.deltaY;
      if (el.scrollLeft !== before) e.preventDefault(); // at the ends the page scrolls as usual
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  });

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

  // «Нет подходящих? Подберём другую» on «Сегодня»: the stylist suggests 3 different pieces for that place in
  // the outfit (another colour or cut that suits the rest), shown first. Older links with a plain label still work.
  useEffect(() => {
    const r = focus?.replace;
    if (!r || !setupReady) return undefined;
    let alive = true;
    const key = JSON.stringify(r);
    setAlts({ key, status: "loading", items: [] });
    (async () => {
      try {
        const settings = await getSettings();
        const result = await findGaps({
          items, profile: await getProfile(), feedback: await getFeedback(), learned: await getLearned(), palette: (await getPalette())?.result || null,
          wishes: { ...settings.gapWishes, categories: [] }, dismissed: settings.gapsDismissed.slice(0, 30), replace: r,
        });
        if (alive) { setAlts({ key, status: "done", items: (result.items || []).slice(0, 3).map((g) => ({ ...g, focus: true, replaceOf: r.name })) }); setSelected(0); }
      } catch (e) {
        if (alive) setAlts({ key, status: "error", items: [], error: e.message });
      }
    })();
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focus, setupReady]);

  const gaps = useMemo(() => {
    const list = cache?.result?.items || [];
    if (focus?.replace) return [...alts.items, ...list];
    return focus?.label ? [{ item: focus.label, part: focus.part, kind: focus.kind, color: focus.color, query: focus.query, pairsWith: [], priority: "medium", why: "Похожие вещи — новые и б/у.", focus: true }, ...list] : list;
  }, [cache, focus, alts]);
  const altsLoading = Boolean(focus?.replace) && alts.status === "loading";
  const gap = gaps[Math.min(selected, gaps.length - 1)] || null;
  // The size for this kind of piece: the user's own pick in «Покупки» wins over the measurements.
  const sizeGender = fit.body?.gender || fit.gender;
  const system = gap ? sizeSystem(kindOf(gap), sizeGender) : null;
  const size = gap ? sizeForKind(kindOf(gap), fit.body, { oversize: fit.oversize, chosen: chosenSizes, gender: fit.gender }) : null;
  const options = system ? sizeOptions(system, sizeGender) : null;
  const pick = system ? sizePick(system, size) : null;
  // English only towards shops (the interface stays Russian); the person's gender is part of the query.
  const personGender = fit.body?.gender || fit.gender || "";
  const baseQuery = gap ? shopQueryFor(gap, personGender) : "";
  // «Популярные» searches each chain without the size: in Google Shopping "size 50" pulls in second-hand
  // listings that mention the size, and the chains show every size on the product page anyway.
  // «Все новые» and «Б/у» search all shops once, with the size when the chip is on.
  const mode = filter === "chains" ? "chains" : "all";
  const sized = mode === "all" && size && sizeOn;
  const query = sized ? `${baseQuery} ${size.query}` : baseQuery; // to the Worker
  const shownQuery = sized ? `${baseQuery} ${size.shown}` : baseQuery; // to the user and shop links
  const place = countryById(country);
  const currency = offers.data?.currency || place.currency;
  const gender = queryGender(baseQuery, personGender);

  // Offers for the selected piece in the selected country. A paid search runs only when the person taps
  // «Сравнить цены» (one search per shop, so tapping through the cards no longer spends the budget);
  // an answer from the last day is shown right away, and the filtered Zalando link is always there.
  const searchKey = gap && country ? offersKey(country, mode, query, saleOnly) + (wishes.budget ? `:max${wishes.budget}` : "") : "";
  const [askedKey, setAskedKey] = useState("");
  useEffect(() => {
    if (!query || !country || !setupReady || !gap) return undefined;
    let alive = true;
    const key = searchKey;
    (async () => {
      const saved = await kv.get(key, null);
      if (!alive) return;
      if (saved && Date.now() - Date.parse(saved.at) < DAY) { setOffers({ status: "done", data: saved, error: "" }); return; }
      if (pricesOff) { setOffers({ status: "off", data: null, error: "" }); return; }
      if (askedKey !== key) { setOffers({ status: "idle", data: null, error: "" }); return; }
      setOffers({ status: "loading", data: null, error: "" });
      try {
        const want = { name: gap.item, kind: kindOf(gap), color: gap.color, gender: personGender };
        const data = await pricesTask({ query, country, want, sale: saleOnly, maxPrice: wishes.budget || 0, chains: mode === "chains" ? searchChains(gap) : [] });
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
  }, [searchKey, askedKey, setupReady, pricesOff]);

  const list = useMemo(() => {
    const all = offers.data?.offers || [];
    if (filter === "chains") return chainOffers(all);
    const same = all.filter((o) => o.condition === filter).slice(0, 12);
    return filter === "new" ? shopOrder(same) : same; // second-hand stays cheapest first
  }, [offers.data, filter]);
  const maxTotal = list.length ? Math.max(...list.map((o) => o.total)) : 0;
  // The cheapest offer gets «Лучшая цена», wherever Zalando-first ordering puts it.
  const best = list.reduce((a, b) => (!a || b.total < a.total ? b : a), null);
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
    try { link = (await offerLinkTask({ token: offer.token, store: offer.store, chain: offer.chain || "" })).link || ""; } catch { /* the chain's search instead */ }
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

  // Picking a size: one tap saves it for every piece of the same size system.
  const chooseSize = async (value) => {
    const next = { ...chosenSizes };
    if (value === null) delete next[system];
    else next[system] = value;
    setChosenSizes(next);
    setBought("");
    await saveSettings({ chosenSizes: next });
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
  // Zalando's link carries the filters: the person's size, cheapest first, sale only and the budget.
  const linkCountry = country || "be";
  const linkFilters = { size: system && pick != null ? { system, pick } : null, sale: saleOnly, budget: wishes.budget || 0 };
  const zalando = gap ? zalandoSearch(linkCountry, baseQuery, { gender, ...linkFilters }) : null;
  const links = filter === "used"
    ? storeLinks(linkCountry).filter((s) => s.cond === "used").map((s) => ({ ...s, href: s.url(shownQuery) }))
    : [
      ...chainLinks(linkCountry, baseQuery, { shoes: gap?.part === "shoes", gender, filters: linkFilters }).map((c) => ({ ...c, cond: "new", href: c.url, note: c.own ? "Поиск прямо на сайте магазина" : "Поиск Google по сайту магазина" })),
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
        {cache && !busy ? <button type="button" className="text-button" onClick={() => setWishOpen(true)} disabled={!setupReady} aria-haspopup="dialog"><Icon name="refresh" size={14} width={2} /> обновить</button> : <span className="tiny-text">по твоему гардеробу</span>}
      </div>

      {error === "setup" || !setupReady ? (
        <div className="info-card rise"><span>Чтобы стилист нашёл, чего не хватает, нужен код доступа.</span><button type="button" className="btn btn--dark btn--small" onClick={onOpenAccess}>Ввести код</button></div>
      ) : busy && !gaps.length ? (
        <div className="gap-row">{[0, 1, 2].map((i) => <span key={i} className="gap-card shimmer gap-card--skeleton" />)}</div>
      ) : !gaps.length ? (
        <div className="info-card rise">
          <span>{items.length < 2 ? "Добавь хотя бы пару вещей — и стилист подскажет, что докупить." : error || "Нажми, чтобы стилист проверил гардероб."}</span>
          {items.length >= 2 && <button type="button" className="btn btn--dark btn--small" onClick={() => setWishOpen(true)}>Проверить</button>}
        </div>
      ) : (
        <div className="gap-scroll">
          {edges.left && <button type="button" className="gap-arrow gap-arrow--left" onClick={() => scrollGaps(-1)} aria-label="Прокрутить назад"><Icon name="back" size={16} width={2.4} /></button>}
          <div className="gap-row" role="group" aria-label="Чего не хватает" ref={rowRef} onScroll={updateEdges}>
            {altsLoading && [0, 1, 2].map((i) => <span key={`alt-${i}`} className="gap-card shimmer gap-card--skeleton" aria-label="Подбираю другую вещь" />)}
            {gaps.map((g, i) => (
              <div className="gap-slot rise" key={`${g.item}-${i}`} style={{ animationDelay: `${i * 0.05}s` }}>
                <button type="button" className={`gap-card${i === selected ? " is-on" : ""}`} aria-pressed={i === selected} onClick={() => { setSelected(i); setBought(""); }}>
                  <span className="gap-card__icon"><GarmentIcon item={g} size={52} /></span>
                  <span className="gap-card__name">{g.item}</span>
                  <span className="gap-card__impact">{g.replaceOf ? "вместо твоей" : g.focus ? "из образа" : impact(g, items)}</span>
                </button>
                {!g.focus && <button type="button" className="gap-card__x" onClick={() => dismiss(g)} aria-label={`Больше не предлагать: ${g.item}`} title="Больше не предлагать"><Icon name="close" size={12} width={2.6} /></button>}
              </div>
            ))}
            {busy && <span className="gap-card gap-card--busy"><Spinner label="Обновляю" /></span>}
          </div>
          {edges.right && <button type="button" className="gap-arrow gap-arrow--right" onClick={() => scrollGaps(1)} aria-label="Прокрутить вперёд"><Icon name="chevron" size={16} width={2.4} /></button>}
        </div>
      )}
      {altsLoading && <p className="muted-text gap-why">Подбираю другую вещь вместо «{focus.replace.name}» — под остальной образ…</p>}
      {focus?.replace && alts.status === "error" && <p className="error-text">{alts.error}</p>}
      {gap?.why && !altsLoading && <p className="muted-text gap-why fade" key={gap.item}>{gap.replaceOf ? `Вместо «${gap.replaceOf}»: ${gap.why}` : gap.why}</p>}
      {gap && system && (
        <div className="my-size fade" key={`size-${gap.item}`}>
          <button type="button" className={`my-size__chip${size ? " is-on" : ""}`} onClick={() => setSizeOpen(true)} aria-haspopup="dialog">
            <Icon name="ruler" size={14} width={2.2} />
            <span>{size ? <>Мой размер <b>{size.value}</b></> : "Выбрать размер"}</span>
            <Icon name="chevron" size={14} width={2.2} />
          </button>
          <span className="tiny-text">
            {size
              ? [size.detail, size.chosen ? "твой выбор" : size.estimated ? "по оценке" : "по меркам", mode === "chains" ? "выбери его на сайте магазина" : sizeOn ? "ищу его" : "ищу все размеры"].filter(Boolean).join(" · ")
              : "нажми, чтобы искать вещи твоего размера"}
          </span>
          {size?.note && <span className="size-card__note my-size__note">{size.note}</span>}
        </div>
      )}
      {gap && (
        <div className={`budget-row fade${wishes.budgetSet ? "" : " is-asking"}`} role="group" aria-label="Бюджет на вещь">
          <span className="budget-row__label">{wishes.budgetSet ? "Бюджет на вещь" : "Сколько готов потратить на вещь?"}</span>
          <div className="budget-row__chips">
            {BUDGETS.map((b) => (
              <button type="button" key={b} className={`budget-chip${wishes.budgetSet && wishes.budget === b ? " is-on" : ""}`} aria-pressed={wishes.budgetSet && wishes.budget === b} onClick={() => chooseBudget(b)}>
                {b ? `до ${money(b, currency)}` : "любой"}
              </button>
            ))}
          </div>
        </div>
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

          {zalando && filter !== "used" && (
            <a className="zalando-card rise" href={zalando} target="_blank" rel="noopener noreferrer">
              <span className="zalando-card__logo" aria-hidden="true">Z</span>
              <span className="zalando-card__text">
                <span className="strong-text">Открыть на Zalando — сразу отфильтровано</span>
                <span className="tiny-text">{[size ? `твой размер ${size.value}` : "все размеры", "сначала дешёвые", saleOnly ? "только скидки" : "", wishes.budget ? `до ${money(wishes.budget, currency)}` : ""].filter(Boolean).join(" · ")}</span>
              </span>
              <Icon name="external" size={18} width={2} />
            </a>
          )}

          {offers.status === "idle" && (
            <div className="price-cta">
              <button type="button" className="btn btn--dark btn--block" onClick={() => setAskedKey(searchKey)}>
                <Icon name="bag" size={18} width={2} /> {mode === "chains" ? `Сравнить цены в ${searchChains(gap).length} магазинах` : "Найти цены во всех магазинах"}
              </button>
              <span className="tiny-text">{mode === "chains" ? `${searchChains(gap).length} поисков` : "1 поиск"} из общего лимита · ответ хранится сутки · ссылка Zalando выше — бесплатно</span>
            </div>
          )}

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
                    <div key={id} className={`offer rise${o === best ? " is-best" : ""}`} style={{ animationDelay: `${i * 0.05}s` }}>
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
                          {o === best && bestSaving > 0 && <span className="badge-best">Лучшая · −{money(bestSaving, currency)}</span>}
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

          {(offers.status === "off" || offers.status === "error" || offers.status === "done" || offers.status === "idle") && (
            <>
              {(offers.status === "off" || offers.status === "error" || (offers.status === "done" && !list.length)) && (
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
              {((offers.status === "done" && list.length > 0) || offers.status === "idle") && links.length > 0 && (
                <div className="more-links">
                  <span className="tiny-text">{filter === "used" ? "Поискать ещё:" : "Искать на сайтах:"}</span>
                  {links.map((s) => <a key={s.id} className="filter-pill" href={s.href} target="_blank" rel="noopener noreferrer">{s.name}</a>)}
                </div>
              )}
              <p className="tiny-text center-text">
                {offers.status === "off" ? `Ищем «${shownQuery}». Сравнение цен с доставкой включится, когда владелец подключит поиск.` : offers.status === "done" || offers.status === "idle" ? `«${shownQuery}» · ${place.name}${filter === "chains" ? " · до 2 вещей из магазина" : ""}${saleOnly ? " · только скидки" : ""}${offers.data?.cached ? " · сохранено на сутки" : ""}` : `Ищем «${shownQuery}» по ссылкам.`}
              </p>
            </>
          )}
        </>
      )}

      <Sheet open={wishOpen} onClose={() => setWishOpen(false)} title="Что подобрать?" subtitle="Стилист учтёт гардероб, палитру и то, что ты уже видел или убрал ×">
        <WishForm initial={wishes} currency={currency} onSubmit={runWishes} />
      </Sheet>

      <Sheet open={sizeOpen && Boolean(options)} onClose={() => setSizeOpen(false)} title="Твой размер" subtitle={gap ? `${gap.item} · один выбор для всех таких вещей` : ""}>
        {options && (
          <div className="size-picker">
            <span className="section-label">{options.label}</span>
            <div className="chip-row">
              {options.main.map((v) => {
                const on = system === "wl" ? pick?.w === v : pick === v;
                return (
                  <button type="button" key={v} className={`chip size-chip${on ? " is-on" : ""}`} aria-pressed={on}
                    onClick={() => chooseSize(system === "wl" ? { w: v, l: pick?.l || 32 } : v)}>{v}</button>
                );
              })}
            </div>
            {options.second && (
              <>
                <span className="section-label">{options.secondLabel}</span>
                <div className="chip-row">
                  {options.second.map((v) => {
                    const on = pick?.l === v;
                    return <button type="button" key={v} className={`chip size-chip${on ? " is-on" : ""}`} aria-pressed={on} onClick={() => chooseSize({ w: pick?.w || 32, l: v })}>{v}</button>;
                  })}
                </div>
              </>
            )}
            {size?.chosen && (
              <button type="button" className="text-button size-picker__reset" onClick={() => chooseSize(null)}>
                {size.suggested ? `Вернуть размер по меркам — ${size.suggested}` : "Сбросить мой выбор"}
              </button>
            )}
            <label className="size-picker__switch">
              <input type="checkbox" checked={sizeOn} onChange={toggleSize} />
              <span>Добавлять размер в поиск «Все новые» и «Б/у»<small>в «Популярных» размер выбирается на сайте магазина</small></span>
            </label>
            {onOpenSizes && <button type="button" className="text-button" onClick={() => { setSizeOpen(false); onOpenSizes(); }}><Icon name="ruler" size={14} width={2} /> Посчитать по меркам</button>}
          </div>
        )}
      </Sheet>

      <Sheet open={countryOpen} onClose={() => setCountryOpen(false)} title="Где искать" subtitle="Страна для цен, доставки и сайтов б/у">
        <div className="chip-row">
          {COUNTRIES.map((c) => <button type="button" key={c.id} className={`chip${c.id === country ? " is-on" : ""}`} aria-pressed={c.id === country} onClick={() => chooseCountry(c.id)}>{c.id === country && <Icon name="check" size={14} width={2.6} />}{c.name}</button>)}
        </div>
      </Sheet>
    </section>
  );
}

// The refresh sheet: a few taps that steer «Чего не хватает». Nothing chosen = the stylist decides.
function WishForm({ initial, currency, onSubmit }) {
  const [w, setW] = useState(initial);
  useEffect(() => setW(initial), [initial]);
  const toggle = (id) => setW((cur) => ({ ...cur, categories: cur.categories.includes(id) ? cur.categories.filter((x) => x !== id) : [...cur.categories, id] }));
  return (
    <div className="wish-form">
      <span className="section-label">Что хочешь докупить</span>
      <div className="chip-row">
        {WISH_CATEGORIES.map(([id, label]) => {
          const on = w.categories.includes(id);
          return <button type="button" key={id} className={`chip${on ? " is-on" : ""}`} aria-pressed={on} onClick={() => toggle(id)}>{on && <Icon name="check" size={14} width={2.6} />}{label}</button>;
        })}
      </div>
      <span className="tiny-text">{w.categories.length ? "Подберу только из этого" : "Ничего не выбрано — стилист решит сам"}</span>
      <span className="section-label">Бюджет на одну вещь</span>
      <div className="chip-row">
        {BUDGETS.map((b) => <button type="button" key={b} className={`chip${w.budget === b ? " is-on" : ""}`} aria-pressed={w.budget === b} onClick={() => setW((cur) => ({ ...cur, budget: b }))}>{b ? `до ${money(b, currency)}` : "Не важно"}</button>)}
      </div>
      <span className="section-label">Настроение</span>
      <div className="chip-row">
        {MOODS.map(([id, label]) => <button type="button" key={id || "any"} className={`chip${w.style === id ? " is-on" : ""}`} aria-pressed={w.style === id} onClick={() => setW((cur) => ({ ...cur, style: id }))}>{label}</button>)}
      </div>
      <label className="field-v2 wish-form__note">
        <span>Своими словами <small>необязательно</small></span>
        <input value={w.note} maxLength={120} placeholder="например: для офиса, без ярких цветов" onChange={(e) => { const note = e.target.value; setW((cur) => ({ ...cur, note })); }} />
      </label>
      <button type="button" className="btn btn--dark btn--block btn--tall" onClick={() => onSubmit(w)}><Icon name="refresh" size={18} width={2.2} /> Подобрать</button>
    </div>
  );
}
