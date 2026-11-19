import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { GameEntry } from "@/lib/games";

const STATUS_LABEL: Record<GameEntry["status"], string> = {
  playable: "Live",
  prototype: "Prototype",
  "coming-soon": "Coming soon",
};

export function GameCard({ game }: { game: GameEntry }) {
  const playable = game.status !== "coming-soon";

  return (
    <article
      className={cn(
        "group relative flex flex-col overflow-hidden rounded-xl border border-border bg-card",
        game.featured && "md:col-span-2",
      )}
    >
      <div
        className={cn("relative flex items-end p-5", game.featured ? "h-56" : "h-36")}
        style={{ background: game.art }}
      >
        {/* Subtle scanline texture over the placeholder art */}
        <div className="pointer-events-none absolute inset-0 bg-[repeating-linear-gradient(0deg,transparent_0_3px,rgba(0,0,0,0.18)_3px_4px)]" />
        <div className="relative">
          {game.featured && (
            <p className="mb-1 font-mono text-[11px] tracking-[0.25em] text-white/80 uppercase">
              Featured
            </p>
          )}
          <h3
            className={cn(
              "font-bold tracking-tight text-white drop-shadow",
              game.featured ? "text-4xl" : "text-2xl",
            )}
          >
            {game.title}
          </h3>
        </div>
        <Badge variant="secondary" className="absolute top-4 right-4">
          {STATUS_LABEL[game.status]}
        </Badge>
      </div>
      <div className="flex flex-1 flex-col gap-3 p-5">
        <p className="text-sm text-muted-foreground">{game.tagline}</p>
        <div className="flex flex-wrap gap-1.5">
          <Badge variant="outline">{game.genre}</Badge>
          {game.modes.map((m) => (
            <Badge key={m} variant="outline" className="text-muted-foreground">
              {m}
            </Badge>
          ))}
        </div>
        <div className="mt-auto pt-2">
          {playable ? (
            <Link href={`/play/${game.id}`} className={cn(buttonVariants({ size: "lg" }), "w-full")}>
              Play
            </Link>
          ) : (
            <span className={cn(buttonVariants({ variant: "outline", size: "lg" }), "pointer-events-none w-full opacity-50")}>
              In development
            </span>
          )}
        </div>
      </div>
    </article>
  );
}
