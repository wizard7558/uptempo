import twilio from "twilio";
import type {
  RegistrationClient,
  RegistrationResource,
  RegistrationStatus,
} from "./registration";
import { RegistrationAdapterError } from "./registration-errors";

type TwilioClient = ReturnType<typeof twilio>;
type UnknownObject = Record<string, unknown>;
const SDK_REQUEST_TIMEOUT_MS = 8_000;
const INVENTORY_PAGE_SIZE = 50;
const MAX_INVENTORY_RECORDS = 100;

async function safeRequest<T>(operation: () => Promise<T>): Promise<T> {
  try {
    // Do not race this promise against a local timer: a timeout race can release
    // the tenant lease while the SDK request is still in flight, allowing a late
    // create after another worker has acquired the lease. Individual HTTP calls
    // have an 8s timeout and inventory scans are capped at three pages, keeping
    // the longest supported operation below the 90s registration lease.
    return await operation();
  } catch (error) {
    // Twilio errors may include request bodies. Never pass one to a logger or caller.
    if (error instanceof RegistrationAdapterError) throw error;
    throw new Error("twilio_registration_request_failed");
  }
}

/** Scan at most three inventory pages and fail closed when completeness is unknown. */
async function boundedList<T>(
  load: (options: { limit: number; pageSize: number }) => Promise<T[]>,
  maxRecords = MAX_INVENTORY_RECORDS,
): Promise<T[]> {
  const items = await load({ limit: maxRecords + 1, pageSize: INVENTORY_PAGE_SIZE });
  if (items.length > maxRecords) throw new RegistrationAdapterError("inventory_incomplete");
  return items;
}

function hasKnownCode(errors: unknown, codes: readonly string[]): boolean {
  if (!Array.isArray(errors)) return false;
  return errors.some((entry: unknown) => {
    if (typeof entry !== "object" || entry === null || !("code" in entry)) return false;
    const code = (entry as { code?: unknown }).code;
    return (typeof code === "string" || typeof code === "number") && codes.includes(String(code));
  });
}

function campaignFlags(messageSamples: readonly string[]) {
  return {
    hasEmbeddedLinks: messageSamples.some((sample) => /(?:https?:\/\/|www\.)\S+/i.test(sample)),
    hasEmbeddedPhone: messageSamples.some((sample) => /(?<!\w)(?:\+?1[\s().-]*)?(?:\(\d{3}\)|\d{3})[\s.-]*\d{3}[\s.-]*\d{4}(?!\d)/.test(sample)),
  };
}

function existingSid(resources: readonly UnknownObject[], friendlyName: string): string | null {
  const match = resources.find((item) => item.friendlyName === friendlyName);
  return typeof match?.sid === "string" ? match.sid : null;
}

export function createTwilioRegistrationClient(): RegistrationClient {
  const accountSid = process.env.TWILIO_ACCOUNT_SID;
  const authToken = process.env.TWILIO_AUTH_TOKEN;
  if (!accountSid || !authToken) throw new Error("twilio_registration_not_configured");
  // Each HTTP request is bounded well below the registration lease lifetime.
  const client = twilio(accountSid, authToken, { timeout: SDK_REQUEST_TIMEOUT_MS }) as TwilioClient;

  const createEndUser = async (
    type: string,
    input: { friendlyName: string; attributes: Record<string, string | number | boolean> },
  ): Promise<RegistrationResource> => safeRequest(async () => {
    const found = await boundedList((options) => client.trusthub.v1.endUsers.list(options));
    const sid = existingSid(found as unknown as UnknownObject[], input.friendlyName);
    if (sid) return { sid };
    const created = await client.trusthub.v1.endUsers.create({ ...input, type });
    return { sid: created.sid };
  });

  const createProfile = async (
    input: { friendlyName: string; email: string; policySid: string },
  ): Promise<RegistrationResource> => safeRequest(async () => {
    const found = await boundedList((options) => client.trusthub.v1.customerProfiles.list({
      friendlyName: input.friendlyName,
      policySid: input.policySid,
      ...options,
    }));
    const sid = existingSid(found as unknown as UnknownObject[], input.friendlyName);
    if (sid) return { sid };
    const created = await client.trusthub.v1.customerProfiles.create(input);
    return { sid: created.sid };
  });

  const assignment = async (
    targetSid: string,
    objectSid: string,
    kind: "profile" | "trust",
  ): Promise<RegistrationResource> => safeRequest(async () => {
    const list = kind === "profile"
      ? await boundedList((options) => client.trusthub.v1.customerProfiles(targetSid).customerProfilesEntityAssignments.list(options))
      : await boundedList((options) => client.trusthub.v1.trustProducts(targetSid).trustProductsEntityAssignments.list(options));
    const found = (list as unknown as UnknownObject[]).find((item) => item.objectSid === objectSid);
    if (typeof found?.sid === "string") return { sid: found.sid };
    const created = kind === "profile"
      ? await client.trusthub.v1.customerProfiles(targetSid).customerProfilesEntityAssignments.create({ objectSid })
      : await client.trusthub.v1.trustProducts(targetSid).trustProductsEntityAssignments.create({ objectSid });
    return { sid: created.sid };
  });

  const createTrustProduct = async (
    input: { friendlyName: string; email: string; policySid: string },
  ): Promise<RegistrationResource> => safeRequest(async () => {
    const found = await boundedList((options) => client.trusthub.v1.trustProducts.list({
      friendlyName: input.friendlyName,
      policySid: input.policySid,
      ...options,
    }));
    const sid = existingSid(found as unknown as UnknownObject[], input.friendlyName);
    if (sid) return { sid };
    const created = await client.trusthub.v1.trustProducts.create(input);
    return { sid: created.sid };
  });

  const createService = async (
    input: { friendlyName: string; inboundRequestUrl: string; statusCallback: string },
  ): Promise<RegistrationResource> => safeRequest(async () => {
    const found = await boundedList((options) => client.messaging.v1.services.list(options));
    const sid = existingSid(found as unknown as UnknownObject[], input.friendlyName);
    if (sid) return { sid };
    const created = await client.messaging.v1.services.create({
      friendlyName: input.friendlyName,
      inboundRequestUrl: input.inboundRequestUrl,
      inboundMethod: "POST",
      statusCallback: input.statusCallback,
      useInboundWebhookOnNumber: true,
    });
    return { sid: created.sid };
  });

  return {
    createBusinessInformation: (input) => createEndUser("customer_profile_business_information", input),
    updateBusinessInformation: (sid, attributes) => safeRequest(async () => {
      await client.trusthub.v1.endUsers(sid).update({ attributes });
    }),
    createProfile,
    createRepresentative: (input) => createEndUser("authorized_representative_1", input),
    updateRepresentative: (sid, attributes) => safeRequest(async () => {
      await client.trusthub.v1.endUsers(sid).update({ attributes });
    }),
    createAddress: (input) => safeRequest(async () => {
      const found = await boundedList((options) => client.addresses.list({ friendlyName: input.friendlyName, ...options }));
      const sid = existingSid(found as unknown as UnknownObject[], input.friendlyName);
      if (sid) return { sid };
      const created = await client.addresses.create({
        friendlyName: input.friendlyName,
        customerName: input.businessName,
        street: input.address.street,
        ...(input.address.street2 ? { streetSecondary: input.address.street2 } : {}),
        city: input.address.city,
        region: input.address.state,
        postalCode: input.address.postalCode,
        isoCountry: "US",
        autoCorrectAddress: false,
      });
      return { sid: created.sid };
    }),
    updateAddress: (sid, businessName, address) => safeRequest(async () => {
      await client.addresses(sid).update({
        customerName: businessName,
        street: address.street,
        ...(address.street2 ? { streetSecondary: address.street2 } : {}),
        city: address.city,
        region: address.state,
        postalCode: address.postalCode,
        autoCorrectAddress: false,
      });
    }),
    createAddressDocument: (input) => safeRequest(async () => {
      const friendlyName = input.friendlyName;
      const found = await boundedList((options) => client.trusthub.v1.supportingDocuments.list(options));
      const sid = existingSid(found as unknown as UnknownObject[], friendlyName);
      if (sid) return { sid };
      const created = await client.trusthub.v1.supportingDocuments.create({
        friendlyName,
        type: "customer_profile_address",
        attributes: { address_sids: input.addressSid },
      });
      return { sid: created.sid };
    }),
    updateAddressDocument: (sid, addressSid) => safeRequest(async () => {
      await client.trusthub.v1.supportingDocuments(sid).update({ attributes: { address_sids: addressSid } });
    }),
    createA2PProfileInformation: (input) => createEndUser("us_a2p_messaging_profile_information", {
      friendlyName: input.friendlyName,
      attributes: { company_type: "private" },
    }),
    updateA2PProfileInformation: (sid) => safeRequest(async () => {
      await client.trusthub.v1.endUsers(sid).update({ attributes: { company_type: "private" } });
    }),
    createStarterInformation: (input) => createEndUser("starter_customer_profile_information", input),
    createSoleProprietorInformation: (input) => createEndUser("sole_proprietor_information", input),
    updateStarterInformation: (sid, attributes) => safeRequest(async () => {
      await client.trusthub.v1.endUsers(sid).update({ attributes });
    }),
    updateSoleProprietorInformation: (sid, attributes) => safeRequest(async () => {
      await client.trusthub.v1.endUsers(sid).update({ attributes });
    }),
    assignProfile: (profileSid, objectSid) => assignment(profileSid, objectSid, "profile"),
    assignProfileToPrimary: (primarySid, profileSid) => assignment(profileSid, primarySid, "profile"),
    assignPrimaryToStarter: (starterSid, primarySid) => assignment(starterSid, primarySid, "profile"),
    assignTrustProduct: (trustSid, objectSid) => assignment(trustSid, objectSid, "trust"),
    evaluateProfile: (profileSid, policySid) => safeRequest(async () => {
      const response = await client.trusthub.v1.customerProfiles(profileSid)
        .customerProfilesEvaluations.create({ policySid });
      return { sid: response.sid, compliant: response.status === "compliant" };
    }),
    submitProfile: (profileSid) => safeRequest(async () => {
      await client.trusthub.v1.customerProfiles(profileSid).update({ status: "pending-review" });
    }),
    createTrustProduct,
    evaluateTrustProduct: (trustSid, policySid) => safeRequest(async () => {
      const response = await client.trusthub.v1.trustProducts(trustSid)
        .trustProductsEvaluations.create({ policySid });
      return { sid: response.sid, compliant: response.status === "compliant" };
    }),
    submitTrustProduct: (trustSid) => safeRequest(async () => {
      await client.trusthub.v1.trustProducts(trustSid).update({ status: "pending-review" });
    }),
    createBrand: (input) => safeRequest(async () => {
      const existing = await boundedList((options) => client.messaging.v1.brandRegistrations.list(options));
      const found = existing.find((brand) =>
        brand.customerProfileBundleSid === input.customerProfileSid &&
        brand.a2pProfileBundleSid === input.trustProductSid &&
        brand.brandType === input.brandType,
      );
      if (found) return { sid: found.sid };
      const created = await client.messaging.v1.brandRegistrations.create({
        customerProfileBundleSid: input.customerProfileSid,
        a2PProfileBundleSid: input.trustProductSid,
        brandType: input.brandType,
        ...(input.brandType === "STANDARD" ? { skipAutomaticSecVet: true } : {}),
      });
      return { sid: created.sid };
    }),
    updateBrand: (brandSid) => safeRequest(async () => {
      await client.messaging.v1.brandRegistrations(brandSid).update();
    }),
    fetchBrand: (brandSid): Promise<RegistrationStatus> => safeRequest(async () => {
      const result = await client.messaging.v1.brandRegistrations(brandSid).fetch();
      return {
        status: result.status,
        identityStatus: result.identityStatus,
        ...(result.status === "FAILED" && hasKnownCode(result.errors, ["21736"])
          ? { reasonCode: "domain_ownership" as const }
          : result.status === "FAILED" && hasKnownCode(result.errors, ["21738"])
            ? { reasonCode: "undeliverable_email" as const }
            : result.status === "FAILED" && hasKnownCode(result.errors, ["21740"])
              ? { reasonCode: "invalid_business_email" as const }
              : {}),
      };
    }),
    createMessagingService: createService,
    createCampaign: (input) => safeRequest(async () => {
      const service = client.messaging.v1.services(input.messagingServiceSid);
      const existing = await boundedList((options) => service.usAppToPerson.list(options));
      const matching = existing.find((campaign) => campaign.brandRegistrationSid === input.brandSid);
      if (matching?.sid) return { sid: matching.sid };
      const created = await service.usAppToPerson.create({
        brandRegistrationSid: input.brandSid,
        usAppToPersonUsecase: input.usecase,
        description: input.description,
        messageFlow: input.messageFlow,
        messageSamples: input.messageSamples,
        ...campaignFlags(input.messageSamples),
      });
      return { sid: created.sid };
    }),
    updateCampaign: (input) => safeRequest(async () => {
      // Twilio's installed API permits content updates here; campaign use case is immutable.
      await client.messaging.v1.services(input.messagingServiceSid).usAppToPerson(input.campaignSid).update({
        description: input.description,
        messageFlow: input.messageFlow,
        messageSamples: input.messageSamples,
        ...campaignFlags(input.messageSamples),
        ageGated: false,
        directLending: false,
      });
    }),
    fetchCampaign: (messagingServiceSid, campaignSid): Promise<RegistrationStatus> => safeRequest(async () => {
      const campaign = await client.messaging.v1.services(messagingServiceSid).usAppToPerson(campaignSid).fetch();
      return {
        status: campaign.campaignStatus,
        ...(campaign.campaignStatus === "FAILED" && hasKnownCode(campaign.errors, ["30909"])
          ? { reasonCode: "opt_in_flow" as const }
          : {}),
      };
    }),
    findLocalNumber: (input) => safeRequest(async () => {
      const numbers = await client.availablePhoneNumbers("US").local.list({
        ...(input.areaCode ? { areaCode: Number(input.areaCode) } : {}),
        ...(input.region ? { inRegion: input.region } : {}),
        smsEnabled: true,
        limit: 1,
        pageSize: 1,
      });
      return numbers[0] ? { phoneNumber: numbers[0].phoneNumber } : null;
    }),
    purchaseNumber: (input) => safeRequest(async () => {
      const existing = await boundedList(
        (options) => client.incomingPhoneNumbers.list({ phoneNumber: input.phoneNumber, ...options }),
        1,
      );
      if (existing[0]) {
        if (existing[0].friendlyName !== input.friendlyName) {
          throw new RegistrationAdapterError("number_unavailable");
        }
        return { sid: existing[0].sid, phoneNumber: existing[0].phoneNumber };
      }
      try {
        const created = await client.incomingPhoneNumbers.create({
          phoneNumber: input.phoneNumber,
          friendlyName: input.friendlyName,
          smsUrl: input.inboundRequestUrl,
          smsMethod: "POST",
          statusCallback: input.statusCallback,
          statusCallbackMethod: "POST",
        });
        return { sid: created.sid, phoneNumber: created.phoneNumber };
      } catch (error) {
        const raced = await boundedList(
          (options) => client.incomingPhoneNumbers.list({ phoneNumber: input.phoneNumber, ...options }),
          1,
        );
        if (raced[0]?.friendlyName === input.friendlyName) {
          return { sid: raced[0].sid, phoneNumber: raced[0].phoneNumber };
        }
        const status = typeof error === "object" && error !== null && "status" in error
          ? Number((error as { status: unknown }).status)
          : 0;
        const code = typeof error === "object" && error !== null && "code" in error
          ? Number((error as { code: unknown }).code)
          : 0;
        if (status === 400 || status === 409 || code === 21422) {
          throw new RegistrationAdapterError("number_unavailable");
        }
        throw error;
      }
    }),
    attachNumber: (messagingServiceSid, phoneNumberSid, phoneNumber, friendlyName) => safeRequest(async () => {
      const incomingNumber = await client.incomingPhoneNumbers(phoneNumberSid).fetch();
      if (incomingNumber.phoneNumber !== phoneNumber || incomingNumber.friendlyName !== friendlyName) {
        throw new RegistrationAdapterError("number_unavailable");
      }
      const service = client.messaging.v1.services(messagingServiceSid);
      const existing = await boundedList((options) => service.phoneNumbers.list(options));
      const found = existing.find((item) => item.phoneNumber === phoneNumber);
      if (found) return { sid: found.sid };
      const created = await service.phoneNumbers.create({ phoneNumberSid });
      return { sid: created.sid };
    }),
    resendBrandOtp: (brandSid) => safeRequest(async () => {
      await client.messaging.v1.brandRegistrations(brandSid).brandRegistrationOtps.create();
    }),
  };
}
