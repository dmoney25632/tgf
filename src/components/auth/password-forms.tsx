"use client";

import Link from "next/link";
import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { requestPasswordReset, updatePassword, type AuthState } from "@/app/(auth)/actions";
import { CheckEmailCard } from "./check-email";
import { FormMessage, OfflineNotice } from "./form-bits";

export function ForgotPasswordForm({ offline }: { offline: boolean }) {
  const [state, action, pending] = useActionState<AuthState, FormData>(requestPasswordReset, {});

  if (state.checkEmail) return <CheckEmailCard email={state.checkEmail} reason="reset" />;

  return (
    <Card className="w-full max-w-sm">
      <CardHeader>
        <CardTitle className="text-xl">Forgot password</CardTitle>
        <CardDescription>Enter your account email and we&apos;ll send you a reset link.</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {offline && <OfflineNotice />}
        <form action={action} className="flex flex-col gap-4">
          <div className="grid gap-2">
            <Label htmlFor="email">Email</Label>
            <Input id="email" name="email" type="email" autoComplete="email" required defaultValue={state.fields?.email} />
          </div>
          {state.error && <FormMessage tone="error">{state.error}</FormMessage>}
          <Button type="submit" disabled={pending || offline} className="w-full">
            {pending ? "Sending…" : "Send reset link"}
          </Button>
        </form>
      </CardContent>
      <CardFooter className="justify-center text-sm text-muted-foreground">
        <Link href="/login" className="text-foreground underline">
          Back to log in
        </Link>
      </CardFooter>
    </Card>
  );
}

export function ResetPasswordForm({ email }: { email: string | null }) {
  const [state, action, pending] = useActionState<AuthState, FormData>(updatePassword, {});

  return (
    <Card className="w-full max-w-sm">
      <CardHeader>
        <CardTitle className="text-xl">Set a new password</CardTitle>
        <CardDescription>
          {email ? <>For <strong className="text-foreground">{email}</strong>.</> : "Choose a new password."}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form action={action} className="flex flex-col gap-4">
          {/* Lets password managers attach the new password to the right account. */}
          {email && <input type="email" name="username" autoComplete="username" value={email} readOnly hidden />}
          <div className="grid gap-2">
            <Label htmlFor="password">New password</Label>
            <Input id="password" name="password" type="password" autoComplete="new-password" required minLength={8} maxLength={72} />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="confirm">Confirm new password</Label>
            <Input id="confirm" name="confirm" type="password" autoComplete="new-password" required minLength={8} maxLength={72} />
          </div>
          {state.error && <FormMessage tone="error">{state.error}</FormMessage>}
          <Button type="submit" disabled={pending} className="w-full">
            {pending ? "Saving…" : "Update password"}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
