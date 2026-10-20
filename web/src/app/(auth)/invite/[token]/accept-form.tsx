"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import {
  acceptInvitation,
  joinBusinessFromInvitation,
} from "@/actions/team";
import { authClient } from "@/lib/auth/client";
import { landingPathForRole } from "@/lib/auth/landing";
import { notifyNativeAuthSuccess } from "@/lib/native/push-register";
import { Loader2 } from "lucide-react";
import Link from "next/link";
import { useT } from "@/lib/terms/client";

interface AcceptInviteFormProps {
  token: string;
  email: string;
  businessName: string;
  role: string;
  canJoinAsSignedInUser?: boolean;
  isSignedInWrongEmail?: boolean;
}

export function AcceptInviteForm({
  token,
  email,
  businessName,
  role,
  canJoinAsSignedInUser = false,
  isSignedInWrongEmail = false,
}: AcceptInviteFormProps) {
  const t = useT("auth");
  const router = useRouter();
  // Use the shared destination for this invitee's role after accepting the invitation.
  const landingPath = landingPathForRole(role);
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [requiresSignInRecovery, setRequiresSignInRecovery] = useState(false);

  const loginHref = `/login?callbackUrl=${encodeURIComponent(`/invite/${token}`)}`;
  const recoveryLoginHref = `/login?callbackUrl=${encodeURIComponent(landingPath)}`;

  async function handleJoinExisting() {
    setError(null);
    setIsSubmitting(true);
    try {
      const result = await joinBusinessFromInvitation(token);
      if (result.success) {
        router.push(landingPath);
      } else {
        setError(result.error);
      }
    } catch {
      setError("Something went wrong. Please try again.");
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (password !== confirmPassword) {
      setError("Passwords do not match");
      return;
    }

    if (password.length < 8) {
      setError("Password must be at least 8 characters");
      return;
    }

    setIsSubmitting(true);

    try {
      const result = await acceptInvitation(token, {
        name,
        email,
        password,
      });

      if (result.success) {
        let signInResult;
        try {
          signInResult = await authClient.signIn.email({
            email,
            password,
            callbackURL: landingPath,
          });
        } catch {
          setRequiresSignInRecovery(true);
          return;
        }
        if (signInResult.error) {
          setRequiresSignInRecovery(true);
          return;
        }
        notifyNativeAuthSuccess();
        router.push(landingPath);
      } else {
        setError(result.error);
      }
    } catch {
      setError("Something went wrong. Please try again.");
    } finally {
      setIsSubmitting(false);
    }
  }

  if (isSignedInWrongEmail) {
    return (
      <div className="space-y-4 text-center">
        <p className="text-sm text-muted-foreground">
          You&apos;re signed in with a different email than this invitation.
          Sign out and sign in as <strong>{email}</strong>, then open this link
          again.
        </p>
        <Button
          variant="outline"
          
          className="w-full"
          asChild
        >
          <Link href={loginHref}>Sign in with invited email</Link>
        </Button>
      </div>
    );
  }

  if (canJoinAsSignedInUser) {
    return (
      <div className="space-y-4">
        {error && (
          <div className="rounded-md bg-destructive/10 p-3 text-sm text-destructive">
            {error}
          </div>
        )}
        <p className="text-sm text-muted-foreground text-center">
          You&apos;re signed in as <strong>{email}</strong>. Join{" "}
          <strong>{businessName}</strong> with this account?
        </p>
        <Button
          type="button"
          className="w-full"
          variant="default"
          
          disabled={isSubmitting}
          onClick={() => void handleJoinExisting()}
        >
          {isSubmitting ? (
            <>
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              Joining…
            </>
          ) : (
            t("acceptForm.joinButton")
          )}
        </Button>
      </div>
    );
  }

  if (requiresSignInRecovery) {
    return (
      <div className="space-y-4 text-center">
        <p className="text-sm text-muted-foreground">
          Your invitation was accepted, but automatic sign-in failed. Sign in
          with the invited email and password to continue.
        </p>
        <Button className="w-full" variant="default" asChild>
          <Link href={recoveryLoginHref}>Sign in</Link>
        </Button>
      </div>
    );
  }

  return (
    <>
      {error && (
        <div className="rounded-md bg-destructive/10 p-3 text-sm text-destructive">
          {error}
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-4">
        <Field htmlFor="accept-name" label="Your name" required>
          <Field.Input
            id="accept-name"
            type="text"
            placeholder="Jane Smith"
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
            autoComplete="name"
          />
        </Field>

        <Field htmlFor="accept-email" label="Email">
          <Field.Input
            id="accept-email"
            type="email"
            value={email}
            readOnly
            className="opacity-80"
          />
        </Field>

        <Field htmlFor="accept-password" label="Password" required>
          <Field.Input
            id="accept-password"
            type="password"
            placeholder="Min 8 characters"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            minLength={8}
            autoComplete="new-password"
          />
        </Field>

        <Field htmlFor="accept-confirm-password" label="Confirm password" required>
          <Field.Input
            id="accept-confirm-password"
            type="password"
            placeholder="Re-enter password"
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
            required
            minLength={8}
            autoComplete="new-password"
          />
        </Field>

        <Button
          type="submit"
          className="w-full"
          variant="default"
          
          disabled={isSubmitting}
        >
          {isSubmitting ? (
            <>
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              Creating your account...
            </>
          ) : (
            "Accept & Create Account"
          )}
        </Button>

        <p className="text-center text-sm text-muted-foreground">
          Already have an account?{" "}
          <Link
            href={loginHref}
            className="editorial-link text-xs"
          >
            Sign in to join
          </Link>
        </p>
      </form>
    </>
  );
}
