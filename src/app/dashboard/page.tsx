import Link from "next/link";
import { Suspense } from "react";
import { SiteHeader } from "@/components/site-header";
import { GameCard } from "@/components/dashboard/game-card";
import { requireUser } from "@/lib/auth";
import { GAMES } from "@/lib/games";

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
        <h1 className="text-3xl font-bold tracking-tight">Welcome, {user.callsign}</h1>
        <p className="mt-1 text-muted-foreground">Pick a game to deploy into.</p>

        <section className="mt-8 grid gap-4 sm:grid-cols-2">
          <Link href="/missions" className="rounded-lg border border-border bg-card p-5 transition-colors hover:border-white/60">
            <p className="text-xs font-medium uppercase tracking-[0.2em] text-white">Campaign</p>
            <p className="mt-1 text-lg font-semibold">Missions</p>
            <p className="mt-1 text-sm text-muted-foreground">Three story operations in the Sarrow Basin. Solo with AI squadmates.</p>
          </Link>
          <Link href="/coop" className="rounded-lg border border-border bg-card p-5 transition-colors hover:border-white/60">
            <p className="text-xs font-medium uppercase tracking-[0.2em] text-white">Online</p>
            <p className="mt-1 text-lg font-semibold">Co-op Survival</p>
            <p className="mt-1 text-sm text-muted-foreground">Host or join a room code and hold out with 2–4 players. Account required.</p>
          </Link>
        </section>

        <section className="mt-8 grid gap-5 md:grid-cols-2 lg:grid-cols-3">
          {GAMES.map((game) => (
            <GameCard key={game.id} game={game} />
          ))}
        </section>
      </main>
    </>
  );
}
