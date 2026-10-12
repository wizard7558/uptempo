import { notFound, redirect } from "next/navigation";
import { isSingleMode } from "@/lib/config/mode";
import { getSingleTenantSlug } from "@/lib/tenant/single";
import { SetupForm } from "./setup-form";

export const dynamic = "force-dynamic";

export default async function SetupPage() {
  if (!isSingleMode()) notFound();
  if (await getSingleTenantSlug()) redirect("/login");
  return (
    <div className="mx-auto flex min-h-screen max-w-md flex-col justify-center px-6 py-12">
      <h1 className="mb-6 text-2xl font-bold">Set up your business</h1>
      <SetupForm />
    </div>
  );
}
