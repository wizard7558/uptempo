import { requireAdminRole } from "@/lib/auth/rbac";
import { getT } from "@/lib/terms/server";
import { CreateMyBusinessForm } from "./create-my-business-form";

export default async function CreateMyBusinessPage() {
  await requireAdminRole();
  const t = await getT("business");

  return (
    <div className="space-y-6 px-4 py-6 sm:px-6">
      <div>
        <h1 className="text-2xl font-bold">{t("createPage.title")}</h1>
        <p className="mt-1 text-muted-foreground">
          {t("createPage.description")}
        </p>
      </div>
      <CreateMyBusinessForm />
    </div>
  );
}
