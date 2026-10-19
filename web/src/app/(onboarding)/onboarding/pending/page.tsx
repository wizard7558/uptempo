import { getT } from "@/lib/terms/server";
import { auth } from "@/lib/auth/server";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { publicDb } from "@/lib/db";
import { user } from "@/lib/db/schema/auth";
import { eq } from "drizzle-orm";
import { getTenantBySlug } from "@/lib/tenant/registry";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Clock } from "lucide-react";
import { SignOutButton } from "../../sign-out-button";

/**
 * Holding page for staff (stylists/assistants) who reach an unlaunched salon.
 * The admin layout's onboarding gate redirects non-owners here; owners go to
 * the wizard instead. No wizard access from this page.
 */
export default async function OnboardingPendingPage() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect("/login");

  const [dbUser] = await publicDb
    .select({ tenantSlug: user.tenantSlug })
    .from(user)
    .where(eq(user.id, session.user.id))
    .limit(1);

  const tenantSlug = dbUser?.tenantSlug ?? null;
  const tenant = tenantSlug ? await getTenantBySlug(tenantSlug) : null;

  // Salon already launched — send staff into the app.
  if (tenant && (tenant.onboardingSteps as { launched?: boolean } | null)?.launched) {
    redirect("/schedule");
  }

  const t = await getT("onboarding", tenantSlug);
  const businessName = tenant?.name ?? t("pending.defaultName");

  return (
    <div className="mx-auto flex max-w-lg flex-col items-center px-6 py-16">
      <Card className="w-full text-center">
        <CardHeader>
          <div className="mx-auto mb-2 flex h-12 w-12 items-center justify-center rounded-full bg-muted">
            <Clock className="h-6 w-6 text-muted-foreground" />
          </div>
          <CardTitle>Almost there</CardTitle>
          <CardDescription>
            {businessName} is still being set up by the owner. You&apos;ll get
            access as soon as it launches.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex justify-center">
          <SignOutButton />
        </CardContent>
      </Card>
    </div>
  );
}
