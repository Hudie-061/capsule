// In-app replacement for the original Node import server (scripts/import-job-api.mjs).
// It keeps the same REST-like routes, so the original UI code barely changes,
// but runs entirely in the browser / Android WebView: IndexedDB for storage,
// canvas for image processing, Gemini (through the owner's proxy) for AI.
import { assetUrl, blobs, deleteAssetsWithPrefix, kv } from "./db.js";
import { analyzeClothing, cutoutGarment, modeledPhoto } from "./gemini.js";
import { chooseChromaKey, cleanupTolerance, cropDetectedItem, dataUrlToBlob, normalizeImage, processChromaBackground, removeChromaBackground } from "./image.js";
import { getModelReference, getSettings } from "./settings.js";

const PARTS = new Set(["upperbody", "wholebody_up", "lowerbody", "accessories_up", "shoes"]);
const HEX = /^#[0-9a-f]{6}$/i;
const running = new Map();

class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

const uuid = () => (crypto.randomUUID ? crypto.randomUUID() : "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
  const r = (Math.random() * 16) | 0; return (c === "x" ? r : ((r & 0x3) | 0x8)).toString(16);
}));

function normalizeBoundingBox(value = {}) {
  const box = value && typeof value === "object" ? value : {};
  const num = (k, f) => (Number.isFinite(Number(box[k])) ? Math.round(Number(box[k])) : f);
  const x = Math.max(0, Math.min(999, num("x", 0)));
  const y = Math.max(0, Math.min(999, num("y", 0)));
  return { x, y, width: Math.max(1, Math.min(1000 - x, num("width", 1000 - x))), height: Math.max(1, Math.min(1000 - y, num("height", 1000 - y))) };
}

const cleanSize = (v) => (typeof v === "string" ? v.replace(/[^\w\s./½-]/g, " ").replace(/\s+/g, " ").trim().slice(0, 24) : "");
const FITS = new Set(["small", "good", "big"]);

function normalizeMetadata(value = {}) {
  const m = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  return {
    name: typeof m.name === "string" ? m.name.trim().slice(0, 120) || "Новая вещь" : "Новая вещь",
    part: PARTS.has(m.part) ? m.part : "upperbody",
    color: typeof m.color === "string" && HEX.test(m.color) ? m.color.toLowerCase() : "#d8d0c2",
    secondaryColor: typeof m.secondaryColor === "string" && HEX.test(m.secondaryColor) ? m.secondaryColor.toLowerCase() : null,
    tags: Array.isArray(m.tags) ? m.tags.filter((t) => typeof t === "string").map((t) => t.trim().toLowerCase().slice(0, 40)).filter(Boolean).slice(0, 12) : [],
    brand: typeof m.brand === "string" ? m.brand.trim().slice(0, 40) : "",
    kind: typeof m.kind === "string" ? m.kind.trim().toLowerCase().replace(/[^a-z -]/g, "").slice(0, 24) : "",
    // the size, only when a size label was readable in the photo ("M", "W32 L32", "EU 42")
    size: cleanSize(m.size),
    // an English search query for shops ("women black leather biker jacket"); never Cyrillic
    query: typeof m.query === "string" && !/[\u0400-\u04FF]/.test(m.query) ? m.query.replace(/[^A-Za-z0-9 '&-]/g, " ").replace(/\s+/g, " ").trim().slice(0, 80) : "",
    boundingBox: normalizeBoundingBox(m.boundingBox),
  };
}

const stageState = () => ({ status: "pending", decision: null, attempts: 0, assetUrl: null, failedAssetUrl: null, cleanupPreviewUrl: null, cleanupTolerance: 46, cleanupDiagnostics: null, error: null, prompt: null, updatedAt: null });
const now = () => new Date().toISOString();

// ---- storage ----------------------------------------------------------------
// One IndexedDB record per job and per wardrobe item, so parallel imports never overwrite each other.
const JOB = "job:";
const ITEM = "item:";
async function loadJobs() {
  const keys = (await kv.keys()).filter((k) => String(k).startsWith(JOB));
  const jobs = await Promise.all(keys.map((k) => kv.get(k)));
  return Object.fromEntries(jobs.filter(Boolean).map((j) => [j.id, j]));
}
async function loadJob(id) { return kv.get(JOB + id); }
async function saveJob(job) {
  job.updatedAt = now();
  await kv.set(JOB + job.id, job);
}
async function removeJob(id) {
  await kv.del(JOB + id);
  await deleteAssetsWithPrefix(`asset:job/${id}/`);
}
export async function loadLibrary() {
  const keys = (await kv.keys()).filter((k) => String(k).startsWith(ITEM));
  const records = (await Promise.all(keys.map((k) => kv.get(k)))).filter(Boolean);
  return records.sort((a, b) => String(a.addedAt || "").localeCompare(String(b.addedAt || "")));
}
const getRecord = (id) => kv.get(ITEM + id);
const putRecord = (record) => kv.set(ITEM + record.id, record);
const deleteRecord = (id) => kv.del(ITEM + id);

// ---- URL resolution (stored "asset:" paths -> object URLs for <img>) ----------
async function resolveJob(job) {
  const copy = structuredClone(job);
  delete copy.internal;
  copy.originalAssetUrl = await assetUrl(copy.originalAssetUrl);
  for (const stage of Object.values(copy.stages || {})) {
    stage.assetUrl = await assetUrl(stage.assetUrl);
    stage.failedAssetUrl = await assetUrl(stage.failedAssetUrl);
    stage.cleanupPreviewUrl = await assetUrl(stage.cleanupPreviewUrl);
  }
  if (job.libraryRecordId) {
    const record = await getRecord(job.libraryRecordId);
    if (record) copy.libraryRecord = await resolveRecord(record);
  }
  return copy;
}

export async function resolveRecord(record) {
  return {
    ...record,
    image: await assetUrl(record.image),
    thumbnail: await assetUrl(record.thumbnail),
    modeledImage: await assetUrl(record.modeledImage),
  };
}

// ---- pipeline -----------------------------------------------------------------
async function persistImported(job, includeModeled) {
  const id = `import-${job.id}`;
  const garmentPath = `asset:lib/${id}-garment.png`;
  await blobs.set(garmentPath, await blobs.get(job.stages.garment.assetUrl));
  let modeledImage = null;
  if (includeModeled && job.stages.modeled.assetUrl) {
    modeledImage = `asset:lib/${id}-modeled.png`;
    await blobs.set(modeledImage, await blobs.get(job.stages.modeled.assetUrl));
  }
  const m = job.metadata || {};
  const existing = await getRecord(id);
  const record = {
    id,
    name: m.name || "Новая вещь",
    part: m.part || "upperbody",
    color: m.color || "#d8d0c2",
    secondaryColor: m.secondaryColor || null,
    palette: [m.color, m.secondaryColor].filter(Boolean),
    tags: Array.isArray(m.tags) ? m.tags : [],
    brand: m.brand || existing?.brand || "",
    kind: m.kind || existing?.kind || "",
    size: existing?.size || m.size || "",
    fit: existing?.fit || "",
    query: m.query || existing?.query || "",
    image: garmentPath,
    thumbnail: garmentPath,
    modeledImage: modeledImage || existing?.modeledImage || null,
    importJobId: job.id,
    addedAt: existing?.addedAt || now(),
  };
  await putRecord(record);
  return record;
}

function generate(jobId, stageName) {
  const lock = `${jobId}:${stageName}`;
  if (running.has(lock)) return running.get(lock);
  const task = (async () => {
    const current = await loadJob(jobId);
    if (!current) return;
    const stage = current.stages[stageName];
    Object.assign(stage, { status: "processing", decision: null, error: null, attempts: stage.attempts + 1, updatedAt: now() });
    await saveJob(current);
    let failedAssetUrl = null;
    let chromaKeyUsed = null;
    try {
      const dir = `asset:job/${current.id}`;
      const output = `${dir}/${stageName}-${stage.attempts}.png`;
      let result;
      if (stageName === "garment") {
        chromaKeyUsed = chooseChromaKey(current.metadata.color);
        const source = await blobs.get(current.internal.cropFile || current.internal.originalFile);
        const raw = await cutoutGarment({ image: source, metadata: current.metadata, chromaKey: chromaKeyUsed, direction: stage.prompt });
        failedAssetUrl = `${dir}/${stageName}-${stage.attempts}-source.png`;
        await blobs.set(failedAssetUrl, raw);
        result = await removeChromaBackground(raw, chromaKeyUsed);
      } else {
        const reference = await getModelReference();
        if (!reference) throw new Error("Нет фото для примерки. Добавь своё фото в «Профиле».");
        const garment = await blobs.get(current.stages.garment.assetUrl);
        result = await modeledPhoto({ person: reference, garment, direction: stage.prompt });
      }
      await blobs.set(output, result);
      const fresh = await loadJob(jobId);
      Object.assign(fresh.stages[stageName], { status: "review", assetUrl: output, failedAssetUrl: null, cleanupPreviewUrl: null, cleanupDiagnostics: null, updatedAt: now() });
      if (chromaKeyUsed) fresh.stages[stageName].chromaKey = chromaKeyUsed;
      await saveJob(fresh);
      // Items the user picked are added without another review step.
      if (fresh.auto) await decide(fresh, stageName, "approve");
    } catch (error) {
      const fresh = await loadJob(jobId);
      if (!fresh) return;
      Object.assign(fresh.stages[stageName], { status: "failed", error: error.message, updatedAt: now() });
      if (failedAssetUrl) fresh.stages[stageName].failedAssetUrl = failedAssetUrl;
      if (chromaKeyUsed) fresh.stages[stageName].chromaKey = chromaKeyUsed;
      await saveJob(fresh);
    }
  })().finally(() => running.delete(lock));
  running.set(lock, task);
  return task;
}

async function setupStatus() {
  const settings = await getSettings();
  const hasAccess = Boolean(settings.proxyUrl && settings.accessCode);
  const hasModelReference = Boolean(await getModelReference());
  return { ready: hasAccess, hasAccess, hasModelReference, modeledPhotos: settings.modeledPhotos && hasModelReference };
}

// Resume work interrupted by closing the app.
let resumed = false;
async function resumeOnce() {
  if (resumed) return;
  resumed = true;
  const jobs = await loadJobs();
  for (const job of Object.values(jobs)) {
    if (job.stages.crop?.status !== "approved") continue;
    if (["processing", "queued"].includes(job.stages.garment.status)) generate(job.id, "garment");
    else if (job.stages.garment.status === "approved" && ["processing", "queued"].includes(job.stages.modeled.status)) generate(job.id, "modeled");
  }
}

// Approve or reject a stage that waits for review. Automatic jobs (picked on the «какие добавить?»
// screen) call this themselves, so the user never sees a separate review step.
async function decide(job, stageName, decision) {
  const stage = job.stages[stageName];
  if (stage.status !== "review") throw new HttpError(409, "Этот шаг ещё не готов к проверке");
  stage.decision = decision === "approve" ? "approved" : "rejected";
  stage.status = stage.decision;
  stage.error = null;
  stage.updatedAt = now();
  const startGarment = stageName === "crop" && decision === "approve" && job.stages.garment.status === "pending";
  let startModeled = false;
  let libraryRecord = null;
  if (stageName === "garment" && decision === "approve") {
    const setup = await setupStatus();
    if (setup.modeledPhotos && job.stages.modeled.status === "pending") startModeled = true;
    else { job.stages.modeled.status = "skipped"; job.status = "complete"; }
  }
  if (stageName === "modeled" && decision === "approve") job.status = "complete";
  if (decision === "approve" && stageName !== "crop") {
    const record = await persistImported(job, stageName === "modeled");
    job.libraryRecordId = record.id;
    libraryRecord = await resolveRecord(record);
  }
  await saveJob(job);
  const response = await resolveJob(job);
  if (libraryRecord) response.libraryRecord = libraryRecord;
  // Manual jobs disappear at once; automatic ones stay as "complete" until the app has shown the result.
  if (decision === "reject" || (job.status === "complete" && !job.auto)) await removeJob(job.id);
  if (startGarment) { job.stages.garment.status = "queued"; await saveJob(job); generate(job.id, "garment"); }
  if (startModeled) { job.stages.modeled.status = "queued"; await saveJob(job); generate(job.id, "modeled"); }
  return response;
}

// Brings jobs from older versions and from closed sessions to the new flow:
// - a photo whose items were never picked is dropped («не решил — не добавляем»);
// - everything the user had already agreed to finishes on its own, without review reminders.
async function settleJob(job) {
  if (job.stages.crop?.status === "review" && !job.auto) { await removeJob(job.id); return null; }
  if (!job.auto) { job.auto = true; await saveJob(job); }
  try {
    if (job.stages.garment?.status === "review") await decide(job, "garment", "approve");
    else if (job.stages.modeled?.status === "review") await decide(job, "modeled", "approve");
  } catch (error) { console.error("import: could not finish an old job", error); }
  return loadJob(job.id);
}

// ---- router -----------------------------------------------------------------
async function route(method, pathname, input) {
  if (pathname === "/api/import/wardrobe" && method === "GET") {
    return Promise.all((await loadLibrary()).map(resolveRecord));
  }
  if (pathname === "/api/import/config" && method === "GET") return setupStatus();

  const del = pathname.match(/^\/api\/import\/wardrobe\/(import-[\w-]+)$/);
  if (del && method === "DELETE") {
    if (!(await getRecord(del[1]))) throw new HttpError(404, "Вещь не найдена");
    await deleteRecord(del[1]);
    await deleteAssetsWithPrefix(`asset:lib/${del[1]}-`);
    return { deleted: true, id: del[1] };
  }
  const patch = pathname.match(/^\/api\/import\/wardrobe\/(import-[\w-]+)$/);
  if (patch && method === "PATCH") {
    const record = await getRecord(patch[1]);
    if (!record) throw new HttpError(404, "Вещь не найдена");
    const allowed = ["name", "brand", "part", "color", "secondaryColor", "tags", "palette", "size", "fit", "want", "wishNote"];
    if ("want" in input) input.want = input.want === true;
    if ("wishNote" in input) input.wishNote = typeof input.wishNote === "string" ? input.wishNote.trim().slice(0, 200) : "";
    if (typeof input.brand === "string") input.brand = input.brand.trim().slice(0, 40);
    if ("size" in input) input.size = cleanSize(input.size);
    if ("fit" in input && !FITS.has(input.fit)) input.fit = "";
    for (const key of allowed) if (key in input) record[key] = input[key];
    await putRecord(record);
    return resolveRecord(record);
  }

  // «Хочу купить» — step 1: the pieces on a photo the person found, with their wish in words.
  // Crops wait in `asset:wish/` until step 2; nothing goes to the wardrobe yet.
  if (pathname === "/api/import/wish/detect" && method === "POST") {
    const setup = await setupStatus();
    if (!setup.ready) throw new HttpError(503, "Сначала впиши код доступа в «Профиле» → «Доступ».");
    await deleteAssetsWithPrefix("asset:wish/");
    const note = typeof input.note === "string" ? input.note.trim().slice(0, 200) : "";
    const original = await normalizeImage(dataUrlToBlob(input.imageDataUrl));
    const detected = (await analyzeClothing(original, { note })).map(normalizeMetadata);
    const candidates = [];
    for (const metadata of detected) {
      const tempId = uuid();
      const key = `asset:wish/${tempId}.png`;
      await blobs.set(key, await cropDetectedItem(original, metadata.boundingBox));
      candidates.push({ tempId, metadata, preview: await assetUrl(key) });
    }
    return { candidates, note };
  }
  // step 2: the picked pieces become wardrobe records marked `want` (not used for outfits).
  if (pathname === "/api/import/wish/add" && method === "POST") {
    const note = typeof input.note === "string" ? input.note.trim().slice(0, 200) : "";
    const picks = Array.isArray(input.picks) ? input.picks.slice(0, 8) : [];
    const records = [];
    for (const pick of picks) {
      const tempId = typeof pick?.tempId === "string" && /^[\w-]{8,40}$/.test(pick.tempId) ? pick.tempId : null;
      const crop = tempId ? await blobs.get(`asset:wish/${tempId}.png`) : null;
      if (!crop) continue;
      const m = normalizeMetadata(pick.metadata);
      const id = `import-wish-${uuid()}`;
      const image = `asset:lib/${id}-garment.png`;
      await blobs.set(image, crop);
      const record = {
        id, name: m.name, part: m.part, color: m.color, secondaryColor: m.secondaryColor,
        palette: [m.color, m.secondaryColor].filter(Boolean), tags: m.tags, brand: m.brand, kind: m.kind,
        size: "", fit: "", query: m.query, want: true, wishNote: note,
        image, thumbnail: image, modeledImage: null, addedAt: now(),
      };
      await putRecord(record);
      records.push(await resolveRecord(record));
    }
    await deleteAssetsWithPrefix("asset:wish/");
    return { records };
  }
  if (pathname === "/api/import/wish/cancel" && method === "POST") {
    await deleteAssetsWithPrefix("asset:wish/");
    return { ok: true };
  }

  if (pathname === "/api/import/jobs" && method === "POST") {
    const setup = await setupStatus();
    if (!setup.ready) throw new HttpError(503, "Сначала впиши код доступа в «Профиле» → «Доступ».");
    const original = await normalizeImage(dataUrlToBlob(input.imageDataUrl));
    const detected = (await analyzeClothing(original)).map(normalizeMetadata);
    const jobs = [];
    for (const metadata of detected) {
      const id = uuid();
      const dir = `asset:job/${id}`;
      const originalFile = `${dir}/original.png`;
      const cropFile = `${dir}/crop.png`;
      await blobs.set(originalFile, original);
      await blobs.set(cropFile, await cropDetectedItem(original, metadata.boundingBox));
      const t = now();
      const job = {
        id, status: "active", metadata,
        stages: { crop: { ...stageState(), status: "review", assetUrl: cropFile, updatedAt: t }, garment: stageState(), modeled: stageState() },
        createdAt: t, updatedAt: t, originalAssetUrl: originalFile,
        internal: { originalFile, cropFile },
      };
      await saveJob(job);
      jobs.push(await resolveJob(job));
    }
    return { jobs, noClothingDetected: jobs.length === 0 };
  }
  if (pathname === "/api/import/jobs" && method === "GET") {
    resumeOnce();
    const all = Object.values(await loadJobs());
    const rejected = all.filter((j) => ["crop", "garment", "modeled"].some((s) => j.stages[s]?.status === "rejected"));
    await Promise.all(rejected.map((j) => removeJob(j.id)));
    const settled = [];
    for (const job of all.filter((j) => !rejected.includes(j))) {
      const fresh = await settleJob(job);
      if (fresh) settled.push(fresh);
    }
    return Promise.all(settled.sort((a, b) => a.createdAt.localeCompare(b.createdAt)).map(resolveJob));
  }

  const match = pathname.match(/^\/api\/import\/jobs\/([\w-]{36})(?:\/(.*))?$/);
  if (!match) throw new HttpError(404, "Not found");
  const job = await loadJob(match[1]);
  if (!job) throw new HttpError(404, "Задача импорта не найдена");
  const action = match[2] || "";

  if (!action && method === "GET") return resolveJob(job);
  if (!action && method === "DELETE") { await removeJob(job.id); return { deleted: true, id: job.id }; }
  if (action === "add" && method === "POST") {
    job.auto = true;
    await saveJob(job);
    if (job.stages.crop.status === "review") return decide(job, "crop", "approve");
    return resolveJob(job);
  }
  if (action === "metadata" && (method === "PATCH" || method === "PUT")) {
    if (!input.metadata || typeof input.metadata !== "object") throw new HttpError(400, "metadata must be an object");
    job.metadata = normalizeMetadata({ ...job.metadata, ...input.metadata });
    await saveJob(job);
    return resolveJob(job);
  }

  const cleanup = action.match(/^stages\/garment\/(cleanup-preview|cleanup-accept)$/);
  if (cleanup && method === "POST") {
    const stage = job.stages.garment;
    if (stage.status !== "failed" || !stage.failedAssetUrl) throw new HttpError(409, "Нет исходника для ручной чистки");
    const tolerance = cleanupTolerance(input.tolerance);
    const key = stage.chromaKey || chooseChromaKey(job.metadata?.color);
    const cleaned = await processChromaBackground(await blobs.get(stage.failedAssetUrl), key, { tolerance });
    const previewPath = `asset:job/${job.id}/garment-${stage.attempts}-cleanup-${tolerance}.png`;
    await blobs.set(previewPath, cleaned.blob);
    Object.assign(stage, { chromaKey: key, cleanupTolerance: cleaned.tolerance, cleanupDiagnostics: cleaned.verification, cleanupPreviewUrl: previewPath, updatedAt: now() });
    if (cleanup[1] === "cleanup-accept") Object.assign(stage, { status: "review", decision: null, error: null, assetUrl: previewPath });
    await saveJob(job);
    if (cleanup[1] === "cleanup-accept" && job.auto) return decide(job, "garment", "approve");
    return resolveJob(job);
  }

  const stageMatch = action.match(/^stages\/(crop|garment|modeled)\/(approve|reject|regenerate)$/);
  if (stageMatch && method === "POST") {
    const [, stageName, decision] = stageMatch;
    const stage = job.stages[stageName];
    if (decision === "regenerate") {
      if (stageName === "crop") throw new HttpError(400, "Загрузи фото заново, чтобы получить новые кадры");
      stage.prompt = typeof input.prompt === "string" ? input.prompt.trim().slice(0, 1200) || null : null;
      stage.status = "queued";
      stage.decision = null;
      await saveJob(job);
      generate(job.id, stageName);
      return resolveJob(job);
    }
    return decide(job, stageName, decision);
  }
  throw new HttpError(404, "Not found");
}

// fetch()-compatible entry point used by the UI instead of window.fetch for /api routes.
export async function localFetch(path, options = {}) {
  const method = (options.method || "GET").toUpperCase();
  const pathname = new URL(path, "http://local").pathname;
  let input = {};
  if (options.body) {
    try { input = JSON.parse(options.body); } catch { input = {}; }
  }
  try {
    const value = await route(method, pathname, input);
    return new Response(JSON.stringify(value), { status: method === "POST" && pathname === "/api/import/jobs" ? 202 : 200, headers: { "Content-Type": "application/json" } });
  } catch (error) {
    const status = error.status || 500;
    if (status === 500) console.error(error);
    return new Response(JSON.stringify({ error: error.message || "Внутренняя ошибка" }), { status, headers: { "Content-Type": "application/json" } });
  }
}
