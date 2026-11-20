import Link from "next/link";
import { Button, buttonVariants } from "@/components/ui/button";
import type { SessionUser } from "@/lib/auth";

export function SiteHeader({ user, hideNav }: { user?: SessionUser | null; hideNav?: boolean }) {
  return (
    <header className="sticky top-0 z-20 border-b border-border/60 bg-background/80 backdrop-blur">
      <div className="mx-auto flex h-14 max-w-6xl items-center justify-between px-4">
        <Link href={user ? "/dashboard" : "/"} className="font-mono text-lg font-bold tracking-[0.3em]">
          TGF
        </Link>
        {user ? (
          <div className="flex items-center gap-3">
            <Link href="/leaderboard" className="text-sm text-muted-foreground hover:text-foreground">
              Leaderboard
            </Link>
            <Link
              href="/account"
              className="hidden text-sm text-muted-foreground hover:text-foreground sm:inline"
              title="Account"
            >
              {user.callsign}
              {user.offline && " · guest"}
            </Link>
            {!user.offline && (
              <form action="/auth/signout" method="post">
                <Button type="submit" variant="ghost" size="sm">
                  Sign out
                </Button>
              </form>
            )}
          </div>
        ) : hideNav ? null : (
          <nav className="flex items-center gap-2">
            <Link href="/login" className={buttonVariants({ variant: "ghost", size: "sm" })}>
              Log in
            </Link>
            <Link href="/signup" className={buttonVariants({ size: "sm" })}>
              Sign up
            </Link>
          </nav>
        )}
      </div>
    </header>
  );
}
