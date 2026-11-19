"use client";

import Link from "next/link";
import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { login, signup, signInWithOAuth, type AuthState } from "@/app/(auth)/actions";

type Props = {
  mode: "login" | "signup";
  next?: string;
  initialError?: string;
  offline: boolean;
};

export function AuthForm({ mode, next, initialError, offline }: Props) {
  const [state, action, pending] = useActionState<AuthState, FormData>(
    mode === "login" ? login : signup,
    { error: initialError },
  );
  const isLogin = mode === "login";

  return (
    <Card className="w-full max-w-sm">
      <CardHeader>
        <CardTitle className="text-xl">{isLogin ? "Log in" : "Enlist"}</CardTitle>
        <CardDescription>
          {isLogin
            ? "Welcome back, operator."
            : "Create your TGF account to save loadouts and stats."}
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {offline && (
          <p className="rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-xs text-amber-200">
            Offline dev mode: Supabase isn&apos;t configured.{" "}
            <Link href="/dashboard" className="underline">
              Go to the dashboard as a guest
            </Link>
            .
          </p>
        )}
        <form action={action} className="flex flex-col gap-4">
          <input type="hidden" name="next" value={next ?? "/dashboard"} />
          {!isLogin && (
            <div className="grid gap-2">
              <Label htmlFor="callsign">Callsign</Label>
              <Input id="callsign" name="callsign" placeholder="Ghostline" required minLength={3} maxLength={16} />
            </div>
          )}
          <div className="grid gap-2">
            <Label htmlFor="email">Email</Label>
            <Input id="email" name="email" type="email" autoComplete="email" required />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="password">Password</Label>
            <Input
              id="password"
              name="password"
              type="password"
              autoComplete={isLogin ? "current-password" : "new-password"}
              required
              minLength={isLogin ? undefined : 8}
            />
          </div>
          {state.error && <p className="text-sm text-destructive">{state.error}</p>}
          {state.message && <p className="text-sm text-emerald-400">{state.message}</p>}
          <Button type="submit" disabled={pending} className="w-full">
            {pending ? "Working…" : isLogin ? "Log in" : "Create account"}
          </Button>
        </form>
        <form action={signInWithOAuth}>
          <input type="hidden" name="provider" value="github" />
          <Button type="submit" variant="outline" className="w-full" disabled={offline}>
            Continue with GitHub
          </Button>
        </form>
      </CardContent>
      <CardFooter className="justify-center text-sm text-muted-foreground">
        {isLogin ? (
          <span>
            New here?{" "}
            <Link href="/signup" className="text-foreground underline">
              Create an account
            </Link>
          </span>
        ) : (
          <span>
            Already enlisted?{" "}
            <Link href="/login" className="text-foreground underline">
              Log in
            </Link>
          </span>
        )}
      </CardFooter>
    </Card>
  );
}
