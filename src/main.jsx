import React from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App.jsx";
import "./styles.css";

createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);

// Service worker only for the hosted web version; the Android app ships its files inside the APK.
const isNativeApp = Boolean(window.Capacitor?.isNativePlatform?.());
if ("serviceWorker" in navigator && import.meta.env.PROD && !isNativeApp) {
  window.addEventListener("load", () => navigator.serviceWorker.register("./sw.js"));
}

// Ask the browser to keep IndexedDB data (the whole wardrobe) instead of evicting it under storage pressure.
navigator.storage?.persist?.().catch(() => {});
