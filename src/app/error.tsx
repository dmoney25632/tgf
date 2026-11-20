"use client";

import Link from "next/link";
import { useEffect } from "react";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/** Route-level fallback for unexpected runtime errors. */
export default function Error({ error, retry }: { error: unknown; retry: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <main className="mx-auto flex w-full max-w-md flex-1 flex-col items-center justify-center gap-4 px-4 py-16 text-center">
      <p className="font-mono text-xs tracking-[0.3em] text-red-400/80 uppercase">Signal lost</p>
      <h1 className="text-2xl font-bold">Something went wrong</h1>
      <p className="text-sm text-muted-foreground">An unexpected error interrupted this page. Try again, or head back to the lobby.</p>
      <div className="flex gap-2">
        <button type="button" onClick={() => retry()} className={buttonVariants()}>
          Try again
        </button>
        <Link href="/play/iron-horizon" className={cn(buttonVariants({ variant: "outline" }))}>
          Dashboard
        </Link>
      </div>
    </main>
  );
}
