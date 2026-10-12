import { VercelCore } from "@vercel/sdk/core.js";
import { projectsAddProjectDomain } from "@vercel/sdk/funcs/projectsAddProjectDomain.js";
import { projectsGetProjectDomain } from "@vercel/sdk/funcs/projectsGetProjectDomain.js";
import { projectsVerifyProjectDomain } from "@vercel/sdk/funcs/projectsVerifyProjectDomain.js";
import { projectsRemoveProjectDomain } from "@vercel/sdk/funcs/projectsRemoveProjectDomain.js";

function getVercelClient() {
  return new VercelCore({ bearerToken: process.env.VERCEL_TOKEN! });
}

/** Add a custom domain to the Vercel project. */
export async function addDomainToVercel(domain: string) {
  const vercel = getVercelClient();
  return projectsAddProjectDomain(vercel, {
    idOrName: process.env.VERCEL_PROJECT_ID!,
    teamId: process.env.VERCEL_TEAM_ID!,
    requestBody: { name: domain },
  });
}

/** Get domain configuration from Vercel (DNS records, verification status). */
export async function getDomainFromVercel(domain: string) {
  const vercel = getVercelClient();
  return projectsGetProjectDomain(vercel, {
    idOrName: process.env.VERCEL_PROJECT_ID!,
    teamId: process.env.VERCEL_TEAM_ID!,
    domain,
  });
}

/** Trigger domain verification check on Vercel. */
export async function verifyDomainOnVercel(domain: string) {
  const vercel = getVercelClient();
  return projectsVerifyProjectDomain(vercel, {
    idOrName: process.env.VERCEL_PROJECT_ID!,
    teamId: process.env.VERCEL_TEAM_ID!,
    domain,
  });
}

/** Remove a domain from the Vercel project. */
export async function removeDomainFromVercel(domain: string) {
  const vercel = getVercelClient();
  return projectsRemoveProjectDomain(vercel, {
    idOrName: process.env.VERCEL_PROJECT_ID!,
    teamId: process.env.VERCEL_TEAM_ID!,
    domain,
  });
}
