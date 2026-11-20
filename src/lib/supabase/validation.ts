/**
 * Pure auth helpers (no Next or Supabase imports) so they can run in Server
 * Actions, Route Handlers, client components and the Node test runner alike.
 */

/** Same rule as the `profiles.callsign` check constraint in SQL. */
export const CALLSIGN_PATTERN = /^[A-Za-z0-9_-]{3,16}$/;
export const PASSWORD_MIN = 8;
/** bcrypt only uses the first 72 bytes; refuse longer so nothing is silently ignored. */
export const PASSWORD_MAX = 72;

export function validateCallsign(raw: unknown): { callsign?: string; error?: string } {
  const callsign = typeof raw === "string" ? raw.trim() : "";
  if (!CALLSIGN_PATTERN.test(callsign)) {
    return { error: "Callsign must be 3–16 characters: letters, numbers, _ or -." };
  }
  return { callsign };
}

export function validateEmail(raw: unknown): { email?: string; error?: string } {
  const email = typeof raw === "string" ? raw.trim().toLowerCase() : "";
  if (!email) return { error: "Enter your email address." };
  if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return { error: "That doesn't look like a valid email address." };
  }
  return { email };
}

export function validateNewPassword(raw: unknown, confirm?: unknown): { password?: string; error?: string } {
  const password = typeof raw === "string" ? raw : "";
  if (password.length < PASSWORD_MIN) return { error: `Password must be at least ${PASSWORD_MIN} characters.` };
  if (new TextEncoder().encode(password).length > PASSWORD_MAX) {
    return { error: `Password must be at most ${PASSWORD_MAX} bytes.` };
  }
  if (confirm !== undefined && confirm !== password) return { error: "Passwords don't match." };
  return { password };
}

/**
 * Only allow same-site relative redirects (blocks `//evil.com`, `/\evil.com`,
 * absolute URLs and control characters).
 */
export function safeNext(value: unknown, fallback = "/play/iron-horizon"): string {
  const next = typeof value === "string" ? value : "";
  if (!next.startsWith("/") || next.startsWith("//") || next.startsWith("/\\")) return fallback;
  if (/[\u0000-\u001f\\]/.test(next)) return fallback;
  return next;
}

/** OAuth providers this app knows how to offer. Others are rejected. */
export const OAUTH_PROVIDERS = ["github", "google", "discord"] as const;
export type OAuthProvider = (typeof OAUTH_PROVIDERS)[number];

/** Parses NEXT_PUBLIC_AUTH_OAUTH_PROVIDERS ("github,google") against the whitelist. */
export function parseOAuthProviders(raw: string | undefined): OAuthProvider[] {
  if (!raw) return [];
  const wanted = raw.split(",").map((s) => s.trim().toLowerCase());
  return OAUTH_PROVIDERS.filter((p) => wanted.includes(p));
}

/** Email link types the /auth/confirm route accepts for verifyOtp. */
export const EMAIL_OTP_TYPES = ["signup", "email", "recovery", "email_change", "invite", "magiclink"] as const;
export type ConfirmType = (typeof EMAIL_OTP_TYPES)[number];

export function parseConfirmType(raw: unknown): ConfirmType | null {
  return typeof raw === "string" && (EMAIL_OTP_TYPES as readonly string[]).includes(raw) ? (raw as ConfirmType) : null;
}

/** Where a verified email link lands when it carries no explicit `next`. */
export function defaultNextFor(type: ConfirmType): string {
  if (type === "recovery") return "/reset-password";
  if (type === "email_change") return "/account?updated=email";
  return "/play/iron-horizon";
}

type AuthErrorLike = { code?: string; message?: string; status?: number } | null | undefined;

/** Turns Supabase Auth errors into short, non-leaky messages for the UI. */
export function authErrorMessage(error: AuthErrorLike): string {
  if (!error) return "Something went wrong. Please try again.";
  switch (error.code) {
    case "invalid_credentials":
      return "Wrong email or password.";
    case "email_not_confirmed":
      return "Confirm your email first. Check your inbox, or resend the link below.";
    case "user_already_exists":
    case "email_exists":
      return "An account with that email already exists. Try logging in.";
    case "weak_password":
      return "That password is too weak. Use at least 8 characters with a mix of letters and numbers.";
    case "same_password":
      return "Your new password must be different from the old one.";
    case "email_address_invalid":
      return "That email address can't be used.";
    case "over_email_send_rate_limit":
    case "over_request_rate_limit":
      return "Too many attempts. Please wait a minute and try again.";
    case "otp_expired":
      return "That link has expired or was already used. Request a new one.";
    case "signup_disabled":
      return "Sign-ups are currently disabled.";
    case "session_not_found":
    case "refresh_token_not_found":
      return "Your session expired. Please log in again.";
  }
  if (error.status === 429) return "Too many attempts. Please wait a minute and try again.";
  return "Something went wrong. Please try again.";
}

/**
 * Error keys that routes may put in `/login?error=<key>`. The login page only
 * renders these fixed strings, never raw query text (no phishing-by-URL).
 */
export const LOGIN_ERRORS = {
  link: "That link is invalid, expired or was already used. Log in, or request a new link.",
  callback: "We couldn't sign you in. Please try again.",
  oauth: "Couldn't start that sign-in. Please try again.",
  provider: "That sign-in provider isn't enabled.",
  session: "Your session expired. Please log in again.",
} as const;

export function loginErrorMessage(key: unknown): string | undefined {
  return typeof key === "string" && Object.hasOwn(LOGIN_ERRORS, key)
    ? LOGIN_ERRORS[key as keyof typeof LOGIN_ERRORS]
    : undefined;
}
