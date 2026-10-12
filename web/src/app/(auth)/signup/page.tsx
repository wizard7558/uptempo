import Image from "next/image";
import Link from "next/link";
import { SignupForm } from "./signup-form";

export default function SignupPage() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4 py-12">
      <div className="w-full max-w-lg space-y-6 border border-[var(--line)] bg-[var(--ivory-raised)] p-8">
        <div className="mb-4 space-y-4 text-center">
          <div className="mb-4 flex justify-center">
            <Image src="/uptempo.svg" alt="Uptempo" width={64} height={64} priority />
          </div>
          <h1 className="text-xs font-medium tracking-[0.16em] text-[var(--ink)]">
            Uptempo
          </h1>
        </div>

        <SignupForm />

        <p className="text-center text-sm text-[var(--ink-soft)]">
          Already have an account?{" "}
          <Link href="/login" className="editorial-link text-xs">
            Sign in
          </Link>
        </p>
      </div>
    </div>
  );
}
