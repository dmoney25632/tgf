import Link from "next/link";
import { Suspense } from "react";
import { SiteHeader } from "@/components/site-header";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { FormMessage } from "@/components/auth/form-bits";
import { requireUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { CallsignForm } from "./callsign-form";

export const metadata = { title: "Account · TGF" };

const UPDATED: Record<string, string> = {
  password: "Password updated.",
  email: "Email address confirmed.",
};

export default function AccountPage({ searchParams }: PageProps<"/account">) {
  return (
    <Suspense fallback={<SiteHeader user={null} hideNav />}>
      <AccountContent searchParams={searchParams} />
    </Suspense>
  );
}

type StatRow = { game_id: string; matches: number; wins: number; kills: number; deaths: number; shots_fired: number; shots_hit: number };

async function AccountContent({ searchParams }: Pick<PageProps<"/account">, "searchParams">) {
  const user = await requireUser("/account");
  const { updated } = await searchParams;
  const notice = typeof updated === "string" ? UPDATED[updated] : undefined;

  let createdAt: string | null = null;
  let stats: StatRow[] = [];
  if (!user.offline) {
    const supabase = await createClient();
    const [{ data: profile }, { data: statRows }] = await Promise.all([
      supabase.from("profiles").select("created_at").eq("id", user.id).maybeSingle(),
      supabase
        .from("player_stats")
        .select("game_id, matches, wins, kills, deaths, shots_fired, shots_hit")
        .eq("user_id", user.id),
    ]);
    createdAt = profile?.created_at ?? null;
    stats = (statRows ?? []) as StatRow[];
  }

  return (
    <>
      <SiteHeader user={user} />
      <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-6 px-4 py-10">
        <h1 className="text-3xl font-bold tracking-tight">Account</h1>
        {notice && <FormMessage tone="success">{notice}</FormMessage>}

        {user.offline ? (
          <Card>
            <CardHeader>
              <CardTitle>Guest mode</CardTitle>
              <CardDescription>
                Supabase isn&apos;t configured, so you&apos;re playing as a local guest. Solo play works; co-op and
                saved stats need an account. Add your keys to <code>.env.local</code> (see the README).
              </CardDescription>
            </CardHeader>
          </Card>
        ) : (
          <>
            <Card>
              <CardHeader>
                <CardTitle>Profile</CardTitle>
                <CardDescription>
                  {user.email}
                  {createdAt && <> · enlisted {new Date(createdAt).toLocaleDateString("en-US", { dateStyle: "medium" })}</>}
                </CardDescription>
              </CardHeader>
              <CardContent>
                <CallsignForm current={user.callsign} />
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Service record</CardTitle>
                <CardDescription>Only you can see these totals. The public leaderboard shows your callsign and totals, never your email.</CardDescription>
              </CardHeader>
              <CardContent>
                {stats.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No matches recorded yet.</p>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead className="text-left text-xs text-muted-foreground uppercase">
                        <tr>
                          <th className="py-1 pr-3">Game</th>
                          <th className="py-1 pr-3 text-right">Matches</th>
                          <th className="py-1 pr-3 text-right">Wins</th>
                          <th className="py-1 pr-3 text-right">K/D</th>
                          <th className="py-1 text-right">Accuracy</th>
                        </tr>
                      </thead>
                      <tbody className="font-mono tabular-nums">
                        {stats.map((s) => (
                          <tr key={s.game_id} className="border-t border-border/60">
                            <td className="py-1 pr-3 font-sans">{s.game_id}</td>
                            <td className="py-1 pr-3 text-right">{s.matches}</td>
                            <td className="py-1 pr-3 text-right">{s.wins}</td>
                            <td className="py-1 pr-3 text-right">{(s.kills / Math.max(1, s.deaths)).toFixed(2)}</td>
                            <td className="py-1 text-right">
                              {s.shots_fired > 0 ? `${((100 * s.shots_hit) / s.shots_fired).toFixed(1)}%` : "–"}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Security</CardTitle>
              </CardHeader>
              <CardContent className="flex flex-wrap gap-2">
                <Link href="/reset-password" className={buttonVariants({ variant: "outline" })}>
                  Change password
                </Link>
                <form action="/auth/signout" method="post">
                  <Button type="submit" variant="ghost">
                    Sign out
                  </Button>
                </form>
              </CardContent>
            </Card>
          </>
        )}
      </main>
    </>
  );
}
