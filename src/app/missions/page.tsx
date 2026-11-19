import { Suspense } from "react";
import { requireUser } from "@/lib/auth";
import { MissionsClient } from "@/components/missions/missions-client";

export const metadata = { title: "Iron Horizon · Missions · TGF" };

export default function MissionsPage() {
  return (
    <Suspense
      fallback={
        <div className="fixed inset-0 flex items-center justify-center bg-black font-mono text-xs tracking-[0.3em] text-neutral-500 uppercase">
          Loading…
        </div>
      }
    >
      <MissionsContent />
    </Suspense>
  );
}

async function MissionsContent() {
  const user = await requireUser("/missions");
  return <MissionsClient callsign={user.callsign} />;
}
