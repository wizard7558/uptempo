import { integer, pgTable, primaryKey, text, timestamp } from "drizzle-orm/pg-core";

export const jobRuns = pgTable(
  "job_runs",
  {
    jobId: text("job_id").notNull(),
    scheduledFor: timestamp("scheduled_for", { withTimezone: true }).notNull(),
    workerId: text("worker_id").notNull(),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
    status: text("status").notNull().default("running"),
    httpStatus: integer("http_status"),
  },
  (table) => [primaryKey({ columns: [table.jobId, table.scheduledFor] })],
);
