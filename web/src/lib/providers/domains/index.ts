import { getUptempoMode } from "@/lib/config/mode";
import { readProviderEnv, resolveDomainsProviderId } from "../env";
import type { DomainsProvider } from "./types";
import {
  addDomainToVercel,
  getDomainFromVercel,
  removeDomainFromVercel,
  verifyDomainOnVercel,
} from "./vercel";

export type { DomainsProvider } from "./types";

const noneProvider: DomainsProvider = { id: "none", enabled: false };

/** Selects the project-domain backend. Single mode is always off. */
export function getDomainsProvider(): DomainsProvider {
  if (resolveDomainsProviderId(readProviderEnv(), getUptempoMode()) !== "vercel") {
    return noneProvider;
  }
  return {
    id: "vercel",
    enabled: true,
    add: addDomainToVercel,
    get: getDomainFromVercel,
    verify: verifyDomainOnVercel,
    remove: removeDomainFromVercel,
  };
}
