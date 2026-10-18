import Image from "next/image";
import Link from "next/link";
import { VERTICAL_IDS, type VerticalId } from "@/lib/verticals";
import { SignupForm } from "./signup-form";

function parseIndustry(value: string | string[] | undefined): VerticalId | null {
  return typeof value === "string" && (VERTICAL_IDS as readonly string[]).includes(value)
    ? (value as VerticalId)
    : null;
}

export default async function SignupPage({
  searchParams,
}: {
  searchParams: Promise<{ industry?: string | string[] }>;
}) {
  const initialIndustry = parseIndustry((await searchParams).industry);
  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4 py-12">
      <div className="w-full max-w-lg space-y-6 border border-[var(--line)] bg-[var(--ivory-raised)] p-8">
        <div className="mb-4 space-y-4 text-center">
          <h1 className="mb-4 flex justify-center">
            <Image src="/brand/wordmark.svg" alt="Uptempo" width={190} height={36} priority className="dark:invert" />
          </h1>
        </div>

        <SignupForm initialIndustry={initialIndustry} />

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
