import Link from "next/link";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

const TONES = {
  error: "border-destructive/40 bg-destructive/10 text-destructive",
  success: "border-white/40 bg-white/10 text-white/90",
  info: "border-white/40 bg-white/10 text-white",
} as const;

export function FormMessage({ tone, children }: { tone: keyof typeof TONES; children: ReactNode }) {
  return (
    <p role={tone === "error" ? "alert" : "status"} className={cn("rounded-md border p-3 text-sm", TONES[tone])}>
      {children}
    </p>
  );
}

export function OfflineNotice() {
  return (
    <p className="rounded-md border border-white/40 bg-white/10 p-3 text-xs text-white">
      Guest mode: Supabase isn&apos;t configured, so accounts, co-op and saved stats are off.{" "}
      <Link href="/play/iron-horizon" className="underline">
        Play solo as a guest
      </Link>
      .
    </p>
  );
}
