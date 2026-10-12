/** Parse `host=slug,host=slug`. Blank segments are ignored. Hosts are lowercased. */
export function parseDomainMap(raw: string | undefined): Map<string, string> {
  const map = new Map<string, string>();
  if (!raw) return map;
  for (const part of raw.split(",")) {
    const trimmed = part.trim();
    if (!trimmed) continue;
    const eq = trimmed.indexOf("=");
    if (eq <= 0) continue;
    const host = trimmed.slice(0, eq).trim().toLowerCase();
    const slug = trimmed.slice(eq + 1).trim();
    if (host && slug) map.set(host, slug);
  }
  return map;
}

let cachedRaw: string | undefined;
let cachedMap: Map<string, string> | null = null;

export function createStaticReader(): {
  readonly id: "static";
  lookup(host: string): Promise<string | null>;
} {
  return {
    id: "static",
    async lookup(host: string) {
      const raw = process.env.UPTEMPO_DOMAIN_MAP;
      if (!cachedMap || cachedRaw !== raw) {
        cachedMap = parseDomainMap(raw);
        cachedRaw = raw;
      }
      return cachedMap.get(host.toLowerCase()) ?? null;
    },
  };
}
