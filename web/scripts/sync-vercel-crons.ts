import { readFileSync, writeFileSync } from "node:fs";
import { JOBS } from "../src/lib/jobs/registry";

const file = new URL("../vercel.json", import.meta.url);
const json = JSON.parse(readFileSync(file, "utf8")) as { crons: unknown };
json.crons = JOBS.map(({ path, schedule }) => ({ path, schedule }));
writeFileSync(file, `${JSON.stringify(json, null, 2)}\n`);
