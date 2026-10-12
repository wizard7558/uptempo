export type DocSection = {
  slug: string;
  title: string;
  heading: string;
  paragraphs: string[];
};

export const DOC_SECTIONS: DocSection[] = [
  {
    slug: "self-hosting",
    title: "Self-hosting",
    heading: "Self-host quickstart",
    paragraphs: [
      "Uptempo runs one business on a machine you control. The license is AGPL-3.0.",
      "From the repository root, run ./scripts/init-env.sh and then docker compose up -d.",
      "Open the site, complete /setup, finish onboarding, and book at /book/<your-slug>.",
      "The in-repo quickstart is docs/self-hosting.md.",
    ],
  },
  {
    slug: "modules",
    title: "Modules",
    heading: "Classes and the walk-in queue",
    paragraphs: [
      "Turn modules on per business. Classes cover group sessions with a capacity and an enrollment list.",
      "The walk-in queue holds guests who arrive without an appointment and shows their place in line.",
      "Requests, gift cards, and packages are separate modules. A business only loads the ones it enables.",
    ],
  },
  {
    slug: "api",
    title: "API",
    heading: "GET /api/health",
    paragraphs: [
      "GET /api/health returns the process mode and whether the database connection is ok.",
      "Webhook routes stay on the host that received them. Stripe, Twilio, and cron callers do not follow redirects.",
      "Public booking and sign-in use the canonical www host.",
    ],
  },
  {
    slug: "contributing",
    title: "Contributing",
    heading: "Developer Certificate of Origin",
    paragraphs: [
      "Contributions use the Developer Certificate of Origin. There is no contributor license agreement.",
      "git commit -s adds a Signed-off-by line. That line is your certificate. Add it on every commit.",
      "Run GATE from web/ before a change is done: lint, typecheck, unit tests, build, database tests, and end-to-end tests.",
    ],
  },
];

export function getDocSection(slug: string): DocSection | undefined {
  return DOC_SECTIONS.find((section) => section.slug === slug);
}
