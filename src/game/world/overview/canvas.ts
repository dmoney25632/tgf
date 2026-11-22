import type { MapDef } from "../MapLoader";
import { renderOverview, type OverviewImage } from "./rasterize";

/**
 * Browser side of the overview: the rasterised image as a canvas (HUD) or a
 * data URL (lobby cards), generated on first use and cached per map + scale
 * for the session.
 */
const canvases = new Map<string, { canvas: HTMLCanvasElement; img: OverviewImage }>();
const urls = new Map<string, string>();

export function overviewCanvas(def: MapDef, scale = 6, maxSize = 2048) {
  const key = `${def.id}@${scale}/${maxSize}`;
  let hit = canvases.get(key);
  if (!hit) {
    const img = renderOverview(def, { scale, maxSize });
    const canvas = document.createElement("canvas");
    canvas.width = img.width;
    canvas.height = img.height;
    const g = canvas.getContext("2d")!;
    g.putImageData(new ImageData(new Uint8ClampedArray(img.data), img.width, img.height), 0, 0);
    hit = { canvas, img };
    canvases.set(key, hit);
  }
  return hit;
}

/** A small overview as a PNG data URL (lobby thumbnails). Cached; ~10–60 ms on first call per map. */
export function overviewUrl(def: MapDef, maxSize = 360) {
  const key = `${def.id}/${maxSize}`;
  let url = urls.get(key);
  if (!url) {
    url = overviewCanvas(def, 8, maxSize).canvas.toDataURL("image/png");
    urls.set(key, url);
  }
  return url;
}

export function cachedOverviewUrl(def: MapDef, maxSize = 360) {
  return urls.get(`${def.id}/${maxSize}`) ?? null;
}
