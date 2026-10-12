CREATE TABLE IF NOT EXISTS "job_runs" (
	"job_id" text NOT NULL,
	"scheduled_for" timestamp with time zone NOT NULL,
	"worker_id" text NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	"status" text DEFAULT 'running' NOT NULL,
	"http_status" integer,
	CONSTRAINT "job_runs_job_id_scheduled_for_pk" PRIMARY KEY("job_id","scheduled_for")
);
