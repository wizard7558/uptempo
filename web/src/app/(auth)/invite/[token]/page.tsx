import { getInvitationByToken } from "@/actions/team";
import { AcceptInviteForm } from "./accept-form";
import Image from "next/image";
import Link from "next/link";
import { auth } from "@/lib/auth/server";
import { headers } from "next/headers";
import { getTerms } from "@/lib/terms/server";
import { TermsProvider } from "@/lib/terms/client";
import { teamRoleLabel } from "@/lib/terms/role-label";

interface InvitePageProps {
  params: Promise<{ token: string }>;
}

export default async function InvitePage({ params }: InvitePageProps) {
  const { token } = await params;
  const result = await getInvitationByToken(token);
  const session = await auth.api.getSession({ headers: await headers() });
  const inviteEmailLower = result?.invitation.email.toLowerCase() ?? "";
  const sessionEmailLower = session?.user?.email?.toLowerCase() ?? "";
  const canJoinAsSignedInUser =
    !!session?.user?.id && sessionEmailLower === inviteEmailLower;

  if (!result) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background px-4 py-8">
        <div className="w-full max-w-md space-y-6 border border-[var(--line)] bg-[var(--ivory-raised)] p-8 text-center">
          <div className="flex justify-center mb-4">
            <Image
              src="/brand/wordmark.svg"
              alt="Uptempo"
              width={190}
              height={36}
              priority
              className="dark:invert"
            />
          </div>
          <h1 className="display text-3xl text-[var(--ink)]">
            Invalid invitation
          </h1>
          <p className="text-[var(--ink-soft)]">
            This invitation has expired or is no longer valid. Please ask the
            person who invited you to send a new invitation.
          </p>
          <Link
            href="/login"
            className="editorial-link text-xs"
          >
            Go to sign in
          </Link>
        </div>
      </div>
    );
  }

  const terms = await getTerms(result.invitation.tenantSlug);
  const roleLabel = teamRoleLabel(result.invitation.role, terms.staff.one);

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4 py-8">
      <div className="w-full max-w-md space-y-6 border border-[var(--line)] bg-[var(--ivory-raised)] p-8">
        <div className="mb-4 space-y-4 text-center">
          <h1 className="mb-4 flex justify-center">
            <Image
              src="/brand/wordmark.svg"
              alt="Uptempo"
              width={190}
              height={36}
              priority
              className="dark:invert"
            />
          </h1>
          <p className="text-sm text-[var(--ink-soft)]">
            You&apos;ve been invited to join{" "}
            <strong>{result.businessName}</strong> as a{" "}
            <strong>{roleLabel}</strong>
          </p>
        </div>

        <TermsProvider terms={terms}>
          <AcceptInviteForm
            token={token}
            email={result.invitation.email}
            businessName={result.businessName}
            role={result.invitation.role}
            canJoinAsSignedInUser={canJoinAsSignedInUser}
            isSignedInWrongEmail={
              !!session?.user?.id && sessionEmailLower !== inviteEmailLower
            }
          />
        </TermsProvider>
      </div>
    </div>
  );
}
