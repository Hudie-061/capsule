import { forwardRef } from "react";

// The original used an IPX image server; the app now runs without a server,
// and all wardrobe images are local object URLs, so a plain <img> is enough.
export const OptimizedImage = forwardRef(function OptimizedImage({ src, alt = "", sizes = "100vw", priority = false, loading, decoding, breakpoints, quality, ...props }, ref) {
  return <img ref={ref} src={src} alt={alt} sizes={sizes} loading={loading || (priority ? "eager" : "lazy")} decoding={decoding || "async"} {...props} />;
});
