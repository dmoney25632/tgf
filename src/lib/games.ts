/**
 * Registry of games on the TGF platform. The dashboard renders this array,
 * so adding a game is one entry here plus its route under /play.
 */
export type GameStatus = "playable" | "prototype" | "coming-soon";

export type GameEntry = {
  id: string;
  title: string;
  tagline: string;
  genre: string;
  modes: string[];
  status: GameStatus;
  featured?: boolean;
  /** Monochrome CSS backdrop for the card art (a halftone particle layer goes on top). */
  art: string;
};

export const GAMES: GameEntry[] = [
  {
    id: "iron-horizon",
    title: "Iron Horizon",
    tagline: "Tight, grounded modern combat. Hold the outpost against wave after wave.",
    genre: "Tactical FPS",
    modes: ["Survival", "Firing Range"],
    status: "prototype",
    featured: true,
    art: "radial-gradient(ellipse at 82% 18%, rgba(255,255,255,.22), transparent 58%), linear-gradient(180deg, #0b0b0b, #000)",
  },
];

export function getGame(id: string) {
  return GAMES.find((g) => g.id === id);
}
