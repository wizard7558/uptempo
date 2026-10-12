"use client";

import { useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Loader2 } from "lucide-react";

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setIsSubmitting(true);

    try {
      const res = await fetch("/api/auth/forget-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, redirectTo: "/reset-password" }),
      });
      if (!res.ok) throw new Error("Request failed");
      setSent(true);
    } catch {
      setError("Something went wrong. Please try again.");
    } finally {
      setIsSubmitting(false);
    }
  }

  if (sent) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background px-4">
        <div className="w-full max-w-sm space-y-6 border border-[var(--line)] bg-[var(--ivory-raised)] p-8">
          <div className="space-y-2 text-center">
            <h1 className="display text-3xl text-[var(--ink)]">
              Check your email
            </h1>
            <p className="text-sm text-[var(--ink-soft)]">
              If an account exists for <span className="font-medium">{email}</span>,
              we sent a password reset link. Check your inbox and spam folder.
            </p>
          </div>
          <Link href="/login">
            <Button
              variant="outline"
              
              className="w-full"
            >
              Back to sign in
            </Button>
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="w-full max-w-sm space-y-6 border border-[var(--line)] bg-[var(--ivory-raised)] p-8">
        <div className="space-y-4 text-center mb-4">
          <div className="flex justify-center mb-4">
            <Image src="/uptempo.svg" alt="Uptempo" width={64} height={64} priority />
          </div>
          <h1 className="display text-3xl text-[var(--ink)]">
            Forgot your password?
          </h1>
          <p className="text-sm text-[var(--ink-soft)]">
            Enter your email and we&apos;ll send you a reset link.
          </p>
        </div>

        {error && (
          <div className="rounded-md bg-destructive/10 p-3 text-sm text-destructive">
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
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
          <Button
            type="submit"
            className="w-full"
            variant="default"
            
            disabled={isSubmitting || !email}
          >
            {isSubmitting ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Sending...
              </>
            ) : (
              "Send reset link"
            )}
          </Button>
        </form>

        <p className="text-center text-sm text-muted-foreground">
          Remember your password?{" "}
          <Link href="/login" className="editorial-link text-xs">
            Sign in
          </Link>
        </p>
      </div>
    </div>
  );
}
