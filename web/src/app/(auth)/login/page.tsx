import Image from "next/image";
import Link from "next/link";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth/server";
import { LoginForm } from "./login-form";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ callbackUrl?: string }>;
}) {
  const { callbackUrl } = await searchParams;

  // Already signed in (e.g. the native owner app cold-starts at /login) —
  // skip the form and continue into the app. Mirrors LoginForm's afterLogin.
  const session = await auth.api.getSession({ headers: await headers() });
  if (session?.user) {
    const safe =
      callbackUrl && callbackUrl.startsWith("/") && !callbackUrl.startsWith("//")
        ? callbackUrl
        : "/onboarding";
    redirect(safe);
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4 py-12">
      <div className="w-full max-w-sm space-y-6 border border-[var(--line)] bg-[var(--ivory-raised)] p-8">
        <div className="mb-8 space-y-4 text-center">
          <h1 className="mb-6 flex justify-center">
            <Image src="/brand/wordmark.svg" alt="Uptempo" width={190} height={36} priority className="dark:invert" />
          </h1>
          <p className="text-sm text-[var(--ink-soft)]">
            Sign in to manage your business
          </p>
        </div>

        <LoginForm callbackUrl={callbackUrl} />

        <p className="text-center text-sm">
          <Link href="/forgot-password" className="editorial-link text-xs">
            Forgot your password?
          </Link>
        </p>

        <p className="text-center text-sm text-[var(--ink-soft)]">
          Don&apos;t have an account?{" "}
          <Link href="/signup" className="editorial-link text-xs">
            Sign up
          </Link>
        </p>
      </div>
    </div>
  );
}
