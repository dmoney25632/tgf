import type { Metadata } from "next";
import { ParticleRifle } from "@/components/landing/particle-rifle";

export const metadata: Metadata = {
  title: "TGF",
  description: "Original browser-based first-person games. Click the rifle to enter.",
};

export default function LandingPage() {
  return (
    <main className="relative min-h-dvh bg-black">
      <h1 className="sr-only">TGF: original browser first-person games</h1>
      <ParticleRifle href="/login" />
    </main>
  );
}
