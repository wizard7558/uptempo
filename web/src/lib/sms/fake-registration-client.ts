import { createHash } from "node:crypto";
import type { RegistrationClient, RegistrationResource } from "./registration";

export interface FakeRegistrationCall {
  method: string;
  resource?: string;
  attributes?: string[];
  hasEin?: boolean;
  einLast4?: string;
  usecase?: "LOW_VOLUME" | "SOLE_PROPRIETOR";
  brandType?: "STANDARD" | "SOLE_PROPRIETOR";
  messageSamples?: string[];
}

export interface FakeRegistrationRecorder {
  calls: FakeRegistrationCall[];
  failOnceAt: Set<string>;
}

export interface FakeRegistrationOptions {
  recorder?: FakeRegistrationRecorder;
  identityStatus?: string | (() => string);
  brandStatus?: string | (() => string);
  campaignStatus?: string | (() => string);
  profileCompliant?: boolean | (() => boolean);
  trustProductCompliant?: boolean | (() => boolean);
  delayOnceAt?: string;
  delayMs?: number;
}

const sharedRecorder: FakeRegistrationRecorder = { calls: [], failOnceAt: new Set() };

export function createFakeRegistrationRecorder(): FakeRegistrationRecorder {
  return { calls: [], failOnceAt: new Set() };
}

function deterministicSid(prefix: string, identity: string): string {
  return prefix + createHash("sha256").update(identity).digest("hex").slice(0, 32).toUpperCase();
}

function describeAttributes(attributes: Record<string, string | number | boolean> | undefined): Pick<FakeRegistrationCall, "attributes" | "hasEin" | "einLast4"> {
  if (!attributes) return {};
  const ein = attributes.business_registration_number;
  const digits = typeof ein === "string" ? ein.replaceAll("-", "") : "";
  return {
    attributes: Object.keys(attributes).sort(),
    ...(digits ? { hasEin: true, einLast4: digits.slice(-4) } : {}),
  };
}

function optionBoolean(value: boolean | (() => boolean) | undefined): boolean {
  return typeof value === "function" ? value() : value ?? true;
}

function optionStatus(value: string | (() => string) | undefined, fallback: string): string {
  return typeof value === "function" ? value() : value ?? fallback;
}

export function createFakeRegistrationClient(options: FakeRegistrationOptions = {}): RegistrationClient {
  const recorder = options.recorder ?? sharedRecorder;
  let delayed = false;
  const record = (method: string, resource?: string, attributes?: Record<string, string | number | boolean>) => {
    recorder.calls.push({ method, ...(resource ? { resource } : {}), ...describeAttributes(attributes) });
    if (recorder.failOnceAt.has(method)) {
      recorder.failOnceAt.delete(method);
      throw new Error("fake_registration_transient_failure");
    }
  };
  const resource = (method: string, identity: string, attributes?: Record<string, string | number | boolean>): RegistrationResource => {
    record(method, identity, attributes);
    return { sid: deterministicSid("BU", method + ":" + identity) };
  };
  const assignment = (method: string, target: string, object: string): RegistrationResource =>
    resource(method, target + ":" + object);
  const delayOnce = async (method: string) => {
    if (delayed || options.delayOnceAt !== method) return;
    delayed = true;
    await new Promise((resolve) => setTimeout(resolve, options.delayMs ?? 30));
  };

  return {
    createBusinessInformation: async (input) => resource("createBusinessInformation", input.friendlyName, input.attributes),
    updateBusinessInformation: async (sid, attributes) => { record("updateBusinessInformation", sid, attributes); },
    createProfile: async (input) => resource("createProfile", input.friendlyName),
    createRepresentative: async (input) => resource("createRepresentative", input.friendlyName, input.attributes),
    updateRepresentative: async (sid, attributes) => { record("updateRepresentative", sid, attributes); },
    createAddress: async (input) => resource("createAddress", input.friendlyName),
    updateAddress: async (sid, businessName, address) => {
      record("updateAddress", sid, { businessName, ...address });
    },
    createAddressDocument: async (input) => resource("createAddressDocument", input.friendlyName),
    updateAddressDocument: async (sid, addressSid) => { record("updateAddressDocument", sid, { addressSid }); },
    createA2PProfileInformation: async (input) => resource("createA2PProfileInformation", input.friendlyName, { company_type: "private" }),
    updateA2PProfileInformation: async (sid) => { record("updateA2PProfileInformation", sid); },
    createStarterInformation: async (input) => resource("createStarterInformation", input.friendlyName, input.attributes),
    createSoleProprietorInformation: async (input) => resource("createSoleProprietorInformation", input.friendlyName, input.attributes),
    updateStarterInformation: async (sid, attributes) => { record("updateStarterInformation", sid, attributes); },
    updateSoleProprietorInformation: async (sid, attributes) => { record("updateSoleProprietorInformation", sid, attributes); },
    assignProfile: async (profileSid, objectSid) => assignment("assignProfile", profileSid, objectSid),
    assignProfileToPrimary: async (primarySid, profileSid) => assignment("assignProfileToPrimary", primarySid, profileSid),
    assignPrimaryToStarter: async (starterSid, primarySid) => assignment("assignPrimaryToStarter", starterSid, primarySid),
    assignTrustProduct: async (trustProductSid, objectSid) => assignment("assignTrustProduct", trustProductSid, objectSid),
    evaluateProfile: async (profileSid) => {
      const sid = deterministicSid("BU", "evaluateProfile:" + profileSid);
      record("evaluateProfile", profileSid);
      return { sid, compliant: optionBoolean(options.profileCompliant) };
    },
    submitProfile: async (profileSid) => { record("submitProfile", profileSid); },
    createTrustProduct: async (input) => resource("createTrustProduct", input.friendlyName),
    evaluateTrustProduct: async (trustProductSid) => {
      const sid = deterministicSid("BU", "evaluateTrustProduct:" + trustProductSid);
      record("evaluateTrustProduct", trustProductSid);
      return { sid, compliant: optionBoolean(options.trustProductCompliant) };
    },
    submitTrustProduct: async (trustProductSid) => { record("submitTrustProduct", trustProductSid); },
    createBrand: async (input) => {
      await delayOnce("createBrand");
      const result = resource("createBrand", input.customerProfileSid + ":" + input.trustProductSid);
      recorder.calls.at(-1)!.brandType = input.brandType;
      return result;
    },
    updateBrand: async (brandSid) => { record("updateBrand", brandSid); },
    fetchBrand: async (brandSid) => {
      record("fetchBrand", brandSid);
      const identityStatus = typeof options.identityStatus === "function"
        ? options.identityStatus()
        : options.identityStatus ?? "SELF_DECLARED";
      return { status: optionStatus(options.brandStatus, "APPROVED"), identityStatus };
    },
    createMessagingService: async (input) => resource("createMessagingService", input.friendlyName),
    createCampaign: async (input) => {
      record("createCampaign", input.messagingServiceSid + ":" + input.brandSid);
      recorder.calls.at(-1)!.usecase = input.usecase;
      recorder.calls.at(-1)!.messageSamples = [...input.messageSamples];
      return { sid: deterministicSid("BU", "createCampaign:" + input.messagingServiceSid + ":" + input.brandSid) };
    },
    updateCampaign: async (input) => {
      record("updateCampaign", input.campaignSid);
      recorder.calls.at(-1)!.usecase = input.usecase;
      recorder.calls.at(-1)!.messageSamples = [...input.messageSamples];
    },
    fetchCampaign: async (_serviceSid, campaignSid) => {
      record("fetchCampaign", campaignSid);
      return { status: optionStatus(options.campaignStatus, "VERIFIED") };
    },
    findLocalNumber: async (input) => {
      record("findLocalNumber", [input.areaCode, input.region].join(":"));
      return { phoneNumber: "+12065550100" };
    },
    purchaseNumber: async (input) => {
      const result = resource("purchaseNumber", input.phoneNumber);
      return { ...result, phoneNumber: input.phoneNumber };
    },
    attachNumber: async (messagingServiceSid, phoneNumberSid) => assignment("attachNumber", messagingServiceSid, phoneNumberSid),
    resendBrandOtp: async (brandSid) => { record("resendBrandOtp", brandSid); },
  };
}

/** Resets the process-shared recorder used when tests opt into the fake without a recorder. */
export function resetFakeRegistrationClient(): void {
  sharedRecorder.calls.length = 0;
  sharedRecorder.failOnceAt.clear();
}
