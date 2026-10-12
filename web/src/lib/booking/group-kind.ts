/** What kind of group booking a set of members is. Pure: no I/O. */
export type GroupKind = "couples" | "party" | "multi_tech" | "crew";

export type GroupMemberShape = {
  clientId: string;
  serviceIds: string[];
  startTime: string | Date;
};

const startMs = (v: string | Date) => new Date(v).getTime();
const servicesKey = (ids: string[]) => [...ids].sort().join(",");

/**
 * - crew: one client, the same services, the same start (several techs at once)
 * - multi_tech: one client, different services or starts (mani then pedi)
 * - couples: exactly two different clients
 * - party: three or more clients
 */
export function deriveGroupKind(members: GroupMemberShape[]): GroupKind {
  const first = members[0];
  const sameClient = members.every((m) => m.clientId === first.clientId);
  if (sameClient) {
    const sameAll = members.every(
      (m) =>
        servicesKey(m.serviceIds) === servicesKey(first.serviceIds) &&
        startMs(m.startTime) === startMs(first.startTime),
    );
    return sameAll ? "crew" : "multi_tech";
  }
  return members.length === 2 ? "couples" : "party";
}
