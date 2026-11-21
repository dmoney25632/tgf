import { Suspense } from "react";
import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { getGame } from "@/lib/games";
import { CharacterEditor } from "@/components/game/character-editor";

export const metadata = { title: "Character · TGF" };

export default function CharacterPage({ params }: PageProps<"/play/[gameId]/character">) {
  return (
    <Suspense fallback={<div className="fixed inset-0 bg-black" />}>
      <CharacterContent params={params} />
    </Suspense>
  );
}

async function CharacterContent({ params }: Pick<PageProps<"/play/[gameId]/character">, "params">) {
  const { gameId } = await params;
  if (getGame(gameId)?.id !== "iron-horizon") notFound();
  const user = await requireUser(`/play/${gameId}/character`);
  return <CharacterEditor callsign={user.callsign} backHref={`/play/${gameId}`} />;
}
