import { z } from "zod";

const domainRegex = /^(?!-)[a-zA-Z0-9-]{1,63}(?<!-)(\.[a-zA-Z0-9-]{1,63})*\.[a-zA-Z]{2,}$/;

export const customDomainSchema = z
  .string()
  .min(1, "Domain is required")
  .regex(domainRegex, "Must be a valid domain name (e.g., book.yoursalon.com)")
  .refine(
    (domain) => {
      const lower = domain.toLowerCase();
      const rootDomain = (process.env.ROOT_DOMAIN || "bookuptempo.com").toLowerCase();
      return (
        !lower.endsWith(`.${rootDomain}`) &&
        lower !== rootDomain &&
        !lower.endsWith(".emme.app") &&
        lower !== "emme.app" &&
        !lower.endsWith(".bookuptempo.com") &&
        lower !== "bookuptempo.com"
      );
    },
    { message: "Cannot use a platform domain as a custom domain" },
  )
  .transform((domain) => domain.toLowerCase());
