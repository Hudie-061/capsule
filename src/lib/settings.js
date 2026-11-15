import { blobs, kv } from "./db.js";

// Build-time defaults (set in GitHub repository variables or a local .env file).
const ENV = import.meta.env || {};
export const DEFAULTS = {
  proxyUrl: (ENV.VITE_PROXY_URL || "").replace(/\/$/, ""),
};

const SETTINGS_KEY = "settings";
const MODEL_REFERENCE_KEY = "asset:model-reference";

export async function getSettings() {
  const saved = (await kv.get(SETTINGS_KEY, {})) || {};
  return {
    proxyUrl: saved.proxyUrl || DEFAULTS.proxyUrl,
    accessCode: saved.accessCode || "",
    modeledPhotos: saved.modeledPhotos !== false,
  };
}

export async function saveSettings(patch) {
  const current = (await kv.get(SETTINGS_KEY, {})) || {};
  const next = { ...current, ...patch };
  if (typeof next.proxyUrl === "string") next.proxyUrl = next.proxyUrl.trim().replace(/\/$/, "");
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
  height: "",
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
