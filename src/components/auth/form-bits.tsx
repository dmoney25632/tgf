import Link from "next/link";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

const TONES = {
  error: "border-destructive/40 bg-destructive/10 text-destructive",
  success: "border-emerald-500/40 bg-emerald-500/10 text-emerald-300",
  info: "border-sky-500/40 bg-sky-500/10 text-sky-200",
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
    <p className="rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-xs text-amber-200">
      Guest mode: Supabase isn&apos;t configured, so accounts, co-op and saved stats are off.{" "}
      <Link href="/dashboard" className="underline">
        Play solo as a guest
      </Link>
      .
    </p>
  );
}
