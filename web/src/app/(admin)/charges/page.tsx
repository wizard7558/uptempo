import { getChargeLog } from "@/actions/charges";
import { ChargeLog } from "@/components/admin/charge-log";
import { requireStaff } from "@/lib/auth/rbac";
import {
  processingRateBps,
  processingRateLabel,
} from "@/lib/billing/processing-fee";
import { isSingleMode } from "@/lib/config/mode";
import { getTenantBySlug } from "@/lib/tenant/registry";
import messages from "@/i18n/messages/en.json";

const copy = messages.settings.billing;

async function processingHeader(): Promise<string | null> {
  if (isSingleMode()) return null;
  const { tenantSlug } = await requireStaff();
  const tenant = await getTenantBySlug(tenantSlug);
  if (!tenant) return null;
  if (tenant.comped === 1) return copy.chargesHeaderNone;
  return copy.chargesHeader.replace(
    "{label}",
    processingRateLabel(
      processingRateBps({
        comped: tenant.comped,
        processingRateBps: tenant.processingRateBps,
      }),
    ),
  );
}

export default async function ChargesPage() {
  const [charges, header] = await Promise.all([
    getChargeLog(),
    processingHeader(),
  ]);

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Charges</h1>
        <p className="text-muted-foreground mt-1">
          View all policy charges, fees, and refunds.
        </p>
        {header ? (
          <p className="mt-1 text-sm font-medium" data-testid="charges-processing-header">
            {header}
          </p>
        ) : null}
      </div>
      <ChargeLog charges={charges} />
    </div>
  );
}
