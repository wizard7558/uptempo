import { getChargeLog } from "@/actions/charges";
import { ChargeLog } from "@/components/admin/charge-log";

export default async function ChargesPage() {
  const charges = await getChargeLog();

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Charges</h1>
        <p className="text-muted-foreground mt-1">
          View all policy charges, fees, and refunds.
        </p>
      </div>
      <ChargeLog charges={charges} />
    </div>
  );
}
