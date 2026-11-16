// Client for the owner's proxy. The app never talks to Gemini directly and never sends prompts:
// it calls fixed wardrobe tasks; the proxy builds the prompts, picks the models and enforces
// the clothing-only scope. The API key lives only in the proxy.
import { getSettings } from "./settings.js";
import { base64ToBlob, blobToBase64 } from "./image.js";

export class SetupError extends Error {}

// fetch() only says "Failed to fetch". A second, opaque request tells the two real causes apart:
// the server is unreachable (wrong address, no internet) or it answered but the browser hid the
// answer (the Worker crashed or this site is not in ALLOWED_ORIGINS).
async function explainFetchFailure(proxyUrl) {
  if (typeof navigator !== "undefined" && navigator.onLine === false) return "Нет интернета. Проверь подключение и попробуй ещё раз.";
  try {
    await fetch(`${proxyUrl}/status`, { mode: "no-cors", cache: "no-store" });
  } catch {
    return `Сервер ${proxyUrl} недоступен. Проверь адрес сервера в «Профиле» и интернет.`;
  }
  const origin = typeof location !== "undefined" ? location.origin : "";
  return `Сервер отвечает, но браузер не показывает ответ. Владельцу: проверь, что в Worker привязан KV «USAGE» и что адрес ${origin} есть в ALLOWED_ORIGINS, потом сделай Deploy.`;
}

async function call(path, { method = "GET", body } = {}) {
  const settings = await getSettings();
  if (!settings.proxyUrl) throw new SetupError("Не указан адрес сервера. Открой «Профиль» → «Доступ».");
  if (!settings.accessCode) throw new SetupError("Не указан код доступа. Открой «Профиль» → «Доступ».");
  let response;
  try {
    response = await fetch(`${settings.proxyUrl}${path}`, {
      method,
      headers: { ...(body ? { "Content-Type": "application/json" } : {}), "X-Access-Code": settings.accessCode },
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new Error(await explainFetchFailure(settings.proxyUrl));
  }
  const result = await response.json().catch(() => ({}));
  if (response.status === 401) throw new SetupError("Код доступа не подошёл. Проверь его в «Профиле» → «Доступ».");
  if (!response.ok) throw new Error(typeof result.error === "string" ? result.error : `Ошибка сервера (${response.status})`);
  return result;
}

const task = (name, input) => call(`/api/${name}`, { method: "POST", body: input });

// GET /status: who am I and how much of today's limit is left.
export const checkConnection = () => call("/status");

async function toPayload(blob) {
  return { mimeType: blob.type || "image/png", data: await blobToBase64(blob) };
}

const toBlob = (image) => base64ToBlob(image.data, image.mimeType || "image/png");

const plainItem = (i) => ({ id: i.id, name: i.name, part: i.part, color: i.color, secondaryColor: i.secondaryColor || undefined, tags: i.tags || [], brand: i.brand || undefined });

export async function analyzeClothing(imageBlob) {
  const { items } = await task("detect", { image: await toPayload(imageBlob) });
  return (items || []).map((item) => {
    const [ymin = 0, xmin = 0, ymax = 1000, xmax = 1000] = item.box_2d || [];
    return { name: item.name, part: item.part, color: item.color, secondaryColor: item.secondaryColor || null, tags: item.tags, boundingBox: { x: xmin, y: ymin, width: xmax - xmin, height: ymax - ymin } };
  });
}

export async function cutoutGarment({ image, metadata, chromaKey, direction }) {
  const { image: out } = await task("cutout", { image: await toPayload(image), metadata: plainItem(metadata), chromaKey, direction: direction || "" });
  return toBlob(out);
}

export async function modeledPhoto({ person, garment, direction }) {
  const { image: out } = await task("modeled", { person: await toPayload(person), garment: await toPayload(garment), direction: direction || "" });
  return toBlob(out);
}

// items[i] describes garments[i] (name, category, colour), so the fitting room keeps each piece exact.
export async function tryOnOutfit({ person, garments, items = [], tuck }) {
  const { image: out } = await task("tryon", { person: await toPayload(person), garments: await Promise.all(garments.map(toPayload)), items: items.map(plainItem), tuck: Boolean(tuck) });
  return toBlob(out);
}

export async function planTask({ items, profile, feedback, learned, occasion, count }) {
  return task("plan", { wardrobe: items.map(plainItem), profile, feedback, learned, occasion, count });
}

export async function gapsTask({ items, profile, feedback, learned }) {
  return task("gaps", { wardrobe: items.map(plainItem), profile, feedback, learned });
}

export async function learnTask({ comment, outfitItems, liked, rules }) {
  return task("learn", { comment, outfitItems: outfitItems.map(plainItem), liked, rules });
}

export async function paletteTask(selfieBlob) {
  return task("palette", { image: await toPayload(selfieBlob) });
}
