import Link from "next/link";
import { SiteHeader } from "@/components/site-header";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export default function LandingPage() {
  return (
    <>
      <SiteHeader />
      <main className="relative flex flex-1 flex-col">
        <section
          className="relative flex min-h-[70dvh] items-center overflow-hidden px-4"
          style={{ background: "radial-gradient(ellipse at 70% 30%, #5b5a3a55 0%, transparent 60%), linear-gradient(180deg, #0b0c0a 0%, #151710 100%)" }}
        >
          <div className="mx-auto w-full max-w-6xl">
            <p className="font-mono text-xs tracking-[0.3em] text-amber-400/80 uppercase">
              Now in prototype · Iron Horizon
            </p>
            <h1 className="mt-4 max-w-3xl text-5xl font-bold tracking-tight sm:text-6xl">
              Browser shooters that load in seconds and play like the real thing.
            </h1>
            <p className="mt-5 max-w-xl text-lg text-muted-foreground">
              TGF is a platform of original first-person games. No installs. Sign up, pick a loadout,
              and deploy straight from your browser.
            </p>
            <div className="mt-8 flex flex-wrap gap-3">
              <Link href="/signup" className={cn(buttonVariants({ size: "lg" }), "h-11 px-6")}>
                Create account
              </Link>
              <Link href="/dashboard" className={cn(buttonVariants({ variant: "outline", size: "lg" }), "h-11 px-6")}>
                Go to dashboard
              </Link>
            </div>
          </div>
        </section>
      </main>
    </>
  );
}
