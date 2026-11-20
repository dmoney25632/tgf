import type { Viewport } from "next";

/**
 * Game routes: edge-to-edge on phones (the HUD and touch controls pad
 * themselves with the safe-area insets), and no pinch/double-tap zoom while
 * playing.
 */
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  viewportFit: "cover",
  themeColor: "#000000",
};

export default function PlayLayout({ children }: LayoutProps<"/play">) {
  return children;
}
