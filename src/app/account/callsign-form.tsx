"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { FormMessage } from "@/components/auth/form-bits";
import { updateCallsign, type CallsignState } from "./actions";

export function CallsignForm({ current }: { current: string }) {
  const [state, action, pending] = useActionState<CallsignState, FormData>(updateCallsign, {});

  return (
    <form action={action} className="flex flex-col gap-3">
      <div className="grid gap-2">
        <Label htmlFor="callsign">Callsign</Label>
        <div className="flex gap-2">
          <Input
            id="callsign"
            name="callsign"
            defaultValue={state.callsign ?? current}
            required
            minLength={3}
            maxLength={16}
            pattern="[A-Za-z0-9_\-]{3,16}"
            autoComplete="username"
            aria-describedby="callsign-hint"
          />
          <Button type="submit" disabled={pending}>
            {pending ? "Saving…" : "Save"}
          </Button>
        </div>
        <p id="callsign-hint" className="text-xs text-muted-foreground">
          3–16 letters, numbers, _ or -. Unique (case-insensitive).
        </p>
      </div>
      {state.error && <FormMessage tone="error">{state.error}</FormMessage>}
      {state.message && <FormMessage tone="success">{state.message}</FormMessage>}
    </form>
  );
}
