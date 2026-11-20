import Link from "next/link";
import { Suspense } from "react";
import { buttonVariants } from "@/components/ui/button-variants";
import { Card, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { ResetPasswordForm } from "@/components/auth/password-forms";
import { getCurrentUser } from "@/lib/auth";

export const metadata = { title: "Reset password · TGF" };

/**
 * Reached from the recovery email via /auth/confirm (which signs the user in
 * with the recovery token), or from the account page while signed in.
 */
export default function ResetPasswordPage() {
  return (
    <Suspense fallback={<div className="h-[360px] w-full max-w-sm rounded-xl border border-border bg-card" />}>
      <ResetPasswordContent />
    </Suspense>
  );
}

async function ResetPasswordContent() {
  const user = await getCurrentUser();

  if (!user || user.offline) {
    return (
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle className="text-xl">Reset link expired</CardTitle>
          <CardDescription>
            {user?.offline
              ? "Accounts aren't available in guest mode (Supabase isn't configured)."
              : "This password reset link is invalid or has expired. Request a new one."}
          </CardDescription>
        </CardHeader>
        <CardFooter className="justify-center gap-2">
          <Link href="/forgot-password" className={buttonVariants()}>
            Request a new link
          </Link>
          <Link href="/login" className={buttonVariants({ variant: "outline" })}>
            Log in
          </Link>
        </CardFooter>
      </Card>
    );
  }

  return <ResetPasswordForm email={user.email} />;
}
