import { Suspense } from "react";
import { getCurrentUser, requireAccount } from "@/lib/auth";
import { CoopApp } from "@/components/coop/coop-app";

export const metadata = { title: "Co-op · Iron Horizon · TGF" };

export default function CoopPage() {
  return (
    <Suspense
      fallback={
        <div className="fixed inset-0 flex items-center justify-center bg-black font-mono text-xs tracking-[0.3em] text-neutral-500 uppercase">
          Loading…
        </div>
      }
    >
      <CoopContent />
    </Suspense>
  );
}

async function CoopContent() {
  const user = await getCurrentUser();
  // Offline dev (no Supabase env): co-op runs over the BroadcastChannel
  // loopback between tabs so it can be tested without a project.
  if (user?.offline && process.env.NODE_ENV !== "production") {
    return <CoopApp userId={null} callsign={user.callsign} transport="local" />;
  }
  // Co-op needs a real account: guests are sent to sign in.
  const account = await requireAccount("/coop");
  return <CoopApp userId={account.id} callsign={account.callsign} transport="supabase" allowLocal={process.env.NODE_ENV !== "production"} />;
}
