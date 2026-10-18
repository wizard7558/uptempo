"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { authClient } from "@/lib/auth/client";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Loader2 } from "lucide-react";
import { identifyPostHogUser } from "@/lib/analytics/posthog-provider";
import { notifyNativeAuthSuccess } from "@/lib/native/push-register";

function safeAppPath(path: string | undefined): string | null {
  if (!path || !path.startsWith("/") || path.startsWith("//")) return null;
  return path;
}

export function LoginForm({ callbackUrl }: { callbackUrl?: string }) {
  const router = useRouter();
  const afterLogin = safeAppPath(callbackUrl) ?? "/onboarding";
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setIsSubmitting(true);

    try {
      const result = await authClient.signIn.email({
        email,
        password,
        callbackURL: afterLogin,
      });

      if (result.error) {
        setError("Invalid email or password");
      } else {
        notifyNativeAuthSuccess();
        identifyPostHogUser(result.data?.user?.id ?? email, { email });
        router.push(afterLogin);
      }
    } catch {
      setError("Something went wrong. Please try again.");
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <>
      {error && (
        <div className="rounded-md bg-destructive/10 p-3 text-sm text-destructive">
          {error}
        </div>
      )}

      <form onSubmit={handleLogin} className="space-y-4">
        <Field htmlFor="email" label="Email" required>
          <Field.Input
            id="email"
            type="email"
            placeholder="you@example.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            autoComplete="email"
          />
        </Field>
        <Field htmlFor="password" label="Password" required>
          <Field.Input
            id="password"
            type="password"
            placeholder="Your password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            autoComplete="current-password"
          />
        </Field>
        <Button
          type="submit"
          className="w-full"
          variant="default"
          
          disabled={isSubmitting || !email || !password}
        >
          {isSubmitting ? (
            <>
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              Signing in...
            </>
          ) : (
            "Sign in"
          )}
        </Button>
      </form>
    </>
  );
}
