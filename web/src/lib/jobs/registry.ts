export type JobRequirement = "sms" | "push" | "multi";

export type JobDefinition = {
  id: string;
  path: `/api/${string}`;
  schedule: string;
  timeoutMs: number;
  requires?: readonly JobRequirement[];
};

/**
 * Scheduled HTTP jobs, in the same order as `vercel.json` crons.
 * The three jobs after charge-platform-fees were added to the hosted
 * schedule after the original eight-cron inventory.
 */
export const JOBS: readonly JobDefinition[] = [
  {
    id: "calendar-sync",
    path: "/api/calendar/sync",
    schedule: "* * * * *",
    timeoutMs: 120_000,
  },
  {
    id: "calendar-retry-push",
    path: "/api/calendar/retry-push",
    schedule: "*/5 * * * *",
    timeoutMs: 300_000,
  },
  {
    id: "send-reminders",
    path: "/api/cron/send-reminders",
    schedule: "0 * * * *",
    timeoutMs: 300_000,
  },
  {
    id: "send-sms-reminders",
    path: "/api/cron/send-sms-reminders",
    schedule: "0 * * * *",
    timeoutMs: 300_000,
    requires: ["sms"],
  },
  {
    id: "send-push-reminders",
    path: "/api/cron/send-push-reminders",
    schedule: "0 * * * *",
    timeoutMs: 300_000,
    requires: ["push"],
  },
  {
    id: "expire-stored-value",
    path: "/api/cron/expire-stored-value",
    schedule: "0 4 * * *",
    timeoutMs: 300_000,
  },
  {
    id: "evaluate-capacity-coach",
    path: "/api/cron/evaluate-capacity-coach",
    schedule: "0 2 * * 1",
    timeoutMs: 300_000,
  },
  {
    id: "charge-platform-fees",
    path: "/api/cron/charge-platform-fees",
    schedule: "0 6 1 * *",
    timeoutMs: 300_000,
    requires: ["multi"],
  },
  {
    id: "materialize-recurrences",
    path: "/api/cron/materialize-recurrences",
    schedule: "30 3 * * *",
    timeoutMs: 300_000,
  },
  {
    id: "purge-private-files",
    path: "/api/cron/purge-private-files",
    schedule: "45 4 * * *",
    timeoutMs: 300_000,
  },
  {
    id: "expire-credits",
    path: "/api/cron/expire-credits",
    schedule: "15 4 * * *",
    timeoutMs: 300_000,
  },
  {
    id: "waitlist-offers",
    path: "/api/cron/waitlist-offers",
    schedule: "*/5 * * * *",
    timeoutMs: 120_000,
  },
];
