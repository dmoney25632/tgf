import Link from "next/link";
import { buttonVariants } from "@/components/ui/button";

export const metadata = { title: "Not found · TGF" };

export default function NotFound() {
  return (
    <main className="mx-auto flex w-full max-w-md flex-1 flex-col items-center justify-center gap-4 px-4 py-16 text-center">
      <p className="font-mono text-xs tracking-[0.3em] text-white/80 uppercase">404</p>
      <h1 className="text-2xl font-bold">Off the map</h1>
      <p className="text-sm text-muted-foreground">That page or game doesn&apos;t exist (yet).</p>
      <Link href="/play/iron-horizon" className={buttonVariants()}>
        Back to the lobby
      </Link>
    </main>
  );
}
