/**
 * Games hosted under /play/[gameId]. The play route looks the id up here and
 * renders that game's client entry point; saveMatch rejects unknown ids.
 * Adding a game is one entry here plus a case in src/app/play/[gameId]/page.tsx.
 */
export type GameEntry = {
  id: string;
  title: string;
  /** "coming-soon" games 404 on /play. */
  status: "playable" | "prototype" | "coming-soon";
};

export const GAMES: GameEntry[] = [{ id: "iron-horizon", title: "Iron Horizon", status: "prototype" }];

export function getGame(id: string) {
  return GAMES.find((g) => g.id === id);
}
