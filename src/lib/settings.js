import { blobs, kv } from "./db.js";

// Build-time defaults (set in GitHub repository variables or a local .env file).
const ENV = import.meta.env || {};

// "capsule-proxy.name.workers.dev/" -> "https://capsule-proxy.name.workers.dev".
// Without a scheme fetch() would treat the address as a path on the current site.
export function normalizeProxyUrl(value) {
  const url = String(value || "").trim().replace(/\/+$/, "");
  if (!url) return "";
  return /^https?:\/\//i.test(url) ? url : `https://${url}`;
}

export const DEFAULTS = {
  proxyUrl: normalizeProxyUrl(ENV.VITE_PROXY_URL),
};

const SETTINGS_KEY = "settings";
const MODEL_REFERENCE_KEY = "asset:model-reference";

export async function getSettings() {
  const saved = (await kv.get(SETTINGS_KEY, {})) || {};
  return {
    proxyUrl: normalizeProxyUrl(saved.proxyUrl) || DEFAULTS.proxyUrl,
    accessCode: String(saved.accessCode || "").trim(),
    // Photo «на мне» for every new item costs one image each. Off by default for everyone
    // (a new key, so the old default "on" is not carried over); later a premium option.
    modeledPhotos: saved.modeledPhotosOn === true,
    country: typeof saved.country === "string" && /^[a-z]{2}$/.test(saved.country) ? saved.country : "be",
    // Add the user's size to shop searches («Мой размер» in «Покупки»); on unless turned off.
    sizeInSearch: saved.sizeInSearch !== false,
    saleOnly: saved.saleOnly === true,
    // Sizes picked in «Покупки», one per size system (see sizeSystem in sizes.js).
    chosenSizes: saved.chosenSizes && typeof saved.chosenSizes === "object" ? saved.chosenSizes : {},
    // «Чего не хватает»: what the person asked for last time (refresh sheet), what was already shown
    // (for variety) and what they closed with ×.
    gapWishes: { categories: [], budget: 50, style: "", note: "", ...(saved.gapWishes && typeof saved.gapWishes === "object" ? saved.gapWishes : {}) },
    gapsSeen: Array.isArray(saved.gapsSeen) ? saved.gapsSeen : [],
    gapsDismissed: Array.isArray(saved.gapsDismissed) ? saved.gapsDismissed : [],
  };
}

export async function saveSettings(patch) {
  const current = (await kv.get(SETTINGS_KEY, {})) || {};
  const next = { ...current, ...patch };
  if ("modeledPhotos" in next) {
    if ("modeledPhotos" in patch) next.modeledPhotosOn = Boolean(patch.modeledPhotos);
    delete next.modeledPhotos;
  }
  if (typeof next.proxyUrl === "string") next.proxyUrl = normalizeProxyUrl(next.proxyUrl);
  if (typeof next.accessCode === "string") next.accessCode = next.accessCode.trim();
  await kv.set(SETTINGS_KEY, next);
  window.dispatchEvent(new CustomEvent("capsule:settings"));
  return getSettings();
}

export async function getModelReference() {
  return blobs.get(MODEL_REFERENCE_KEY);
}

export async function setModelReference(blob) {
  if (blob) await blobs.set(MODEL_REFERENCE_KEY, blob);
  else await blobs.del(MODEL_REFERENCE_KEY);
  window.dispatchEvent(new CustomEvent("capsule:settings"));
}

export const MODEL_REFERENCE_PATH = MODEL_REFERENCE_KEY;

// ---- style profile + outfit feedback --------------------------------------
export const EMPTY_PROFILE = {
  gender: "",
  height: "",
  sizes: "",
  places: "",
  weight: "",
  build: "",
  goal: "",
  styles: "",
  fits: "",
  palette: "",
  avoid: "",
  notes: "",
};

export async function getProfile() {
  return { ...EMPTY_PROFILE, ...((await kv.get("profile", {})) || {}) };
}

export async function saveProfile(profile) {
  await kv.set("profile", { ...EMPTY_PROFILE, ...profile });
}

export async function getFeedback() {
  return (await kv.get("feedback", [])) || [];
}

export async function addFeedback(entry) {
  const list = await getFeedback();
  list.push({ ...entry, at: new Date().toISOString() });
  await kv.set("feedback", list.slice(-200));
  return list;
}

// Add reasons to a rating that was already saved (one tap after "Надену сегодня").
export async function amendFeedback(at, patch) {
  const list = await getFeedback();
  const index = list.findIndex((entry) => entry.at === at);
  if (index < 0) return list;
  list[index] = { ...list[index], ...patch };
  await kv.set("feedback", list);
  return list;
}

// Purchases marked with «Купил здесь»: the saving is the gap to the most expensive offer found for the same piece.
export const getPurchases = async () => (await kv.get("purchases", [])) || [];
export async function addPurchase(entry) {
  const list = await getPurchases();
  list.push({ ...entry, at: new Date().toISOString() });
  await kv.set("purchases", list.slice(-300));
  return list;
}

export async function clearFeedback() {
  await kv.set("feedback", []);
}

// Rules the stylist learned from the user's own words ("не люблю бэгги, хочу узкую талию").
// Shown and editable in Settings; injected into every outfit / shopping request.
export async function getLearned() {
  return (await kv.get("learned", [])) || [];
}

export async function saveLearned(rules) {
  const clean = [...new Set(rules.map((r) => String(r).trim()).filter(Boolean))].slice(0, 25);
  await kv.set("learned", clean);
  return clean;
}
