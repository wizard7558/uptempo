import type * as V from "./vercel";

export type DomainsProvider =
  | {
      id: "vercel";
      enabled: true;
      add: typeof V.addDomainToVercel;
      get: typeof V.getDomainFromVercel;
      verify: typeof V.verifyDomainOnVercel;
      remove: typeof V.removeDomainFromVercel;
    }
  | { id: "none"; enabled: false };
