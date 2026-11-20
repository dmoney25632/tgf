import Link from "next/link";
import { Suspense } from "react";
import { SiteHeader } from "@/components/site-header";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { requireUser } from "@/lib/auth";

export const metadata = { title: "Dashboard · TGF" };

export default function DashboardPage() {
  return (
    <Suspense fallback={<SiteHeader user={null} hideNav />}>
      <DashboardContent />
    </Suspense>
  );
}

async function DashboardContent() {
  const user = await requireUser("/dashboard");

  return (
    <>
      <SiteHeader user={user} />
      <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-10">
        {user.offline && (
          <p className="mb-6 rounded-md border border-white/40 bg-white/10 px-4 py-3 text-sm text-white">
            Offline dev mode — Supabase isn&apos;t configured, so you&apos;re playing as a local guest and
            stats won&apos;t be saved. Add keys to <code>.env.local</code> to enable accounts.
          </p>
        )}
        <section className="relative overflow-hidden rounded-2xl border border-white/15 bg-[radial-gradient(ellipse_at_80%_10%,rgba(255,255,255,.16),transparent_60%),linear-gradient(180deg,#0b0b0b,#000)] px-6 py-12 md:px-12 md:py-16">
          <p className="font-mono text-[11px] tracking-[0.3em] text-white/70 uppercase">Welcome back, {user.callsign}</p>
          <h1 className="mt-2 text-4xl font-black tracking-tight md:text-6xl">Iron Horizon</h1>
          <p className="mt-3 max-w-xl text-neutral-300">
            Hold the outpost against wave after wave — solo, or in a party of up to four. Pick Survival or the Firing Range in the lobby.
          </p>
          <div className="mt-8 flex flex-wrap gap-3">
            <Link href="/play/iron-horizon" className={cn(buttonVariants({ size: "lg" }), "h-14 px-10 text-lg font-bold tracking-wide")}>
              Play
            </Link>
          </div>
        </section>
      </main>
    </>
  );
}
