import { beforeEach, describe, expect, it, vi } from "vitest";

const sdk = vi.hoisted(() => {
  const mock = vi.fn();
  const endUserList = vi.fn();
  const endUserCreate = vi.fn();
  const endUserUpdate = vi.fn();
  const profileList = vi.fn();
  const profileCreate = vi.fn();
  const profileUpdate = vi.fn();
  const profileAssignmentList = vi.fn();
  const profileAssignmentCreate = vi.fn();
  const profileEvaluation = vi.fn();
  const trustList = vi.fn();
  const trustCreate = vi.fn();
  const trustUpdate = vi.fn();
  const trustAssignmentList = vi.fn();
  const trustAssignmentCreate = vi.fn();
  const trustEvaluation = vi.fn();
  const supportingList = vi.fn();
  const supportingCreate = vi.fn();
  const supportingUpdate = vi.fn();
  const addressList = vi.fn();
  const addressCreate = vi.fn();
  const addressUpdate = vi.fn();
  const brandList = vi.fn();
  const brandCreate = vi.fn();
  const brandUpdate = vi.fn();
  const brandFetch = vi.fn();
  const otpCreate = vi.fn();
  const serviceList = vi.fn();
  const serviceCreate = vi.fn();
  const campaignList = vi.fn();
  const campaignCreate = vi.fn();
  const campaignUpdate = vi.fn();
  const campaignFetch = vi.fn();
  const servicePhoneList = vi.fn();
  const servicePhoneCreate = vi.fn();
  const availableList = vi.fn();
  const incomingList = vi.fn();
  const incomingCreate = vi.fn();
  const incomingFetch = vi.fn();

  const endUserContext = { update: endUserUpdate };
  const endUsers = Object.assign(vi.fn(() => endUserContext), { list: endUserList, create: endUserCreate });
  const profileContext = {
    update: profileUpdate,
    customerProfilesEntityAssignments: { list: profileAssignmentList, create: profileAssignmentCreate },
    customerProfilesEvaluations: { create: profileEvaluation },
  };
  const customerProfiles = Object.assign(vi.fn(() => profileContext), { list: profileList, create: profileCreate });
  const trustContext = {
    update: trustUpdate,
    trustProductsEntityAssignments: { list: trustAssignmentList, create: trustAssignmentCreate },
    trustProductsEvaluations: { create: trustEvaluation },
  };
  const trustProducts = Object.assign(vi.fn(() => trustContext), { list: trustList, create: trustCreate });
  const supportingContext = { update: supportingUpdate };
  const supportingDocuments = Object.assign(vi.fn(() => supportingContext), { list: supportingList, create: supportingCreate });
  const addresses = Object.assign(vi.fn(() => ({ update: addressUpdate })), { list: addressList, create: addressCreate });
  const brandContext = {
    update: brandUpdate,
    fetch: brandFetch,
    brandRegistrationOtps: { create: otpCreate },
  };
  const brandRegistrations = Object.assign(vi.fn(() => brandContext), { list: brandList, create: brandCreate });
  const campaignContext = { update: campaignUpdate, fetch: campaignFetch };
  const usAppToPerson = Object.assign(vi.fn(() => campaignContext), { list: campaignList, create: campaignCreate });
  const serviceContext = { usAppToPerson, phoneNumbers: { list: servicePhoneList, create: servicePhoneCreate } };
  const services = Object.assign(vi.fn(() => serviceContext), { list: serviceList, create: serviceCreate });
  const incomingContext = { fetch: incomingFetch };
  const incomingPhoneNumbers = Object.assign(vi.fn(() => incomingContext), { list: incomingList, create: incomingCreate });
  const client = {
    trusthub: { v1: { endUsers, customerProfiles, trustProducts, supportingDocuments } },
    addresses,
    messaging: { v1: { brandRegistrations, services } },
    availablePhoneNumbers: vi.fn(() => ({ local: { list: availableList } })),
    incomingPhoneNumbers,
  };
  mock.mockReturnValue(client);
  return {
    mock,
    client,
    endUserList, endUserCreate, endUserUpdate,
    profileList, profileCreate, profileUpdate, profileAssignmentList, profileAssignmentCreate, profileEvaluation,
    trustList, trustCreate, trustUpdate, trustAssignmentList, trustAssignmentCreate, trustEvaluation,
    supportingList, supportingCreate, supportingUpdate, addressList, addressCreate, addressUpdate,
    brandList, brandCreate, brandUpdate, brandFetch, otpCreate,
    serviceList, serviceCreate, campaignList, campaignCreate, campaignUpdate, campaignFetch,
    servicePhoneList, servicePhoneCreate, availableList, incomingList, incomingCreate, incomingFetch,
    customerProfiles, trustProducts, services, usAppToPerson,
  };
});

vi.mock("twilio", () => ({ default: sdk.mock }));

import { createTwilioRegistrationClient } from "./twilio-registration-client";

const SECONDARY_POLICY = "RNdfbf3fae0e1107f8aded0e7cead80bf5";
const SOLE_PROFILE_POLICY = "RN806dd6cd175f314e1f96a9727ee271f4";
const SOLE_TRUST_POLICY = "RN670d5d2e282a6130ae063b234b6019c8";

describe("Twilio registration adapter", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.TWILIO_ACCOUNT_SID = "AC-test";
    process.env.TWILIO_AUTH_TOKEN = "test-token";
    sdk.endUserList.mockResolvedValue([]);
    sdk.endUserCreate.mockResolvedValue({ sid: "EU1" });
    sdk.profileList.mockResolvedValue([]);
    sdk.profileCreate.mockResolvedValue({ sid: "BU1" });
    sdk.profileAssignmentList.mockResolvedValue([]);
    sdk.profileAssignmentCreate.mockResolvedValue({ sid: "BV1" });
    sdk.profileEvaluation.mockResolvedValue({ sid: "EV1", status: "compliant" });
    sdk.trustList.mockResolvedValue([]);
    sdk.trustCreate.mockResolvedValue({ sid: "BU2" });
    sdk.trustAssignmentList.mockResolvedValue([]);
    sdk.trustAssignmentCreate.mockResolvedValue({ sid: "BV2" });
    sdk.trustEvaluation.mockResolvedValue({ sid: "EV2", status: "compliant" });
    sdk.supportingList.mockResolvedValue([]);
    sdk.supportingCreate.mockResolvedValue({ sid: "RD1" });
    sdk.addressList.mockResolvedValue([]);
    sdk.addressCreate.mockResolvedValue({ sid: "AD1" });
    sdk.brandList.mockResolvedValue([]);
    sdk.brandCreate.mockResolvedValue({ sid: "BN1" });
    sdk.serviceList.mockResolvedValue([]);
    sdk.serviceCreate.mockResolvedValue({ sid: "MG1" });
    sdk.campaignList.mockResolvedValue([]);
    sdk.campaignCreate.mockResolvedValue({ sid: "QE1" });
    sdk.campaignFetch.mockResolvedValue({ campaignStatus: "VERIFIED" });
    sdk.servicePhoneList.mockResolvedValue([]);
    sdk.servicePhoneCreate.mockResolvedValue({ sid: "PN1" });
    sdk.availableList.mockResolvedValue([{ phoneNumber: "+12065550100" }]);
    sdk.incomingList.mockResolvedValue([]);
    sdk.incomingCreate.mockResolvedValue({ sid: "PN-sid", phoneNumber: "+12065550100" });
    sdk.incomingFetch.mockResolvedValue({ sid: "PN-sid", phoneNumber: "+12065550100", friendlyName: "Uptempo business" });
  });

  it("uses the documented standard and sole-proprietor bundle policies and attributes", async () => {
    const client = createTwilioRegistrationClient();
    await client.createProfile({ friendlyName: "standard", email: "support@example.test", policySid: SECONDARY_POLICY });
    expect(sdk.profileCreate).toHaveBeenCalledWith({ friendlyName: "standard", email: "support@example.test", policySid: SECONDARY_POLICY });
    const starter = await client.createStarterInformation({
      friendlyName: "starter",
      attributes: { email: "owner@example.test", first_name: "Sam", last_name: "Lee", phone_number: "+12065550100" },
    });
    expect(starter.sid).toBe("EU1");
    expect(sdk.endUserCreate).toHaveBeenLastCalledWith({
      friendlyName: "starter",
      attributes: { email: "owner@example.test", first_name: "Sam", last_name: "Lee", phone_number: "+12065550100" },
      type: "starter_customer_profile_information",
    });
    await client.createSoleProprietorInformation({
      friendlyName: "sole info",
      attributes: { brand_name: "Business LLC", mobile_phone_number: "+12065550100", vertical: "CONSUMER" },
    });
    expect(sdk.endUserCreate).toHaveBeenLastCalledWith({
      friendlyName: "sole info",
      attributes: { brand_name: "Business LLC", mobile_phone_number: "+12065550100", vertical: "CONSUMER" },
      type: "sole_proprietor_information",
    });
    await client.createTrustProduct({ friendlyName: "sole trust", email: "support@example.test", policySid: SOLE_TRUST_POLICY });
    expect(sdk.trustCreate).toHaveBeenCalledWith({ friendlyName: "sole trust", email: "support@example.test", policySid: SOLE_TRUST_POLICY });
    await client.evaluateProfile("BU-sole", SOLE_PROFILE_POLICY);
    expect(sdk.profileEvaluation).toHaveBeenCalledWith({ policySid: SOLE_PROFILE_POLICY });
    await client.evaluateTrustProduct("BU2", SOLE_TRUST_POLICY);
    expect(sdk.trustEvaluation).toHaveBeenCalledWith({ policySid: SOLE_TRUST_POLICY });
  });

  it("attaches the primary profile to the secondary/starter bundle in the documented direction", async () => {
    const client = createTwilioRegistrationClient();
    await client.assignProfileToPrimary("BU-primary", "BU-secondary");
    expect(sdk.customerProfiles).toHaveBeenCalledWith("BU-secondary");
    expect(sdk.profileAssignmentCreate).toHaveBeenCalledWith({ objectSid: "BU-primary" });
    await client.assignPrimaryToStarter("BU-starter", "BU-primary");
    expect(sdk.customerProfiles).toHaveBeenCalledWith("BU-starter");
    expect(sdk.profileAssignmentCreate).toHaveBeenLastCalledWith({ objectSid: "BU-primary" });
  });

  it("uses the correct brand and campaign use cases and skip-secondary-vetting policy", async () => {
    const client = createTwilioRegistrationClient();
    await client.createBrand({ brandType: "STANDARD", customerProfileSid: "BU1", trustProductSid: "BU2" });
    expect(sdk.brandCreate).toHaveBeenCalledWith({
      customerProfileBundleSid: "BU1",
      a2PProfileBundleSid: "BU2",
      brandType: "STANDARD",
      skipAutomaticSecVet: true,
    });
    await client.createCampaign({
      messagingServiceSid: "MG1",
      brandSid: "BN1",
      usecase: "LOW_VOLUME",
      description: "Transactional appointment confirmations and reminders for opted-in business clients.",
      messageFlow: "Clients consent in the optional unchecked box while booking online. Consent is not required to book; reply STOP to opt out.",
      messageSamples: ["Your appointment is confirmed for Monday at 2:30 PM.", "Reminder: your appointment is Monday at 2:30 PM."],
    });
    expect(sdk.campaignCreate).toHaveBeenCalledWith(expect.objectContaining({ usAppToPersonUsecase: "LOW_VOLUME" }));

    await client.createBrand({ brandType: "SOLE_PROPRIETOR", customerProfileSid: "BU3", trustProductSid: "BU4" });
    expect(sdk.brandCreate).toHaveBeenLastCalledWith({
      customerProfileBundleSid: "BU3",
      a2PProfileBundleSid: "BU4",
      brandType: "SOLE_PROPRIETOR",
    });
    await client.createCampaign({
      messagingServiceSid: "MG1",
      brandSid: "BN2",
      usecase: "SOLE_PROPRIETOR",
      description: "Transactional appointment confirmations and reminders for opted-in sole proprietor clients.",
      messageFlow: "Clients consent in the optional unchecked box while booking online. Consent is not required to book; reply STOP to opt out.",
      messageSamples: ["Your appointment is confirmed for Monday at 2:30 PM.", "Reminder: your appointment is Monday at 2:30 PM."],
    });
    expect(sdk.campaignCreate).toHaveBeenLastCalledWith(expect.objectContaining({ usAppToPersonUsecase: "SOLE_PROPRIETOR" }));
  });

  it("derives embedded link and phone flags from real campaign samples on create and update", async () => {
    const client = createTwilioRegistrationClient();
    const campaign = {
      messagingServiceSid: "MG1",
      brandSid: "BN1",
      usecase: "LOW_VOLUME" as const,
      description: "Appointment reminders",
      messageFlow: "Optional unchecked booking consent",
      messageSamples: [
        "Reschedule at https://book.example.test/visit",
        "Questions? Call +1 (206) 555-0100.",
      ],
    };
    await client.createCampaign(campaign);
    expect(sdk.campaignCreate).toHaveBeenCalledWith(expect.objectContaining({
      hasEmbeddedLinks: true,
      hasEmbeddedPhone: true,
    }));
    await client.updateCampaign({ ...campaign, campaignSid: "QE1" });
    expect(sdk.campaignUpdate).toHaveBeenCalledWith(expect.objectContaining({
      hasEmbeddedLinks: true,
      hasEmbeddedPhone: true,
    }));
  });

  it("maps only documented failure codes to safe brand and campaign reason codes", async () => {
    const client = createTwilioRegistrationClient();
    sdk.brandFetch.mockResolvedValueOnce({
      status: "FAILED",
      identityStatus: "NOT_VERIFIED",
      failureReason: "EIN 12-3456789 belongs to someone else",
      errors: [{ code: 21736, description: "private profile details" }],
    });
    expect(await client.fetchBrand("BN1")).toEqual({
      status: "FAILED",
      identityStatus: "NOT_VERIFIED",
      reasonCode: "domain_ownership",
    });
    sdk.brandFetch.mockResolvedValueOnce({
      status: "FAILED",
      failureReason: "private details",
      errors: [{ code: 21725, description: "brand state cannot be updated" }],
    });
    expect(await client.fetchBrand("BN2")).toEqual({ status: "FAILED" });
    sdk.campaignFetch.mockResolvedValueOnce({
      campaignStatus: "FAILED",
      errors: [{ code: 30909, description: "private message content" }],
    });
    expect(await client.fetchCampaign("MG1", "QE1")).toEqual({
      status: "FAILED",
      reasonCode: "opt_in_flow",
    });
  });

  it("fails closed rather than creating replacements when bounded inventory is full", async () => {
    const client = createTwilioRegistrationClient();
    sdk.profileList.mockResolvedValueOnce(Array.from({ length: 101 }, (_, i) => ({
      sid: `BU${i}`,
      friendlyName: `profile-${i}`,
    })));
    await expect(client.createProfile({
      friendlyName: "profile-missing-checkpoint",
      email: "support@example.test",
      policySid: SECONDARY_POLICY,
    })).rejects.toMatchObject({ code: "inventory_incomplete" });
    expect(sdk.profileCreate).not.toHaveBeenCalled();
    expect(sdk.profileList).toHaveBeenCalledWith(expect.objectContaining({ limit: 101, pageSize: 50 }));

    sdk.brandList.mockResolvedValueOnce(Array.from({ length: 101 }, (_, i) => ({
      sid: `BN${i}`,
      customerProfileBundleSid: "BU1",
      a2pProfileBundleSid: "BU2",
      brandType: "STANDARD",
    })));
    await expect(client.createBrand({
      brandType: "STANDARD",
      customerProfileSid: "BU1",
      trustProductSid: "BU2",
    })).rejects.toMatchObject({ code: "inventory_incomplete" });
    expect(sdk.brandCreate).not.toHaveBeenCalled();
  });

  it("keeps the adapter operation pending until a delayed inventory response settles", async () => {
    vi.useFakeTimers();
    try {
      let finishList!: (rows: Array<{ sid: string; friendlyName: string }>) => void;
      sdk.profileList.mockImplementationOnce(() => new Promise((resolve) => { finishList = resolve; }));
      const client = createTwilioRegistrationClient();
      let settled = false;
      const operation = client.createProfile({
        friendlyName: "slow-profile",
        email: "support@example.test",
        policySid: SECONDARY_POLICY,
      }).finally(() => { settled = true; });
      await vi.advanceTimersByTimeAsync(30_000);
      expect(settled).toBe(false);
      expect(sdk.profileCreate).not.toHaveBeenCalled();
      finishList([]);
      await expect(operation).resolves.toEqual({ sid: "BU1" });
      expect(sdk.profileCreate).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("configures tenant webhooks and refuses a selected number owned by another tenant", async () => {
    const client = createTwilioRegistrationClient();
    await client.createMessagingService({
      friendlyName: "Uptempo business reminders",
      inboundRequestUrl: "https://example.test/api/twilio/inbound",
      statusCallback: "https://example.test/api/twilio/status?tenant=salon",
    });
    expect(sdk.serviceCreate).toHaveBeenCalledWith({
      friendlyName: "Uptempo business reminders",
      inboundRequestUrl: "https://example.test/api/twilio/inbound",
      inboundMethod: "POST",
      statusCallback: "https://example.test/api/twilio/status?tenant=salon",
      useInboundWebhookOnNumber: true,
    });
    sdk.incomingList.mockResolvedValueOnce([{ sid: "PN-other", phoneNumber: "+12065550100", friendlyName: "Uptempo another-business" }]);
    await expect(client.purchaseNumber({
      phoneNumber: "+12065550100",
      friendlyName: "Uptempo business",
      inboundRequestUrl: "https://example.test/api/twilio/inbound",
      statusCallback: "https://example.test/api/twilio/status?tenant=salon",
    })).rejects.toMatchObject({ code: "number_unavailable" });
    expect(sdk.incomingCreate).not.toHaveBeenCalled();
  });

  it("refuses to attach a phone number unless its stable friendly name belongs to this tenant", async () => {
    const client = createTwilioRegistrationClient();
    sdk.incomingFetch.mockResolvedValueOnce({
      sid: "PN-sid",
      phoneNumber: "+12065550100",
      friendlyName: "Uptempo other-business",
    });
    await expect(client.attachNumber(
      "MG-business",
      "PN-sid",
      "+12065550100",
      "Uptempo business",
    )).rejects.toMatchObject({ code: "number_unavailable" });
    expect(sdk.servicePhoneCreate).not.toHaveBeenCalled();
  });
});
