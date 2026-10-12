import { requireRole } from "@/lib/auth/rbac";
import { ImportClientsClient } from "./client";

export default async function ImportClientsPage() {
  await requireRole("owner", "admin");

  return (
    <div className="p-6 space-y-6">
      <ImportClientsClient />
    </div>
  );
}
