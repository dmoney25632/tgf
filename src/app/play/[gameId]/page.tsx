import { Suspense } from "react";
import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { getGame } from "@/lib/games";
import { IronHorizonClient } from "@/components/game/iron-horizon-client";

export async function generateMetadata({ params }: PageProps<"/play/[gameId]">) {
  const { gameId } = await params;
  return { title: `${getGame(gameId)?.title ?? "Play"} · TGF` };
}

export default function PlayPage({ params }: PageProps<"/play/[gameId]">) {
  return (
    <Suspense
      fallback={
        <div className="fixed inset-0 flex items-center justify-center bg-black font-mono text-xs tracking-[0.3em] text-neutral-500 uppercase">
          Loading…
        </div>
      }
    >
      <PlayContent params={params} />
    </Suspense>
  );
}

async function PlayContent({ params }: Pick<PageProps<"/play/[gameId]">, "params">) {
  const { gameId } = await params;
  const game = getGame(gameId);
  if (!game || game.status === "coming-soon") notFound();

  const user = await requireUser(`/play/${gameId}`);

  // Each playable game maps to its own client entry point.
  switch (game.id) {
    case "iron-horizon":
      return (
        <IronHorizonClient
          callsign={user.callsign}
          userId={user.offline ? null : user.id}
          // Offline dev runs parties over the tab-to-tab loopback; a guest on a live deployment can't party.
          partyTransport={user.offline ? (process.env.NODE_ENV !== "production" ? "local" : null) : "supabase"}
        />
      );
    default:
      notFound();
  }
}
