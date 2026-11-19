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
  /** CSS gradient used as card art until real key art exists. */
  art: string;
};

export const GAMES: GameEntry[] = [
  {
    id: "iron-horizon",
    title: "Iron Horizon",
    tagline: "Tight, grounded modern combat. Hold the outpost against wave after wave.",
    genre: "Tactical FPS",
    modes: ["Survival", "Firing Range", "Team Deathmatch (soon)"],
    status: "prototype",
    featured: true,
    art: "linear-gradient(135deg, #2b2f22 0%, #5b5a3a 45%, #c27b2c 100%)",
  },
  {
    id: "null-sector",
    title: "Null Sector",
    tagline: "Extraction shooter in a city that forgot the lights.",
    genre: "Extraction",
    modes: ["Solo", "Squads"],
    status: "coming-soon",
    art: "linear-gradient(135deg, #0d1b2a 0%, #1b263b 50%, #3a86ff 100%)",
  },
  {
    id: "breakpoint-arena",
    title: "Breakpoint Arena",
    tagline: "Fast 3v3 rounds. One life, one plant.",
    genre: "Arena",
    modes: ["3v3 Elimination"],
    status: "coming-soon",
    art: "linear-gradient(135deg, #2a0d12 0%, #5c1a24 50%, #e63946 100%)",
  },
];

export function getGame(id: string) {
  return GAMES.find((g) => g.id === id);
}
