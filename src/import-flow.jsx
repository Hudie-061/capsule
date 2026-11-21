// Adding clothes («＋»): one decision per photo.
// 1. The photo is analysed; every item found is shown on «Нашёл N вещей — какие добавить?».
// 2. Picked items are cut out and land in the wardrobe on their own, with no further reviews.
//    Items the user does not pick (or a photo they never decide on) are not added.
// 3. Only a failed background cleanup asks for help.
import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from "react";
import { ArrowCounterClockwise, Check, UploadSimple, WarningCircle } from "@phosphor-icons/react";
import "./import-flow.css";
import { localFetch } from "./lib/local-api.js";
import { plural } from "./lib/plural.js";
import { Icon, Sheet, Spinner } from "./ui.jsx";

const API = "/api/import/jobs";
const CONFIG_API = "/api/import/config";
const PART_LABEL = { upperbody: "Верх", wholebody_up: "Верхняя одежда", lowerbody: "Низ", accessories_up: "Аксессуар", shoes: "Обувь" };
const ITEMS = ["вещь", "вещи", "вещей"];

const fileToDataUrl = (file) => new Promise((resolve, reject) => {
  const reader = new FileReader();
  reader.onload = () => resolve(reader.result);
  reader.onerror = () => reject(reader.error || new Error("Не удалось прочитать картинку."));
  reader.readAsDataURL(file);
});

async function api(path, options) {
  const response = await localFetch(path, {
    ...options,
    headers: { "Content-Type": "application/json", ...(options?.headers || {}) },
  });
  const value = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(value.error || "Не удалось обновить импорт.");
    error.status = response.status;
    throw error;
  }
  return value;
}

// select: waiting for «добавить?» · working: being cut out · done: in the wardrobe · attention: needs help
function phaseOf(job) {
  if (job.libraryRecord) return "done";
  if (job.stages?.crop?.status === "review" && !job.auto) return "select";
  if (job.error || ["crop", "garment"].some((s) => job.stages?.[s]?.status === "failed")) return "attention";
  return "working";
}

const thumbOf = (job) => job.libraryRecord?.thumbnail || job.stages?.garment?.assetUrl || job.stages?.crop?.assetUrl || job.originalAssetUrl;

function CleanupEditor({ job, tolerance, setTolerance, busy, onPreview, onAccept }) {
  const stage = job.stages.garment;
  const previewTimer = useRef(null);
  useEffect(() => () => clearTimeout(previewTimer.current), []);
  const updateTolerance = (next) => {
    setTolerance(next);
    clearTimeout(previewTimer.current);
    previewTimer.current = setTimeout(() => onPreview(next), 300);
  };
  return (
    <div className="import-cleanup-editor">
      <p className="tiny-text">ИИ вырезал вещь, но фон убрался не до конца. Подвинь ползунок, пока на превью не станет чисто — это бесплатно.</p>
      <div className="import-cleanup-comparison">
        <figure><img src={stage.failedAssetUrl} alt="Вещь на цветном фоне" /><figcaption>Исходник</figcaption></figure>
        <figure><img src={stage.cleanupPreviewUrl || stage.failedAssetUrl} alt="Превью чистки" /><figcaption>{stage.cleanupPreviewUrl ? "Превью" : "Здесь появится превью"}</figcaption></figure>
      </div>
      <div className="import-field import-cleanup-strength">
        <label htmlFor={`cleanup-${job.id}`}>Сила чистки <strong>{tolerance}</strong></label>
        <input id={`cleanup-${job.id}`} type="range" min="18" max="110" step="2" value={tolerance} onChange={(event) => updateTolerance(Number(event.target.value))} />
        <div className="import-cleanup-scale"><span>Бережнее к краям</span><span>Сильнее убрать фон</span></div>
      </div>
      <div className="row-gap">
        <button type="button" className="btn btn--dark btn--small" disabled={busy} onClick={onAccept}><Check size={16} weight="bold" /> Добавить так</button>
      </div>
    </div>
  );
}

export const WardrobeImportFlow = forwardRef(function WardrobeImportFlow({ onGarmentApproved, onOpenAccess, onOpenItem }, ref) {
  const inputRef = useRef(null);
  const [jobs, setJobs] = useState([]);
  const [picked, setPicked] = useState(new Set());
  const [detecting, setDetecting] = useState([]); // photos being analysed: [{ id, preview }]
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [setup, setSetup] = useState(null);
  const [helpId, setHelpId] = useState(null);
  const [tolerances, setTolerances] = useState({});
  const announced = useRef(new Map());

  useEffect(() => {
    const loadSetup = () => api(CONFIG_API).then(setSetup).catch((requestError) => setSetup({ ready: false, error: requestError.message }));
    loadSetup();
    window.addEventListener("capsule:settings", loadSetup);
    // Items finished in the background last time are handed to the wardrobe and cleared quietly.
    api(API).then((list) => {
      const finished = list.filter((job) => phaseOf(job) === "done");
      finished.forEach((job) => {
        announced.current.set(job.id, "cleared");
        onGarmentApproved?.(job.libraryRecord);
        api(`${API}/${job.id}`, { method: "DELETE" }).catch(() => {});
      });
      setJobs(list.filter((job) => phaseOf(job) !== "done"));
    }).catch(() => {});
    return () => window.removeEventListener("capsule:settings", loadSetup);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Every item that reached the wardrobe is handed to the app once (and again if its photo changes).
  useEffect(() => {
    for (const job of jobs) {
      const record = job.libraryRecord;
      if (!record) continue;
      const signature = `${record.image}|${record.modeledImage || ""}`;
      if (announced.current.get(job.id) === signature) continue;
      announced.current.set(job.id, signature);
      onGarmentApproved?.(record);
    }
  }, [jobs, onGarmentApproved]);

  const refresh = useCallback(async (id) => {
    try {
      const next = await api(`${API}/${id}`);
      setJobs((current) => current.map((job) => (job.id === id ? next : job)));
    } catch (requestError) {
      if (requestError.status === 404) setJobs((current) => current.filter((job) => job.id !== id));
    }
  }, []);

  const workingIds = jobs.filter((job) => phaseOf(job) === "working" || ["queued", "processing"].includes(job.stages?.modeled?.status)).map((job) => job.id).join(",");
  useEffect(() => {
    if (!workingIds) return undefined;
    const timer = setInterval(() => workingIds.split(",").forEach((id) => refresh(id)), 1200);
    return () => clearInterval(timer);
  }, [workingIds, refresh]);

  const submitFiles = useCallback(async (files) => {
    if (!setup?.ready) { setOpen(true); return; }
    const images = [...files].filter((file) => file.type.startsWith("image/"));
    if (!images.length) return;
    setDragging(false); setError(""); setNotice(""); setOpen(true);
    for (const file of images) {
      const temp = { id: `${Date.now()}-${Math.random()}`, preview: URL.createObjectURL(file) };
      setDetecting((current) => [...current, temp]);
      try {
        const imageDataUrl = await fileToDataUrl(file);
        const result = await api(API, { method: "POST", body: JSON.stringify({ imageDataUrl, metadata: { name: file.name.replace(/\.[^.]+$/, "") } }) });
        const created = result.jobs || [];
        if (!created.length) setNotice("На фото не нашлось одежды. Попробуй снять вещь целиком и поближе.");
        setJobs((current) => [...current, ...created]);
        setPicked((current) => new Set([...current, ...created.map((job) => job.id)]));
      } catch (requestError) {
        setError(requestError.message);
      } finally {
        setDetecting((current) => current.filter((item) => item.id !== temp.id));
        URL.revokeObjectURL(temp.preview);
      }
    }
  }, [setup]);

  useImperativeHandle(ref, () => ({
    pick: () => {
      if (!setup?.ready) { setOpen(true); return; }
      inputRef.current?.click();
    },
  }), [setup]);

  useEffect(() => {
    let depth = 0;
    const hasFiles = (event) => [...(event.dataTransfer?.types || [])].includes("Files");
    const onDragEnter = (event) => { if (!hasFiles(event)) return; event.preventDefault(); depth += 1; setDragging(true); };
    const onDragOver = (event) => { if (hasFiles(event)) event.preventDefault(); };
    const onDragLeave = (event) => { event.preventDefault(); depth = Math.max(0, depth - 1); if (!depth) setDragging(false); };
    const onDrop = (event) => { event.preventDefault(); depth = 0; setDragging(false); submitFiles(event.dataTransfer.files); };
    const onPaste = (event) => { const files = [...event.clipboardData.files]; if (files.some((file) => file.type.startsWith("image/"))) { event.preventDefault(); submitFiles(files); } };
    window.addEventListener("dragenter", onDragEnter); window.addEventListener("dragover", onDragOver); window.addEventListener("dragleave", onDragLeave); window.addEventListener("drop", onDrop); window.addEventListener("paste", onPaste);
    return () => { window.removeEventListener("dragenter", onDragEnter); window.removeEventListener("dragover", onDragOver); window.removeEventListener("dragleave", onDragLeave); window.removeEventListener("drop", onDrop); window.removeEventListener("paste", onPaste); };
  }, [submitFiles]);

  const toSelect = jobs.filter((job) => phaseOf(job) === "select");
  const done = jobs.filter((job) => phaseOf(job) === "done");
  const attention = jobs.filter((job) => phaseOf(job) === "attention");
  const inProgress = jobs.filter((job) => phaseOf(job) === "working");
  const chosen = toSelect.filter((job) => picked.has(job.id));

  const replace = (updated) => setJobs((current) => current.map((job) => (job.id === updated.id ? updated : job)));
  const drop = async (job) => {
    await api(`${API}/${job.id}`, { method: "DELETE" }).catch(() => {});
    setJobs((current) => current.filter((item) => item.id !== job.id));
  };

  // The user's decision: picked items are added — to the wardrobe or to «Хочу купить» — the rest are dropped.
  // A wish is cut out like any piece, so it looks the same in outfits and on the mannequin when tried on.
  const addPicked = async (want = false) => {
    setBusy(true); setError("");
    try {
      for (const job of toSelect) {
        if (picked.has(job.id)) replace(await api(`${API}/${job.id}/add`, { method: "POST", body: JSON.stringify({ want }) }));
        else await drop(job);
      }
      setPicked(new Set());
    } catch (requestError) { setError(requestError.message); }
    finally { setBusy(false); }
  };

  const dropAllUnpicked = async () => {
    setBusy(true);
    for (const job of toSelect) await drop(job);
    setBusy(false);
    if (!jobs.some((job) => phaseOf(job) !== "select")) setOpen(false);
  };

  const retry = async (job) => {
    setBusy(true); setError("");
    try { replace(await api(`${API}/${job.id}/stages/garment/regenerate`, { method: "POST", body: JSON.stringify({ prompt: "" }) })); }
    catch (requestError) { setError(requestError.message); }
    finally { setBusy(false); }
  };

  const cleanup = async (job, action, requested) => {
    setBusy(true); setError("");
    try {
      const tolerance = requested ?? tolerances[job.id] ?? job.stages?.garment?.cleanupTolerance ?? 46;
      const updated = await api(`${API}/${job.id}/stages/garment/cleanup-${action}`, { method: "POST", body: JSON.stringify({ tolerance }) });
      replace(updated);
      setTolerances((current) => ({ ...current, [job.id]: updated.stages?.garment?.cleanupTolerance ?? tolerance }));
      if (action === "accept") setHelpId(null);
    } catch (requestError) { setError(requestError.message); }
    finally { setBusy(false); }
  };

  // Results the user has seen are cleared; work in progress keeps going in the background.
  const close = () => {
    setOpen(false);
    if (!inProgress.length && !toSelect.length && !detecting.length) done.forEach((job) => drop(job));
  };

  const togglePick = (id) => setPicked((current) => {
    const next = new Set(current);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });

  const setupRequired = setup?.ready === false;
  const active = detecting.length || jobs.length;
  let title = "Добавить вещи";
  let subtitle = "Сфотографируй вещь или себя в образе — найду каждую вещь на фото";
  if (setupRequired && !jobs.length) { title = "Нужен код доступа"; subtitle = ""; }
  else if (toSelect.length) { title = `Нашёл ${toSelect.length} ${plural(toSelect.length, ITEMS)}`; subtitle = "Отметь вещи и выбери: они уже твои — в гардероб, или ты их хочешь — в «Хочу купить»."; }
  else if (detecting.length && !jobs.length) { title = "Ищу вещи на фото…"; subtitle = "Обычно это занимает несколько секунд"; }
  else if (inProgress.length) { title = `Оцифровываю ${inProgress.length} ${plural(inProgress.length, ITEMS)}`; subtitle = "Убираю фон и подписываю. Можно закрыть — работа продолжится."; }
  else if (attention.length) { title = "Нужна помощь"; subtitle = "С одной из вещей не получилось — посмотри ниже"; }
  else if (done.length) { title = `Добавлено: ${done.length} ${plural(done.length, ITEMS)}`; subtitle = done.every((job) => job.libraryRecord?.want) ? "В «Хочу купить» — там можно примерить их со своими вещами." : "Название и бренд можно поправить."; }

  let pill = null;
  if (toSelect.length) pill = { icon: <span className="import-pill__count">{toSelect.length}</span>, text: "Выбери вещи" };
  else if (detecting.length || inProgress.length) pill = { icon: <Spinner label="Идёт оцифровка" />, text: detecting.length && !inProgress.length ? "Ищу вещи на фото" : `Оцифровываю ${done.length}/${done.length + inProgress.length + attention.length}` };
  else if (attention.length) pill = { icon: <WarningCircle size={18} />, text: "Нужна помощь" };
  else if (done.length) pill = { icon: <Check size={18} weight="bold" />, text: `Добавлено ${done.length}` };

  return (
    <>
      <input ref={inputRef} type="file" accept="image/*" multiple hidden onChange={(event) => { submitFiles(event.target.files); event.target.value = ""; }} />
      <div className="import-drop-overlay" data-active={dragging && !setupRequired} aria-hidden={!dragging || setupRequired}>
        <div className="import-drop-target is-over"><UploadSimple size={34} weight="light" /><h2>Отпусти фото здесь</h2><p>Подойдёт фото одной вещи или целого образа.</p></div>
      </div>

      {pill && !open && (
        <button type="button" className="import-pill rise" onClick={() => setOpen(true)}>
          <span className="import-pill__icon">{pill.icon}</span>
          <span>{pill.text}</span>
        </button>
      )}

      <Sheet open={open} onClose={close} title={title} subtitle={subtitle} className="import-sheet">
        {setupRequired && !jobs.length ? (
          <div className="info-card">
            <span>Чтобы ИИ находил и вырезал вещи, впиши код доступа в «Профиле». Его даёт владелец приложения.</span>
            <button type="button" className="btn btn--dark btn--small" onClick={() => { setOpen(false); onOpenAccess?.(); }}>Ввести код</button>
          </div>
        ) : toSelect.length ? (
          <>
            <div className="alt-grid">
              {toSelect.map((job, i) => {
                const on = picked.has(job.id);
                return (
                  <button type="button" key={job.id} className={`alt-card pick-card rise${on ? " is-current" : ""}`} style={{ animationDelay: `${i * 0.03}s` }} aria-pressed={on} onClick={() => togglePick(job.id)}>
                    <span className="alt-card__image">
                      <img src={thumbOf(job)} alt="" />
                      <span className={`pick-card__check${on ? " is-on" : ""}`} aria-hidden="true">{on && <Icon name="check" size={16} width={2.4} />}</span>
                    </span>
                    <span className="alt-card__text">
                      <span className="strong-text">{job.metadata?.name || "Вещь"}</span>
                      <span className="tiny-text">{PART_LABEL[job.metadata?.part] || "Вещь"}</span>
                    </span>
                  </button>
                );
              })}
              {detecting.map((item) => <span key={item.id} className="alt-card pick-card pick-card--loading"><span className="alt-card__image shimmer" /><span className="tiny-text">Ищу вещи…</span></span>)}
            </div>
            <div className="action-row">
              <button type="button" className="btn btn--outline btn--grow1" disabled={busy || !chosen.length} onClick={() => addPicked(true)}>Хочу купить</button>
              <button type="button" className="btn btn--dark btn--grow1" disabled={busy || !chosen.length} onClick={() => addPicked(false)}>
                {chosen.length ? `В гардероб · ${chosen.length}` : "Ничего не выбрано"}
              </button>
            </div>
            <button type="button" className="text-button add-none" disabled={busy} onClick={dropAllUnpicked}>Ничего не добавлять</button>
          </>
        ) : active ? (
          <>
            <div className="import-rows">
              {detecting.map((item) => (
                <div className="import-row" key={item.id}>
                  <div className="import-row__main">
                    <img className="import-row__thumb" src={item.preview} alt="" />
                    <span className="import-row__text"><span className="strong-text">Фото</span><span className="tiny-text">Ищу вещи…</span></span>
                    <Spinner />
                  </div>
                </div>
              ))}
              {jobs.map((job) => {
                const phase = phaseOf(job);
                const garment = job.stages?.garment;
                return (
                  <div className={`import-row${phase === "attention" ? " is-attention" : ""}`} key={job.id}>
                    <div className="import-row__main">
                      <img className="import-row__thumb" src={thumbOf(job)} alt="" />
                      <span className="import-row__text">
                        <span className="strong-text">{job.libraryRecord?.name || job.metadata?.name || "Вещь"}</span>
                        <span className={`tiny-text${phase === "attention" ? " error-text" : ""}`}>
                          {phase === "done" ? (job.libraryRecord?.want ? "В «Хочу купить»" : "В гардеробе") : phase === "attention" ? (garment?.failedAssetUrl ? "Фон убрался не до конца" : garment?.error || "Не получилось вырезать") : garment?.status === "processing" ? "Убираю фон…" : "В очереди"}
                        </span>
                      </span>
                      {phase === "done" && (
                        <>
                          <span className="import-row__ok" aria-label="Готово"><Icon name="check" size={16} width={2.4} /></span>
                          <button type="button" className="text-button" onClick={() => { setOpen(false); onOpenItem?.(job.libraryRecord.id); }}>Исправить</button>
                        </>
                      )}
                      {phase === "working" && <Spinner />}
                      {phase === "attention" && (
                        <span className="row-gap">
                          {garment?.failedAssetUrl && <button type="button" className="text-button" onClick={() => setHelpId(helpId === job.id ? null : job.id)}>Помочь</button>}
                          <button type="button" className="text-button" disabled={busy} onClick={() => retry(job)}><ArrowCounterClockwise size={14} /> Ещё раз</button>
                          <button type="button" className="text-button" disabled={busy} onClick={() => drop(job)}>Убрать</button>
                        </span>
                      )}
                    </div>
                    {helpId === job.id && garment?.failedAssetUrl && (
                      <CleanupEditor
                        job={job}
                        tolerance={tolerances[job.id] ?? garment.cleanupTolerance ?? 46}
                        setTolerance={(value) => setTolerances((current) => ({ ...current, [job.id]: value }))}
                        busy={busy}
                        onPreview={(value) => cleanup(job, "preview", value)}
                        onAccept={() => cleanup(job, "accept")}
                      />
                    )}
                  </div>
                );
              })}
            </div>
            <div className="action-row">
              <button type="button" className="btn btn--outline btn--grow1" onClick={() => inputRef.current?.click()}>Добавить ещё</button>
              <button type="button" className="btn btn--dark btn--grow1" onClick={close}>{inProgress.length ? "Свернуть" : "Готово"}</button>
            </div>
          </>
        ) : (
          <div className="import-empty">
            <span className="empty-icon"><Icon name="camera" size={26} /></span>
            <p className="muted-text">Лучше на однотонном фоне и целиком в кадре. Можно сразу несколько вещей или себя в образе — я покажу, что нашёл, и добавлю только то, что ты выберешь.</p>
            {notice && <p className="error-text">{notice}</p>}
            <button type="button" className="btn btn--dark" onClick={() => inputRef.current?.click()}>Выбрать фото</button>
          </div>
        )}
        {notice && active ? <p className="tiny-text">{notice}</p> : null}
        {error && <p className="error-text" role="alert">{error}</p>}
      </Sheet>
    </>
  );
});
