import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Check, Plus, Trash, X } from "@phosphor-icons/react";
import { WardrobeImportFlow } from "./import-flow.jsx";
import { OptimizedImage } from "./OptimizedImage.jsx";
import { localFetch } from "./lib/local-api.js";
import { plural } from "./lib/plural.js";
import { getProfile, getSettings } from "./lib/settings.js";
import { readLabel } from "./lib/gemini.js";
import { normalizeImage } from "./lib/image.js";
import { kindOf } from "./lib/kinds.js";
import { FIT_OPTIONS, getBody, parseSize, sizeLabel, sizeOptions, sizeSystem } from "./lib/sizes.js";
import { Onboarding, isOnboardingDone } from "./onboarding.jsx";
import { getActivePalette } from "./lib/palette-mode.js";
import { PaletteView } from "./palette.jsx";
import { SettingsView } from "./settings-panel.jsx";
import { ShoppingView } from "./shopping.jsx";
import { SizesView } from "./sizes.jsx";
import { TimingView } from "./timing.jsx";
import { TodayView } from "./today.jsx";
import { Icon, Segmented } from "./ui.jsx";
import { WishShelf } from "./wish.jsx";
import "./v2.css";

const STORAGE_KEY = "open-wardrobe-edits-v1";
const DELETED_STORAGE_KEY = "open-wardrobe-deleted-v1";

const TYPES = [
  { id: "all", label: "Все" },
  { id: "upperbody", label: "Верх", singular: "Верх" },
  { id: "wholebody_up", label: "Верхняя одежда", singular: "Верхняя одежда" },
  { id: "lowerbody", label: "Низ", singular: "Низ" },
  { id: "accessories_up", label: "Аксессуары", singular: "Аксессуар" },
  { id: "shoes", label: "Обувь", singular: "Обувь" },
];

const TYPE_MAP = Object.fromEntries(TYPES.map((type) => [type.id, type]));
const TYPE_ORDER = Object.fromEntries(TYPES.slice(1).map((type, index) => [type.id, index]));


function readEdits() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}");
  } catch {
    return {};
  }
}


function persistEdit(item) {
  const edits = readEdits();
  edits[item.id] = {
    name: item.name || "",
    brand: item.brand || "",
    part: item.part,
    color: item.color || null,
    secondaryColor: item.secondaryColor || null,
    tags: item.tags || [],
    size: item.size || "",
    fit: item.fit || "",
    want: Boolean(item.want),
    wishNote: item.wishNote || "",
  };
  localStorage.setItem(STORAGE_KEY, JSON.stringify(edits));
}

function removePersistedEdit(id) {
  const edits = readEdits();
  delete edits[id];
  localStorage.setItem(STORAGE_KEY, JSON.stringify(edits));
}

function readDeletedItems() {
  try {
    const value = JSON.parse(localStorage.getItem(DELETED_STORAGE_KEY) || "[]");
    return new Set(Array.isArray(value) ? value : []);
  } catch {
    return new Set();
  }
}

function persistDeletedItem(id) {
  const deleted = readDeletedItems();
  deleted.add(id);
  localStorage.setItem(DELETED_STORAGE_KEY, JSON.stringify([...deleted]));
}

function rgbToHex(red, green, blue) {
  return `#${[red, green, blue].map((value) => Math.max(0, Math.min(255, value)).toString(16).padStart(2, "0")).join("")}`;
}

function colorDistance(first, second) {
  return Math.sqrt(
    ((first.red - second.red) ** 2)
    + ((first.green - second.green) ** 2)
    + ((first.blue - second.blue) ** 2),
  );
}

function extractPalette(image) {
  const canvas = document.createElement("canvas");
  canvas.width = 72;
  canvas.height = 72;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  context.clearRect(0, 0, canvas.width, canvas.height);
  context.drawImage(image, 0, 0, canvas.width, canvas.height);

  const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
  const buckets = new Map();

  for (let index = 0; index < pixels.length; index += 4) {
    const alpha = pixels[index + 3];
    if (alpha < 72) continue;

    const red = pixels[index];
    const green = pixels[index + 1];
    const blue = pixels[index + 2];
    const key = `${Math.round(red / 28)}-${Math.round(green / 28)}-${Math.round(blue / 28)}`;
    const current = buckets.get(key) || { red: 0, green: 0, blue: 0, count: 0 };
    current.red += red;
    current.green += green;
    current.blue += blue;
    current.count += 1;
    buckets.set(key, current);
  }

  const ranked = [...buckets.values()]
    .map((bucket) => ({
      red: Math.round(bucket.red / bucket.count),
      green: Math.round(bucket.green / bucket.count),
      blue: Math.round(bucket.blue / bucket.count),
      count: bucket.count,
    }))
    .sort((a, b) => b.count - a.count);

  const selected = [];
  for (const color of ranked) {
    if (selected.every((existing) => colorDistance(existing, color) > 38)) selected.push(color);
    if (selected.length === 5) break;
  }

  return selected.map((color) => rgbToHex(color.red, color.green, color.blue));
}

function buildSamplingCanvas(image) {
  const canvas = document.createElement("canvas");
  canvas.width = image.naturalWidth;
  canvas.height = image.naturalHeight;
  canvas.getContext("2d", { willReadFrequently: true }).drawImage(image, 0, 0);
  return canvas;
}

function sampleImageColor(image, canvas, event) {
  const bounds = image.getBoundingClientRect();
  const scale = Math.min(bounds.width / image.naturalWidth, bounds.height / image.naturalHeight);
  const renderedWidth = image.naturalWidth * scale;
  const renderedHeight = image.naturalHeight * scale;
  const offsetX = (bounds.width - renderedWidth) / 2;
  const offsetY = (bounds.height - renderedHeight) / 2;
  const imageX = Math.floor((event.clientX - bounds.left - offsetX) / scale);
  const imageY = Math.floor((event.clientY - bounds.top - offsetY) / scale);

  if (imageX < 0 || imageY < 0 || imageX >= canvas.width || imageY >= canvas.height) return null;

  const context = canvas.getContext("2d", { willReadFrequently: true });
  for (let radius = 0; radius <= 18; radius += 2) {
    const startX = Math.max(0, imageX - radius);
    const startY = Math.max(0, imageY - radius);
    const width = Math.min(canvas.width - startX, (radius * 2) + 1);
    const height = Math.min(canvas.height - startY, (radius * 2) + 1);
    const data = context.getImageData(startX, startY, width, height).data;
    for (let index = 0; index < data.length; index += 4) {
      if (data[index + 3] > 96) return rgbToHex(data[index], data[index + 1], data[index + 2]);
    }
  }

  return null;
}

function GalleryItem({ item, index = 0, selected, onOpen }) {
  const type = TYPE_MAP[item.part]?.singular || "Вещь";

  return (
    <button
      className={`gallery-item rise${selected ? " selected" : ""}`}
      style={{ animationDelay: `${Math.min(index, 12) * 0.04}s` }}
      type="button"
      onClick={() => onOpen(item.id)}
      aria-label={`Открыть ${item.name || type}`}
      aria-pressed={selected}
      data-testid={`wardrobe-item-${item.id}`}
    >
      <span className="gallery-item__image">
        <OptimizedImage
          src={item.thumbnail || item.image}
          alt=""
          sizes="(max-width: 520px) calc(50vw - 16px), (max-width: 860px) calc(33vw - 18px), 180px"
          breakpoints={[120, 180, 240, 320, 480]}
        />
      </span>
      <span className="gallery-item__name">{item.name || type}</span>
      {item.brand && <span className="gallery-item__brand">{item.brand}</span>}
    </button>
  );
}

function TagEditor({ tags, onChange }) {
  const [input, setInput] = useState("");

  const addTag = () => {
    const nextTag = input.trim().replace(/^#/, "");
    if (!nextTag || tags.some((tag) => tag.toLowerCase() === nextTag.toLowerCase())) return;
    onChange([...tags, nextTag]);
    setInput("");
  };

  return (
    <div className="tag-editor">
      <div className="editable-tags">
        {tags.map((tag) => (
          <span className="editable-tag" key={tag}>
            {tag}
            <button type="button" onClick={() => onChange(tags.filter((existing) => existing !== tag))} aria-label={`Убрать ${tag}`}>
              <X size={12} weight="regular" aria-hidden="true" />
            </button>
          </span>
        ))}
      </div>
      <div className="tag-input-row">
        <input
          value={input}
          onChange={(event) => setInput(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" || event.key === ",") {
              event.preventDefault();
              addTag();
            }
          }}
          placeholder="Добавить деталь"
          aria-label="Добавить деталь"
        />
        <button type="button" onClick={addTag} disabled={!input.trim()} aria-label="Добавить">
          <Plus size={15} weight="regular" aria-hidden="true" />
        </button>
      </div>
    </div>
  );
}

function ColorControl({ label, field, value, palette, onChange, sampling, setSampling, optional = false, onClear, onAdd }) {
  if (optional && !value) {
    return (
      <div className="color-slot empty-color-slot">
        <div className="color-slot-heading">
          <span>{label}</span>
          <small>Необязательно</small>
        </div>
        <p>Второй цвет не найден.</p>
        <button className="add-secondary-button" type="button" onClick={onAdd}>Добавить второй цвет</button>
      </div>
    );
  }

  return (
    <div className="color-slot">
      <div className="color-slot-heading">
        <span>{label}</span>
        {optional && <button type="button" onClick={onClear}>Убрать</button>}
      </div>
      <label className="selected-color-control">
        <input
          type="color"
          value={value || "#9a9286"}
          onChange={(event) => onChange(event.target.value)}
          aria-label={`Выбрать: ${label.toLowerCase()}`}
        />
        <span className="selected-color-copy">
          <small>Выбрано</small>
          <strong>{value || "Custom"}</strong>
        </span>
      </label>
      <div className="suggestion-heading">
        <span>Цвета с фото</span>
        <small>Нажми, чтобы применить</small>
      </div>
      <div className="palette" aria-label={`${label}: варианты с фото`}>
        {palette.map((color) => (
          <button
            type="button"
            key={color}
            className={value?.toLowerCase() === color.toLowerCase() ? "active" : ""}
            style={{ backgroundColor: color }}
            onClick={() => onChange(color)}
            aria-label={`Взять ${color}`}
            title={color}
          />
        ))}
      </div>
      <button
        className={`sample-button${sampling === field ? " active" : ""}`}
        type="button"
        onClick={() => setSampling((current) => current === field ? null : field)}
      >
        {sampling === field ? "Отменить" : "Взять цвет с фото"}
      </button>
    </div>
  );
}

// The size of a piece and how it sits: the most reliable way to know the person's size without a tape
// measure (src/lib/sizes.js → wardrobeSizes). The size can be read from a photo of the label.
function ItemSize({ draft, setDraft, kind, gender }) {
  const [status, setStatus] = useState({ busy: false, text: "" });
  const system = sizeSystem(kind, gender);
  const options = system ? sizeOptions(system, gender) : null;
  if (!options) return null;
  const pick = parseSize(draft.size, system, gender);
  const setPick = (next) => setDraft((current) => ({ ...current, size: next == null ? "" : sizeLabel(system, next) }));
  const num = (v) => (v === "" ? null : Number(v));

  const readTag = async (event) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    setStatus({ busy: true, text: "Читаю бирку…" });
    try {
      const found = await readLabel(await normalizeImage(file, 1280));
      if (!found.isLabel) { setStatus({ busy: false, text: "Не вижу бирку с размером — сфотографируй её поближе." }); return; }
      const parsed = parseSize(found.size, system, gender);
      setDraft((current) => ({ ...current, size: parsed != null ? sizeLabel(system, parsed) : found.size || current.size, brand: current.brand || found.brand || "" }));
      setStatus({ busy: false, text: found.size ? `На бирке: ${found.size}${found.brand ? ` · ${found.brand}` : ""}` : "Размер на бирке не нашёл — выбери сам." });
    } catch (error) {
      setStatus({ busy: false, text: error?.message || "Не получилось прочитать бирку." });
    }
  };

  return (
    <div className="field item-size">
      <span>Размер</span>
      <div className="item-size__row">
        {system === "wl" ? (
          <>
            <select aria-label="Талия, W" value={pick?.w ?? ""} onChange={(e) => setPick(num(e.target.value) == null ? null : { w: num(e.target.value), l: pick?.l || 32 })}>
              <option value="">W —</option>
              {options.main.map((v) => <option key={v} value={v}>W{v}</option>)}
            </select>
            <select aria-label="Длина, L" value={pick?.l ?? ""} disabled={!pick} onChange={(e) => setPick({ w: pick.w, l: num(e.target.value) })}>
              {options.second.map((v) => <option key={v} value={v}>L{v}</option>)}
            </select>
          </>
        ) : (
          <select aria-label={options.label} value={pick ?? ""} onChange={(e) => setPick(e.target.value === "" ? null : system === "letter" ? e.target.value : num(e.target.value))}>
            <option value="">—</option>
            {options.main.map((v) => <option key={v} value={v}>{system === "letter" ? v : `EU ${v}`}</option>)}
          </select>
        )}
        <label className="item-size__label">
          <Icon name="camera" size={16} width={2} /> {status.busy ? "Читаю…" : "Сфоткать бирку"}
          <input type="file" accept="image/*" capture="environment" hidden onChange={readTag} disabled={status.busy} />
        </label>
      </div>
      {!pick && draft.size && <p className="item-size__note">На бирке: {draft.size}</p>}
      {status.text && <p className="item-size__note" aria-live="polite">{status.text}</p>}
      <span>Как сидит</span>
      <div className="chip-row" role="group" aria-label="Как сидит">
        {FIT_OPTIONS.map(([id, label]) => (
          <button type="button" key={id} className={`chip${draft.fit === id ? " is-on" : ""}`} aria-pressed={draft.fit === id}
            onClick={() => setDraft((current) => ({ ...current, fit: current.fit === id ? "" : id }))}>{label}</button>
        ))}
      </div>
      <p className="item-size__note">По вещам, которые сидят впору, подберу размер в магазинах — мерить себя не нужно.</p>
    </div>
  );
}

function ItemEditor({ draft, setDraft, palette, sampling, setSampling, sampleStatus, kind, gender }) {
  const suggestedSecondary = palette.find((color) => color.toLowerCase() !== draft.color?.toLowerCase()) || "#9a9286";

  return (
    <div className="item-editor">
      <label className="field">
        <span>Название</span>
        <input
          value={draft.name}
          onChange={(event) => setDraft((current) => ({ ...current, name: event.target.value }))}
          placeholder={TYPE_MAP[draft.part]?.singular || "Wardrobe item"}
        />
      </label>

      <label className="field">
        <span>Бренд</span>
        <input
          value={draft.brand}
          maxLength={40}
          onChange={(event) => setDraft((current) => ({ ...current, brand: event.target.value }))}
          placeholder="Например: Uniqlo"
        />
      </label>

      <ItemSize draft={draft} setDraft={setDraft} kind={kind} gender={gender} />

      <label className="field">
        <span>Категория</span>
        <select value={draft.part} onChange={(event) => setDraft((current) => ({ ...current, part: event.target.value }))}>
          {TYPES.slice(1).map((type) => <option value={type.id} key={type.id}>{type.label}</option>)}
        </select>
      </label>

      <fieldset className="color-field">
        <legend>Цвета</legend>
        <div className="colors-editor">
          <ColorControl
            label="Основной цвет"
            field="primary"
            value={draft.color}
            palette={palette}
            onChange={(color) => setDraft((current) => ({ ...current, color }))}
            sampling={sampling}
            setSampling={setSampling}
          />
          <ColorControl
            label="Второй цвет"
            field="secondary"
            value={draft.secondaryColor}
            palette={palette}
            onChange={(secondaryColor) => setDraft((current) => ({ ...current, secondaryColor }))}
            sampling={sampling}
            setSampling={setSampling}
            optional
            onClear={() => setDraft((current) => ({ ...current, secondaryColor: null }))}
            onAdd={() => setDraft((current) => ({ ...current, secondaryColor: suggestedSecondary }))}
          />
        </div>
        <p className="color-help" aria-live="polite">{sampling ? `Нажми на вещь, чтобы взять ${sampling === "primary" ? "основной" : "второй"} цвет.` : sampleStatus || "Цвета берутся с фото. Второй цвет предлагается, только если он заметно присутствует на вещи."}</p>
      </fieldset>

      <div className="field details-field">
        <span>Детали</span>
        <TagEditor tags={draft.tags} onChange={(tags) => setDraft((current) => ({ ...current, tags }))} />
      </div>
    </div>
  );
}

// What the editor edits; `size` is as on the label ("M", "W32 L32", "EU 42"), `fit` is "small" | "good" | "big".
const draftOf = (item) => ({ name: item.name || "", brand: item.brand || "", part: item.part, color: item.color || "#9a9286", secondaryColor: item.secondaryColor || null, tags: [...(item.tags || [])], size: item.size || "", fit: item.fit || "" });

function ItemViewer({ item, onClose, onSave, onDelete, onMove }) {
  const closeButtonRef = useRef(null);
  const imageRef = useRef(null);
  const samplingCanvasRef = useRef(null);
  const shakeTimerRef = useRef(null);
  const [sampling, setSampling] = useState(null);
  const [sampleStatus, setSampleStatus] = useState("");
  const [palette, setPalette] = useState(item.palette || []);
  const [draft, setDraft] = useState(() => draftOf(item));
  const [gender, setGender] = useState(""); // for the size system of the item (women's trousers are EU, men's W/L)
  const [shaking, setShaking] = useState(false);
  const [closeBlocked, setCloseBlocked] = useState(false);
  const type = TYPE_MAP[item.part]?.singular || "Wardrobe item";
  const hasModeledImage = Boolean(item.modeledImage);
  useEffect(() => {
    Promise.all([getBody(), getProfile()]).then(([body, profile]) => setGender(body?.gender || profile?.gender || "")).catch(() => {});
  }, []);
  const pieceRotation = useMemo(() => {
    const hash = [...item.id].reduce((total, character) => total + character.charCodeAt(0), 0);
    return `${(hash % 9) - 4}deg`;
  }, [item.id]);

  const isDirty = useMemo(() => {
    const normalizedTags = (tags) => tags.map((tag) => tag.trim()).filter(Boolean);
    return JSON.stringify({
      name: draft.name.trim(),
      brand: draft.brand.trim(),
      part: draft.part,
      color: draft.color?.toLowerCase() || null,
      secondaryColor: draft.secondaryColor?.toLowerCase() || null,
      tags: normalizedTags(draft.tags),
      size: draft.size.trim(),
      fit: draft.fit,
    }) !== JSON.stringify({
      name: (item.name || "").trim(),
      brand: (item.brand || "").trim(),
      part: item.part,
      color: item.color?.toLowerCase() || null,
      secondaryColor: item.secondaryColor?.toLowerCase() || null,
      tags: normalizedTags(item.tags || []),
      size: (item.size || "").trim(),
      fit: item.fit || "",
    });
  }, [draft, item]);

  const nudgeUnsaved = useCallback(() => {
    setCloseBlocked(true);
    setShaking(false);
    requestAnimationFrame(() => {
      requestAnimationFrame(() => setShaking(true));
    });
    clearTimeout(shakeTimerRef.current);
    shakeTimerRef.current = setTimeout(() => setShaking(false), 420);
  }, []);

  const requestClose = useCallback(() => {
    if (isDirty) nudgeUnsaved();
    else onClose();
  }, [isDirty, nudgeUnsaved, onClose]);

  useEffect(() => {
    const onKeyDown = (event) => {
      if (event.key === "Escape") {
        if (sampling) setSampling(null);
        else requestClose();
      }
    };

    document.addEventListener("keydown", onKeyDown);
    document.body.classList.add("viewer-open");
    closeButtonRef.current?.focus({ preventScroll: true });
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.body.classList.remove("viewer-open");
      clearTimeout(shakeTimerRef.current);
    };
  }, [requestClose, sampling]);

  useEffect(() => {
    if (!isDirty) setCloseBlocked(false);
  }, [isDirty]);

  useEffect(() => {
    setSampling(null);
    setSampleStatus("");
    setPalette(item.palette || []);
    setDraft(draftOf(item));
  }, [item]);

  const cancelEditing = () => {
    setDraft(draftOf(item));
    setSampling(null);
    setSampleStatus("");
    onClose();
  };

  const saveEditing = () => {
    onSave({ ...item, ...draft, name: draft.name.trim(), brand: draft.brand.trim(), size: draft.size.trim(), tags: draft.tags.map((tag) => tag.trim()).filter(Boolean) });
    setSampling(null);
    setSampleStatus("Changes saved.");
  };

  const handleImageLoad = (event) => {
    samplingCanvasRef.current = buildSamplingCanvas(event.currentTarget);
    const extracted = extractPalette(event.currentTarget);
    setPalette([...new Set([...(item.palette || []), ...extracted])].slice(0, 5));
  };

  const handleImageClick = (event) => {
    if (!sampling || !samplingCanvasRef.current) return;
    const color = sampleImageColor(event.currentTarget, samplingCanvasRef.current, event);
    if (!color) {
      setSampleStatus("That spot is transparent—try directly on the garment.");
      return;
    }
    const targetField = sampling === "secondary" ? "secondaryColor" : "color";
    setDraft((current) => ({ ...current, [targetField]: color }));
    setPalette((current) => [color, ...current.filter((existing) => existing.toLowerCase() !== color.toLowerCase())].slice(0, 5));
    setSampleStatus(`Взят цвет ${color}.`);
    setSampling(null);
  };

  const garmentArtwork = (
    <div
      className={`viewer-art${hasModeledImage ? " viewer-art-floating" : ""}${sampling ? " sampling" : ""}`}
      style={hasModeledImage ? { "--piece-rotation": pieceRotation } : undefined}
    >
      <OptimizedImage
        ref={imageRef}
        src={item.image}
        alt={`Selected ${type.toLowerCase()}`}
        sizes="(max-width: 520px) 40vw, 300px"
        breakpoints={[160, 240, 320, 480, 640]}
        priority
        onLoad={handleImageLoad}
        onClick={handleImageClick}
      />
      {sampling && <span className="sample-hint">Нажми на вещь, чтобы взять цвет</span>}
    </div>
  );

  return (
    <div className="viewer-overlay" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && requestClose()}>
    <div className="viewer-entry">
    <aside className={`viewer editing${hasModeledImage ? " has-modeled-image" : ""}${shaking ? " shake" : ""}`} role="dialog" aria-modal="true" aria-label="Выбранная вещь">
      <button className="viewer-icon-close" type="button" onClick={requestClose} aria-label="Закрыть" ref={closeButtonRef}>
        <X size={24} weight="light" aria-hidden="true" />
      </button>

      {hasModeledImage ? (
        <div className="modeled-hero">
          <OptimizedImage
            className="modeled-hero-photo"
            src={item.modeledImage}
            alt={`${draft.name || type} на тебе`}
            sizes="(max-width: 860px) 100vw, 520px"
            breakpoints={[320, 480, 640, 800, 1040, 1280]}
            quality={82}
            priority
          />
          <div className="viewer-heading modeled-heading">
            <div>
              <h2>{draft.name || TYPE_MAP[draft.part]?.singular}</h2>
            </div>
          </div>
          {garmentArtwork}
        </div>
      ) : (
        <>
          <div className="viewer-heading">
            <div>
              <h2>{draft.name || TYPE_MAP[draft.part]?.singular}</h2>
            </div>
          </div>
          {garmentArtwork}
        </>
      )}

      <div className="viewer-details editing">
        <ItemEditor
          draft={draft}
          setDraft={setDraft}
          palette={palette}
          sampling={sampling}
          setSampling={setSampling}
          sampleStatus={sampleStatus}
          kind={kindOf({ ...item, part: draft.part })}
          gender={gender}
        />

        {closeBlocked && <p className="unsaved-notice" role="status">Сохрани или отмени изменения перед закрытием.</p>}

        {onMove && (
          <button type="button" className="move-button" onClick={() => onMove(item, !item.want)}>
            {item.want ? <><Check size={16} weight="bold" aria-hidden="true" /> Купил — перенести в гардероб</> : <>В «Хочу купить»</>}
          </button>
        )}
        <div className="viewer-actions">
          <button className="delete-button" type="button" onClick={() => onDelete(item.id)}>
            <Trash size={15} weight="regular" aria-hidden="true" /> Удалить
          </button>
          <span className="action-spacer" />
          <button className="secondary-button" type="button" onClick={cancelEditing}>Отмена</button>
          <button className="primary-button" type="button" onClick={saveEditing}>
            <Check size={15} weight="bold" aria-hidden="true" /> Сохранить
          </button>
        </div>
      </div>
    </aside>
    </div>
    </div>
  );
}

const TABS = [
  { id: "today", label: "Сегодня", icon: "today" },
  { id: "wardrobe", label: "Гардероб", icon: "hanger" },
  { id: "add" },
  { id: "shopping", label: "Покупки", icon: "bag" },
  { id: "profile", label: "Профиль", icon: "profile" },
];

function BottomNav({ tab, onTab, onAdd }) {
  return (
    <nav className="bottom-nav" aria-label="Навигация">
      <div className="bottom-nav__inner">
        {TABS.map((t) => t.id === "add" ? (
          <button key="add" type="button" className="bottom-nav__add" aria-label="Добавить вещи" onClick={onAdd}><Icon name="plus" size={24} width={2} /></button>
        ) : (
          <button key={t.id} type="button" className={`bottom-nav__item${tab === t.id ? " is-on" : ""}`} aria-current={tab === t.id ? "page" : undefined} onClick={() => onTab(t.id)}>
            <Icon name={t.icon} size={24} />
            <span>{t.label}</span>
          </button>
        ))}
      </div>
    </nav>
  );
}

export function App() {
  const [items, setItems] = useState([]);
  const [activeType, setActiveType] = useState("all");
  const [shelf, setShelf] = useState("have"); // «Есть» or «Хочу купить» in «Гардероб»
  const [selectedId, setSelectedId] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [tab, setTab] = useState("today");
  const [sub, setSub] = useState(null); // "palette" | "timing" inside «Профиль»
  const [backTo, setBackTo] = useState(null); // a tab to return to from a sub-screen opened elsewhere
  const [shopping, setShopping] = useState({ focus: null, refreshKey: 0 });
  const [profileFocus, setProfileFocus] = useState(null);
  const [setupReady, setSetupReady] = useState(true);
  const [toast, setToast] = useState("");
  const [onboarding, setOnboarding] = useState(null); // { needsAccess } while the first-launch flow is shown
  const importRef = useRef(null);
  const toastTimer = useRef(null);

  useEffect(() => {
    localFetch("/api/import/wardrobe")
      .then((response) => {
        if (!response.ok) throw new Error("Не удалось загрузить гардероб.");
        return response.json();
      })
      .then((loadedItems) => {
        const edits = readEdits();
        const deleted = readDeletedItems();
        const visibleItems = loadedItems.filter((item) => !deleted.has(item.id));
        setItems(visibleItems.map((item) => ({ ...item, ...(edits[item.id] || {}) })));
      })
      .catch((requestError) => setError(requestError.message))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    Promise.all([isOnboardingDone(), getSettings()]).then(([done, s]) => {
      if (!done) setOnboarding({ needsAccess: !(s.proxyUrl && s.accessCode) });
    });
    // a palette saved before «Простая / Расширенная»: the stylist's profile line follows the mode from the start
    getActivePalette().catch(() => {});
  }, []);

  useEffect(() => {
    const refresh = () => getSettings().then((s) => setSetupReady(Boolean(s.proxyUrl && s.accessCode)));
    refresh();
    window.addEventListener("capsule:settings", refresh);
    return () => window.removeEventListener("capsule:settings", refresh);
  }, []);

  const showToast = useCallback((text) => {
    setToast(text);
    clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(""), 3200);
  }, []);

  const go = useCallback((next, options = {}) => {
    setTab(next);
    setSub(options.sub || null);
    setBackTo(options.backTo || null);
    setSelectedId(null);
    if (next === "shopping") setShopping((current) => ({ focus: options.focus || null, refreshKey: options.refresh ? current.refreshKey + 1 : current.refreshKey }));
    setProfileFocus(options.profileFocus || null);
    window.scrollTo({ top: 0 });
  }, []);

  const openAccess = useCallback(() => go("profile", { profileFocus: "access" }), [go]);

  const selectedItem = items.find((item) => item.id === selectedId) || null;

  // The wardrobe proper («Есть») and the wish list («Хочу купить», `want: true`).
  const haveItems = useMemo(() => items.filter((item) => !item.want), [items]);
  const wantItems = useMemo(() => items.filter((item) => item.want), [items]);
  const visibleItems = useMemo(() => {
    const filtered = activeType === "all" ? haveItems : haveItems.filter((item) => item.part === activeType);
    return [...filtered].sort((a, b) => {
      if (activeType === "all") {
        const typeDifference = (TYPE_ORDER[a.part] ?? 99) - (TYPE_ORDER[b.part] ?? 99);
        if (typeDifference) return typeDifference;
      }
      return a.id.localeCompare(b.id);
    });
  }, [activeType, haveItems]);

  const counts = useMemo(() => Object.fromEntries(TYPES.map((type) => [type.id, type.id === "all" ? haveItems.length : haveItems.filter((item) => item.part === type.id).length])), [haveItems]);

  const chooseType = (typeId) => {
    setActiveType(typeId);
    setSelectedId(null);
  };

  const saveItem = (updatedItem, toast) => {
    setItems((current) => current.map((item) => item.id === updatedItem.id ? updatedItem : item));
    persistEdit(updatedItem);
    if (updatedItem.id.startsWith("import-")) {
      const { name, brand, part, color, secondaryColor, tags, palette, size, fit, want, wishNote } = updatedItem;
      localFetch(`/api/import/wardrobe/${updatedItem.id}`, { method: "PATCH", body: JSON.stringify({ name, brand, part, color, secondaryColor, tags, palette, size, fit, want: Boolean(want), wishNote: wishNote || "" }) }).catch(() => {});
    }
    if (toast !== false) showToast(toast || "Сохранено");
  };

  // «Хочу купить» ↔ гардероб: a bought wish joins the outfits; any piece can go back to the wish list.
  const moveItem = (item, want) => {
    saveItem({ ...item, want }, want ? "Перенёс в «Хочу купить»" : "Перенёс в гардероб — теперь она в образах");
    setSelectedId(null);
  };
  const addWishes = (records) => {
    if (!records.length) return;
    setItems((current) => [...current, ...records]);
    setShelf("want");
    showToast(`В «Хочу купить»: ${records.length} ${plural(records.length, ["вещь", "вещи", "вещей"])}`);
  };
  const findWish = (item) => go("shopping", {
    focus: { label: item.name, part: item.part, kind: item.kind, color: item.color, query: item.query, from: "wish", why: item.wishNote ? `Из «Хочу купить»: ${item.wishNote}` : "Из «Хочу купить» — ищу такую же вещь в магазинах." },
  });

  const deleteItem = async (id) => {
    if (id.startsWith("import-")) {
      try {
        const response = await localFetch(`/api/import/wardrobe/${id}`, { method: "DELETE" });
        if (!response.ok && response.status !== 404) throw new Error("Не удалось удалить вещь.");
      } catch (requestError) {
        setError(requestError.message);
        return;
      }
    }
    setItems((current) => current.filter((item) => item.id !== id));
    removePersistedEdit(id);
    persistDeletedItem(id);
    setSelectedId(null);
  };

  // New items from «＋» arrive here; the same item can arrive again later with its photo «на мне».
  const addImportedItem = useCallback((newItem) => {
    if (!newItem?.id) return;
    const edits = readEdits()[newItem.id] || {};
    setItems((current) => (current.some((item) => item.id === newItem.id)
      ? current.map((item) => (item.id === newItem.id ? { ...item, ...newItem, ...edits } : item))
      : [...current, { ...newItem, ...edits }]));
  }, []);

  const openItem = useCallback((id) => {
    setTab("wardrobe");
    setSub(null);
    setBackTo(null);
    setSelectedId(id);
  }, []);

  const addItems = () => importRef.current?.pick();

  return (
    <div className={`app-shell${selectedItem ? " has-selection" : ""}`}>
      <main className="app-main" key={`${tab}:${sub || ""}`}>
        {tab === "today" && <TodayView items={haveItems} loaded={!loading} setupReady={setupReady} onNavigate={go} onAdd={addItems} onOpenAccess={openAccess} onToast={showToast} />}
        {tab === "shopping" && <ShoppingView items={haveItems} setupReady={setupReady} focus={shopping.focus} refreshKey={shopping.refreshKey} onOpenAccess={openAccess} onOpenSizes={() => go("profile", { sub: "sizes", backTo: "shopping" })} />}
        {tab === "profile" && !sub && <SettingsView items={haveItems} focus={profileFocus} onOpen={(next) => setSub(next)} onToast={showToast} onRestartOnboarding={() => setOnboarding({ needsAccess: !setupReady })} />}
        {tab === "profile" && sub === "palette" && <PaletteView setupReady={setupReady} onOpenAccess={openAccess} onBack={() => setSub(null)} onFindClothes={() => go("shopping", { refresh: true })} />}
        {tab === "profile" && sub === "timing" && <TimingView onBack={() => setSub(null)} onToast={showToast} />}
        {tab === "profile" && sub === "sizes" && <SizesView onBack={() => (backTo ? go(backTo) : setSub(null))} onToast={showToast} />}
        {tab === "wardrobe" && (
          <section className="screen screen--wide wardrobe">
            <div className="wardrobe-head rise">
              <h1 className="screen-title">Гардероб</h1>
              <span className="muted-text">{haveItems.length} {plural(haveItems.length, ["вещь", "вещи", "вещей"])}</span>
            </div>
            <Segmented label="Что показать" className="segmented--shelf" value={shelf} onChange={setShelf}
              options={[{ id: "have", label: `Есть · ${haveItems.length}` }, { id: "want", label: `Хочу купить · ${wantItems.length}` }]} />
            {shelf === "want" ? (
              <WishShelf items={wantItems} setupReady={setupReady} onOpenAccess={openAccess} onOpen={setSelectedId}
                onFind={findWish} onBought={(item) => moveItem(item, false)} onAdded={addWishes} />
            ) : (<>
            <nav className="category-pills" aria-label="Фильтр по типу вещей">
              {TYPES.map((type) => (
                <button key={type.id} type="button" className={`filter-pill${activeType === type.id ? " is-on" : ""}`} onClick={() => chooseType(type.id)} aria-pressed={activeType === type.id}>
                  {type.label}{counts[type.id] ? <span className="filter-pill__count">{counts[type.id]}</span> : null}
                </button>
              ))}
            </nav>

            {error && <p className="error-text">{error}</p>}
            {!error && loading && <div className="gallery-grid">{[0, 1, 2, 3, 4, 5].map((i) => <span key={i} className="gallery-item gallery-item--skeleton shimmer" />)}</div>}
            {!error && !loading && !haveItems.length && (
              <div className="look-card look-card--empty rise">
                <span className="empty-icon"><Icon name="camera" size={26} /></span>
                <div className="card-title">Сфотографируй первые вещи</div>
                <p className="muted-text">Можно по одной или несколько на одном фото — ИИ найдёт каждую, вырежет с фона и подпишет. Лучше снимать на однотонном фоне.</p>
                <button type="button" className="btn btn--dark" onClick={addItems}><Icon name="plus" size={18} width={2} /> Добавить вещи</button>
              </div>
            )}

            {!!haveItems.length && (
              <section className="gallery-grid" aria-label={`${TYPE_MAP[activeType]?.label || "Все"}: вещи`}>
                {visibleItems.map((item, index) => (
                  <GalleryItem key={item.id} item={item} index={index} selected={selectedId === item.id} onOpen={setSelectedId} />
                ))}
              </section>
            )}
            </>)}
          </section>
        )}
      </main>

      <BottomNav tab={tab} onTab={(next) => go(next)} onAdd={addItems} />
      {selectedItem && <ItemViewer item={selectedItem} onClose={() => setSelectedId(null)} onSave={saveItem} onDelete={deleteItem} onMove={moveItem} />}
      <WardrobeImportFlow ref={importRef} onGarmentApproved={addImportedItem} onOpenAccess={openAccess} onOpenItem={openItem} />
      {onboarding && <Onboarding needsAccess={onboarding.needsAccess} onDone={() => { setOnboarding(null); go("today"); }} onAddItems={addItems} />}
      {toast && <p className="toast" role="status">{toast}</p>}
    </div>
  );
}
