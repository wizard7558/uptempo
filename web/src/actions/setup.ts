"use server";

import { isSingleMode } from "@/lib/config/mode";
import { createBusinessAccount } from "@/lib/onboarding/create-business";
import {
  queryFirstTenantSlug,
  rememberSingleTenantSlug,
} from "@/lib/tenant/single";
import { VERTICAL_IDS, type VerticalId } from "@/lib/verticals";

const SIGNUP_OFF = "Sign-up is turned off on this install.";

/**
 * Single mode runs one web replica. This in-process chain is the only lock
 * around first-run setup.
 */
let setupTail: Promise<unknown> = Promise.resolve();

export async function createSingleBusiness(data: {
  businessName: string;
  industry: string;
  timezone: string;
  ownerName: string;
  email: string;
  password: string;
}): Promise<{ success: true; slug: string } | { success: false; error: string }> {
  const job = setupTail.then(() => createSingleBusinessOnce(data));
  setupTail = job.then(
    () => undefined,
    () => undefined,
  );
  return job;
}

async function createSingleBusinessOnce(data: {
  businessName: string;
  industry: string;
  timezone: string;
  ownerName: string;
  email: string;
  password: string;
}): Promise<{ success: true; slug: string } | { success: false; error: string }> {
  if (!isSingleMode()) {
    return { success: false, error: SIGNUP_OFF };
  }
  if (!VERTICAL_IDS.includes(data.industry as VerticalId)) {
    return { success: false, error: "Choose an industry." };
  }
  const existing = await queryFirstTenantSlug();
  if (existing) {
    return { success: false, error: "A business is already set up." };
  }

  const result = await createBusinessAccount({
    salonName: data.businessName,
    timezone: data.timezone,
    ownerName: data.ownerName,
    email: data.email,
    password: data.password,
    industry: data.industry as VerticalId,
  });
  if (result.success) rememberSingleTenantSlug(result.slug);
  return result;
}
