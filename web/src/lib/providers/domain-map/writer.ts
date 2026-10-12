import { get } from "@vercel/global-config";
import { getUptempoMode } from "@/lib/config/mode";
import { readProviderEnv, resolveDomainMapProviderId } from "../env";

export interface DomainMapWriter {
  upsert(domain: string, slug: string): Promise<void>;
  remove(domain: string): Promise<void>;
}

/**
 * Vercel documents PATCH /v1/global-config/{id}/items (the Edge Config path was renamed).
 * Team-scoped configs require teamId.
 */
function itemsUrl(): string {
  const id = process.env.GLOBAL_CONFIG_ID ?? process.env.EDGE_CONFIG_ID;
  const base = `https://api.vercel.com/v1/global-config/${id}/items`;
  const team = process.env.VERCEL_TEAM_ID?.trim();
  return team ? `${base}?teamId=${encodeURIComponent(team)}` : base;
}

async function patchMappings(value: Record<string, string>): Promise<void> {
  await fetch(itemsUrl(), {
    method: "PATCH",
    headers: {
      Authorization: `Bearer ${process.env.VERCEL_TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      items: [{ operation: "upsert", key: "domain_mappings", value }],
    }),
  });
}

function createGlobalConfigWriter(): DomainMapWriter {
  return {
    async upsert(domain, slug) {
      const current = (await get<Record<string, string>>("domain_mappings")) ?? {};
      current[domain] = slug;
      await patchMappings(current);
    },
    async remove(domain) {
      const current = (await get<Record<string, string>>("domain_mappings")) ?? {};
      delete current[domain];
      await patchMappings(current);
    },
  };
}

const noopWriter: DomainMapWriter = {
  async upsert() {},
  async remove() {},
};

/** static and none do not persist a map. */
export function getDomainMapWriter(): DomainMapWriter {
  if (resolveDomainMapProviderId(readProviderEnv(), getUptempoMode()) === "global-config") {
    return createGlobalConfigWriter();
  }
  return noopWriter;
}
