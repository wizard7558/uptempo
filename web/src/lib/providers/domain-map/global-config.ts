import { get } from "@vercel/global-config";

export function createGlobalConfigReader(): {
  readonly id: "global-config";
  lookup(host: string): Promise<string | null>;
} {
  return {
    id: "global-config",
    async lookup(host: string) {
      try {
        const mappings = await get<Record<string, string>>("domain_mappings");
        if (mappings && host in mappings) return mappings[host] ?? null;
        return null;
      } catch {
        return null;
      }
    },
  };
}
