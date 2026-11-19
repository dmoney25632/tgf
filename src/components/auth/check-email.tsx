"use client";

import Link from "next/link";
import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { resendConfirmation, type AuthState } from "@/app/(auth)/actions";
import { FormMessage, OfflineNotice } from "./form-bits";

/**
 * "Check your email" screen after sign-up or a reset request. For sign-ups
 * it also offers to resend the confirmation link. With no `email` it shows a
 * standalone resend form (the /check-email page).
 */
export function CheckEmailCard({
  email,
  reason,
  message,
  offline = false,
}: {
  email?: string;
  reason: "signup" | "reset" | "resend";
  message?: string;
  offline?: boolean;
}) {
  const [state, action, pending] = useActionState<AuthState, FormData>(resendConfirmation, {});
  const target = state.checkEmail ?? email;
  const showResend = reason !== "reset";

  return (
    <Card className="w-full max-w-sm">
      <CardHeader>
        <CardTitle className="text-xl">{target ? "Check your email" : "Resend confirmation"}</CardTitle>
        <CardDescription>
          {target ? (
            reason === "reset" ? (
              <>If an account exists for <strong className="text-foreground">{target}</strong>, we sent a link to reset your password.</>
            ) : (
              <>We sent a confirmation link to <strong className="text-foreground">{target}</strong>. Open it to activate your account.</>
            )
          ) : (
            "Didn't get the confirmation email? Enter your address and we'll send a fresh link."
          )}
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {offline && <OfflineNotice />}
        {message && <FormMessage tone="success">{message}</FormMessage>}
        {target && (
          <ul className="list-disc space-y-1 pl-5 text-xs text-muted-foreground">
            <li>The link works once and expires after about an hour.</li>
            <li>Check spam or promotions. It comes from the address set in Supabase.</li>
            <li>Links can take a minute or two to arrive.</li>
          </ul>
        )}
        {showResend && (
          <form action={action} className="flex flex-col gap-3">
            {target ? (
              <input type="hidden" name="email" value={target} />
            ) : (
              <div className="grid gap-2">
                <Label htmlFor="email">Email</Label>
                <Input id="email" name="email" type="email" autoComplete="email" required defaultValue={state.fields?.email} />
              </div>
            )}
            {state.error && <FormMessage tone="error">{state.error}</FormMessage>}
            {state.message && <FormMessage tone="success">{state.message}</FormMessage>}
            <Button type="submit" variant={target ? "outline" : "default"} disabled={pending || offline} className="w-full">
              {pending ? "Sending…" : target ? "Resend confirmation email" : "Send confirmation link"}
            </Button>
          </form>
        )}
      </CardContent>
      <CardFooter className="justify-center text-sm text-muted-foreground">
        <Link href="/login" className="text-foreground underline">
          Back to log in
        </Link>
      </CardFooter>
    </Card>
  );
}
