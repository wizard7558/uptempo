import { getUptempoMode } from "@/lib/config/mode";
import { readProviderEnv, resolveDomainMapProviderId } from "../env";
import { createGlobalConfigReader } from "./global-config";
import { createStaticReader } from "./static";

export interface DomainMapReader {
  readonly id: "global-config" | "static" | "none";
  lookup(host: string): Promise<string | null>;
}

const noneReader: DomainMapReader = {
  id: "none",
  async lookup() {
    return null;
  },
};

/** Edge-safe. Middleware is the caller. */
export function getDomainMapReader(): DomainMapReader {
  switch (resolveDomainMapProviderId(readProviderEnv(), getUptempoMode())) {
    case "global-config":
      return createGlobalConfigReader();
    case "static":
      return createStaticReader();
    default:
      return noneReader;
  }
}
