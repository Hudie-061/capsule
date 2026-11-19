// «Хочу купить» in «Гардероб»: clothes the person wants, taken from a photo they found (Pinterest, someone
// in the street). The photo goes to the same detection as the wardrobe import, with the person's own words
// («куртку, но чёрную»): the Worker returns only those pieces and an English search query for each.
// Pieces are saved from the crop of that photo (no AI cut-out: it is not the person's own item and costs
// nothing). A wish is a wardrobe record with `want: true`: the stylist never uses it in outfits; «Купил»
// moves it to the wardrobe, and the item card can move any piece back. «Найти» opens «Покупки» with that
// piece: Zalando and the other shops with the person's size, and the price search (Zalando, About You,
// or Google Shopping in «Все новые»).
import { useEffect, useRef, useState } from "react";
import { localFetch } from "./lib/local-api.js";
import { GarmentIcon, Icon, Sheet, WaitLine } from "./ui.jsx";

const fileToDataUrl = (file) => new Promise((resolve, reject) => {
  const reader = new FileReader();
  reader.onload = () => resolve(reader.result);
  reader.onerror = () => reject(new Error("Не удалось прочитать фото."));
  reader.readAsDataURL(file);
});

async function post(path, body) {
  const response = await localFetch(path, { method: "POST", body: JSON.stringify(body) });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || "Не получилось. Попробуй ещё раз.");
  return data;
}

// The sheet: photo → own words → pieces found → pick → saved as wishes.
function WishUpload({ open, onClose, onAdded, setupReady, onOpenAccess }) {
  const [photo, setPhoto] = useState(null); // { file, url }
  const [note, setNote] = useState("");
  const [state, setState] = useState({ step: "pick", error: "" }); // pick → busy → choose → saving
  const [found, setFound] = useState([]); // [{ tempId, metadata, preview, on }]
  const pickRef = useRef(null);

  useEffect(() => () => { if (photo?.url) URL.revokeObjectURL(photo.url); }, [photo]);
  useEffect(() => {
    if (open) return;
    setPhoto(null); setNote(""); setFound([]); setState({ step: "pick", error: "" });
  }, [open]);

  const choose = (event) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    setPhoto({ file, url: URL.createObjectURL(file) });
    setState({ step: "pick", error: "" });
  };

  const detect = async () => {
    setState({ step: "busy", error: "" });
    try {
      const data = await post("/api/import/wish/detect", { imageDataUrl: await fileToDataUrl(photo.file), note: note.trim() });
      const list = (data.candidates || []).map((c) => ({ ...c, on: true }));
      if (!list.length) throw new Error("Не нашёл на фото одежды, обуви или аксессуаров. Попробуй другое фото.");
      setFound(list);
      setState({ step: "choose", error: "" });
    } catch (e) {
      setState({ step: "pick", error: e.message });
    }
  };

  const add = async () => {
    const picks = found.filter((f) => f.on).map(({ tempId, metadata }) => ({ tempId, metadata }));
    setState({ step: "saving", error: "" });
    try {
      const data = await post("/api/import/wish/add", { picks, note: note.trim() });
      onAdded(data.records || []);
      onClose();
    } catch (e) {
      setState({ step: "choose", error: e.message });
    }
  };

  const cancel = () => {
    if (found.length) post("/api/import/wish/cancel", {}).catch(() => {});
    onClose();
  };
  const picked = found.filter((f) => f.on).length;

  return (
    <Sheet open={open} onClose={cancel} title="Образ, который хочу" subtitle="Фото из Pinterest, с улицы, с чужого профиля — найду каждую вещь">
      {!setupReady ? (
        <div className="info-card"><span>Чтобы найти вещи на фото, нужен код доступа.</span><button type="button" className="btn btn--dark btn--small" onClick={onOpenAccess}>Ввести код</button></div>
      ) : state.step === "choose" || state.step === "saving" ? (
        <>
          <span className="section-label">Нашёл {found.length} — что добавить в «Хочу купить»?</span>
          <div className="alt-grid">
            {found.map((f, i) => (
              <button type="button" key={f.tempId} className={`alt-card rise${f.on ? " is-current" : ""}`} style={{ animationDelay: `${i * 0.03}s` }} aria-pressed={f.on}
                onClick={() => setFound((list) => list.map((x) => (x.tempId === f.tempId ? { ...x, on: !x.on } : x)))}>
                <span className="alt-card__image wish-crop">
                  <img src={f.preview} alt="" />
                  {f.on && <span className="badge-dark"><Icon name="check" size={12} width={2.6} /></span>}
                </span>
                <span className="alt-card__text"><span className="strong-text">{f.metadata.name}</span><span className="tiny-text">{f.metadata.query || " "}</span></span>
              </button>
            ))}
          </div>
          {state.error && <p className="status-line status-line--error">{state.error}</p>}
          <button type="button" className="btn btn--dark btn--block" disabled={!picked || state.step === "saving"} onClick={add}>
            <Icon name="plus" size={18} width={2} /> {state.step === "saving" ? "Сохраняю…" : `Добавить в «Хочу купить» (${picked})`}
          </button>
        </>
      ) : (
        <>
          <button type="button" className={`wish-photo${photo ? " has-photo" : ""}`} onClick={() => pickRef.current?.click()} disabled={state.step === "busy"}>
            {photo ? <img src={photo.url} alt="Фото образа" /> : <><Icon name="camera" size={28} /><span>Выбрать фото образа</span></>}
          </button>
          <input ref={pickRef} type="file" accept="image/*" hidden onChange={choose} />
          <label className="field-v2">
            <span>Что хочешь с этого фото? <small>необязательно</small></span>
            <textarea rows="2" maxLength={200} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Например: куртку и ботинки, куртку — в чёрном" disabled={state.step === "busy"} />
          </label>
          {state.step === "busy" && <WaitLine phrases={["Ищу вещи на фото…", "Подписываю каждую вещь…", "Готовлю запрос для магазинов…"]} />}
          {state.error && <p className="status-line status-line--error">{state.error}</p>}
          <button type="button" className="btn btn--dark btn--block" disabled={!photo || state.step === "busy"} onClick={detect}>
            <Icon name="star" size={18} width={2} /> Найти вещи на фото
          </button>
          <p className="tiny-text">Фото уйдёт на распознавание, как при добавлении вещей. Вещи сохраняются вырезками с этого фото — на телефоне.</p>
        </>
      )}
    </Sheet>
  );
}

// The shelf itself: what the person wants, with «Найти» and «Купил».
export function WishShelf({ items, setupReady, onOpenAccess, onOpen, onFind, onBought, onAdded }) {
  const [uploading, setUploading] = useState(false);
  return (
    <>
      <button type="button" className="photo-cta wish-cta rise" onClick={() => setUploading(true)}>
        <span className="row-card__icon"><Icon name="plus" size={22} /></span>
        <span><b>Образ, который хочу</b><small>Загрузи фото из Pinterest или с улицы — найду каждую вещь и поищу её в магазинах</small></span>
        <Icon name="chevron" size={20} width={2} />
      </button>

      {!items.length ? (
        <p className="muted-text wish-empty">Здесь будет то, что хочешь купить. Когда купишь — нажми «Купил», и вещь переедет в гардероб и в образы.</p>
      ) : (
        <div className="wish-grid">
          {items.map((item, i) => (
            <article className="wish-card rise" key={item.id} style={{ animationDelay: `${i * 0.03}s` }}>
              <button type="button" className="wish-card__image" onClick={() => onOpen(item.id)} aria-label={`Открыть ${item.name}`}>
                {item.thumbnail || item.image ? <img src={item.thumbnail || item.image} alt="" /> : <GarmentIcon item={item} size={64} />}
              </button>
              <span className="wish-card__name">{item.name}</span>
              {item.wishNote && <span className="wish-card__note">{item.wishNote}</span>}
              <div className="wish-card__actions">
                <button type="button" className="btn btn--dark btn--small" onClick={() => onFind(item)}><Icon name="bag" size={16} width={2} /> Найти</button>
                <button type="button" className="btn btn--outline btn--small" onClick={() => onBought(item)}><Icon name="check" size={16} width={2.2} /> Купил</button>
              </div>
            </article>
          ))}
        </div>
      )}

      <WishUpload open={uploading} onClose={() => setUploading(false)} onAdded={onAdded} setupReady={setupReady} onOpenAccess={onOpenAccess} />
    </>
  );
}
