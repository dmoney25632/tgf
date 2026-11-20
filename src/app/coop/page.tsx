import { Suspense } from "react";
import { redirect } from "next/navigation";

export const metadata = { title: "Co-op · Iron Horizon · TGF" };

/** Parties now live in the main Iron Horizon lobby; old /coop?room= links still land in the party. */
export default function CoopPage({ searchParams }: PageProps<"/coop">) {
  return (
    <Suspense fallback={<div className="fixed inset-0 bg-black" />}>
      <ToLobby searchParams={searchParams} />
    </Suspense>
  );
}

async function ToLobby({ searchParams }: Pick<PageProps<"/coop">, "searchParams">) {
  const q = await searchParams;
  const room = typeof q.room === "string" ? q.room : "";
  redirect(room ? `/play/iron-horizon?room=${encodeURIComponent(room)}` : "/play/iron-horizon");
  return null;
}
