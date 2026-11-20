import type { Metadata } from "next";
import { Suspense } from "react";
import { Geist, Geist_Mono } from "next/font/google";
import { ParticleBackdrop } from "@/components/particle-backdrop";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "TGF",
  description: "Original browser-based first-person games.",
  // iPhone has no element full screen: "Add to Home Screen" launches full screen instead.
  appleWebApp: { capable: true, title: "Iron Horizon", statusBarStyle: "black" },
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`dark ${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        {/* usePathname() inside: needs its own Suspense boundary so it never blocks prerendering. */}
        <Suspense fallback={null}>
          <ParticleBackdrop />
        </Suspense>
        {children}
      </body>
    </html>
  );
}
