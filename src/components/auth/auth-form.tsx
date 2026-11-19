"use client";

import Link from "next/link";
import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { login, signup, signInWithOAuth, type AuthState } from "@/app/(auth)/actions";
import type { OAuthProvider } from "@/lib/supabase/validation";
import { CheckEmailCard } from "./check-email";
import { FormMessage, OfflineNotice } from "./form-bits";

type Props = {
  mode: "login" | "signup";
  next?: string;
  initialError?: string;
  /** Shown above the form, e.g. "Co-op needs an account". */
  notice?: string;
  offline: boolean;
  oauthProviders?: OAuthProvider[];
};

const PROVIDER_LABEL: Record<OAuthProvider, string> = { github: "GitHub", google: "Google", discord: "Discord" };

export function AuthForm({ mode, next, initialError, notice, offline, oauthProviders = [] }: Props) {
  const [state, action, pending] = useActionState<AuthState, FormData>(mode === "login" ? login : signup, {
    error: initialError,
  });
  const isLogin = mode === "login";

  if (state.checkEmail) return <CheckEmailCard email={state.checkEmail} reason="signup" />;

  return (
    <Card className="w-full max-w-sm">
      <CardHeader>
        <CardTitle className="text-xl">{isLogin ? "Log in" : "Enlist"}</CardTitle>
        <CardDescription>
          {isLogin ? "Welcome back, operator." : "Create an account to save stats and join co-op squads."}
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {offline && <OfflineNotice />}
        {notice && !offline && <FormMessage tone="info">{notice}</FormMessage>}
        <form action={action} className="flex flex-col gap-4">
          <input type="hidden" name="next" value={next ?? "/dashboard"} />
          {!isLogin && (
            <div className="grid gap-2">
              <Label htmlFor="callsign">Callsign</Label>
              <Input
                id="callsign"
                name="callsign"
                placeholder="Ghostline"
                required
                minLength={3}
                maxLength={16}
                pattern="[A-Za-z0-9_\-]{3,16}"
                autoComplete="username"
                defaultValue={state.fields?.callsign}
                aria-describedby="callsign-hint"
              />
              <p id="callsign-hint" className="text-xs text-muted-foreground">
                3–16 letters, numbers, _ or -. Shown on the leaderboard and in co-op.
              </p>
            </div>
          )}
          <div className="grid gap-2">
            <Label htmlFor="email">Email</Label>
            <Input
              id="email"
              name="email"
              type="email"
              autoComplete="email"
              required
              defaultValue={state.fields?.email}
            />
          </div>
          <div className="grid gap-2">
            <div className="flex items-center justify-between">
              <Label htmlFor="password">Password</Label>
              {isLogin && (
                <Link href="/forgot-password" className="text-xs text-muted-foreground underline">
                  Forgot password?
                </Link>
              )}
            </div>
            <Input
              id="password"
              name="password"
              type="password"
              autoComplete={isLogin ? "current-password" : "new-password"}
              required
              minLength={isLogin ? undefined : 8}
              maxLength={72}
            />
          </div>
          {!isLogin && (
            <div className="grid gap-2">
              <Label htmlFor="confirm">Confirm password</Label>
              <Input id="confirm" name="confirm" type="password" autoComplete="new-password" required minLength={8} maxLength={72} />
            </div>
          )}
          {state.error && (
            <FormMessage tone="error">
              {state.error}
              {state.unconfirmed && (
                <>
                  {" "}
                  <Link href="/check-email" className="underline">
                    Resend confirmation
                  </Link>
                </>
              )}
            </FormMessage>
          )}
          {state.message && <FormMessage tone="success">{state.message}</FormMessage>}
          <Button type="submit" disabled={pending || offline} className="w-full">
            {pending ? "Working…" : isLogin ? "Log in" : "Create account"}
          </Button>
        </form>
        {oauthProviders.length > 0 && !offline && (
          <div className="flex flex-col gap-2">
            <p className="text-center text-xs text-muted-foreground">or</p>
            {oauthProviders.map((provider) => (
              <form key={provider} action={signInWithOAuth}>
                <input type="hidden" name="provider" value={provider} />
                <input type="hidden" name="next" value={next ?? "/dashboard"} />
                <Button type="submit" variant="outline" className="w-full">
                  Continue with {PROVIDER_LABEL[provider]}
                </Button>
              </form>
            ))}
          </div>
        )}
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
