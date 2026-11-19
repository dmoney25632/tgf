import { notFound } from "next/navigation";
import { connection } from "next/server";
import { makeRoomCode } from "@/game/net/transport";

export const metadata = { title: "Co-op split screen (dev) · TGF" };

/**
 * DEV ONLY: two co-op clients side by side in one page (host left, client
 * right) over the BroadcastChannel loopback, so both render loops keep
 * running (a background tab would be throttled). Optional ?lag=&jitter=&loss=
 * apply to the client. Click a pane to control that player.
 */
export default async function CoopDevPage({ searchParams }: PageProps<"/coop/dev">) {
  await connection();
  if (process.env.NODE_ENV === "production") notFound();
  const q = await searchParams;
  const one = (k: string) => (typeof q[k] === "string" ? (q[k] as string) : "");
  const code = makeRoomCode();
  const lag = `&lag=${Number(one("lag")) || 60}&jitter=${Number(one("jitter")) || 15}&loss=${Number(one("loss")) || 0}`;
  return (
    <div className="fixed inset-0 grid grid-cols-1 bg-black md:grid-cols-2">
      <iframe title="Host" src={`/coop?transport=local&autohost=${code}&autolaunch=2`} className="h-full w-full border-r border-white/20" allow="fullscreen" />
      <iframe title="Client" src={`/coop?transport=local&autojoin=${code}${lag}`} className="h-full w-full" allow="fullscreen" />
    </div>
  );
}
