import { notFound } from "next/navigation";
import { connection } from "next/server";
import { makeRoomCode } from "@/game/net/transport";
import { CoopApp } from "@/components/coop/coop-app";

export const metadata = { title: "Co-op split screen (dev) · TGF" };

/**
 * DEV ONLY: two co-op players side by side in one page (host left, client
 * right) over the BroadcastChannel loopback, so both render loops keep
 * running (a background tab would be throttled, and the CSP forbids
 * iframes). Optional ?lag=&jitter=&loss= apply to the client's inbound
 * traffic. Click a pane to control that player. Handles for dev tools:
 * window.__tgfHost / window.__tgfClient = { engine, net }.
 */
export default async function CoopDevPage({ searchParams }: PageProps<"/coop/dev">) {
  await connection();
  if (process.env.NODE_ENV === "production") notFound();
  const q = await searchParams;
  const num = (k: string, d: number) => {
    const v = Number(typeof q[k] === "string" ? q[k] : NaN);
    return Number.isFinite(v) ? v : d;
  };
  const code = makeRoomCode();
  const lag = `lag=${num("lag", 60)}&jitter=${num("jitter", 15)}&loss=${num("loss", 0)}`;
  return (
    <div className="fixed inset-0 grid grid-cols-2 bg-black">
      {/* transform makes each pane the containing block for the game's fixed overlays */}
      <div className="relative overflow-y-auto border-r border-white/20 [transform:translateZ(0)]">
        <CoopApp userId={null} callsign="Host" transport="local" devParams={`autohost=${code}&autolaunch=2`} />
      </div>
      <div className="relative overflow-y-auto [transform:translateZ(0)]">
        <CoopApp userId={null} callsign="Client" transport="local" devParams={`autojoin=${code}&${lag}`} />
      </div>
    </div>
  );
}
