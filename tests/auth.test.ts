// Auth input validation and redirect safety (src/lib/supabase/validation.ts).
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  authErrorMessage,
  defaultNextFor,
  loginErrorMessage,
  parseConfirmType,
  parseOAuthProviders,
  safeNext,
  validateCallsign,
  validateEmail,
  validateNewPassword,
} from "../src/lib/supabase/validation";

test("safeNext only allows same-site relative paths", () => {
  assert.equal(safeNext("/play/iron-horizon?x=1"), "/play/iron-horizon?x=1");
  for (const bad of ["//evil.com", "/\\evil.com", "https://evil.com", "javascript:alert(1)", "/a\nb", "", null, ["/x"]]) {
    assert.equal(safeNext(bad), "/dashboard", String(bad));
  }
  assert.equal(safeNext("nope", "/account"), "/account");
});

test("callsign rule matches the SQL check", () => {
  assert.equal(validateCallsign("  Ghost_01 ").callsign, "Ghost_01");
  for (const bad of ["ab", "x".repeat(17), "has space", "émoji", "<script>", 5]) {
    assert.ok(validateCallsign(bad).error, String(bad));
  }
});

test("email and password validation", () => {
  assert.equal(validateEmail(" Op@Example.com ").email, "op@example.com");
  assert.ok(validateEmail("not-an-email").error);
  assert.ok(validateNewPassword("short").error);
  assert.ok(validateNewPassword("long enough", "different").error);
  assert.ok(validateNewPassword("x".repeat(73)).error);
  assert.equal(validateNewPassword("long enough", "long enough").password, "long enough");
});

test("confirm link types and landing pages", () => {
  assert.equal(parseConfirmType("email"), "email");
  assert.equal(parseConfirmType("recovery"), "recovery");
  assert.equal(parseConfirmType("sms"), null);
  assert.equal(defaultNextFor("recovery"), "/reset-password");
  assert.equal(defaultNextFor("email"), "/dashboard");
});

test("OAuth providers are opt-in and whitelisted", () => {
  assert.deepEqual(parseOAuthProviders(undefined), []);
  assert.deepEqual(parseOAuthProviders(" GitHub , evilcorp,discord"), ["github", "discord"]);
});

test("error messages never echo arbitrary text", () => {
  assert.equal(loginErrorMessage("link")?.includes("expired"), true);
  assert.equal(loginErrorMessage("Call 555-0100 to verify"), undefined);
  assert.equal(loginErrorMessage("__proto__"), undefined);
  assert.equal(authErrorMessage({ code: "invalid_credentials" }), "Wrong email or password.");
  assert.match(authErrorMessage({ message: "db detail leaked", status: 500 }), /Something went wrong/);
  assert.match(authErrorMessage({ status: 429 }), /Too many/);
});
