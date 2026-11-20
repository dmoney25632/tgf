import type { MetadataRoute } from "next";

/**
 * Web app manifest: "Add to Home Screen" / "Install app" launches straight
 * into the game, full screen and in landscape (iOS uses standalone).
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Iron Horizon · TGF",
    short_name: "Iron Horizon",
    description: "Original browser-based first-person shooter.",
    id: "/play/iron-horizon",
    start_url: "/play/iron-horizon",
    scope: "/",
    display: "fullscreen",
    display_override: ["fullscreen", "standalone"],
    orientation: "landscape",
    background_color: "#000000",
    theme_color: "#000000",
    categories: ["games"],
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icons/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
