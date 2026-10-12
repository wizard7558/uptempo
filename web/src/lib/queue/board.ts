/**
 * Walk-in board loader. Server-only: reads the line, the day's real
 * availability and recent service pace, then runs the pure estimate.
 */
import { and, asc, desc, eq, gt, inArray, isNotNull, sql } from "drizzle-orm";
import { withTenantDb } from "@/lib/db/tenant";
import { loadSchedulingSettings, loadSchedulingSnapshot } from "@/lib/scheduling/load";
import { buildEngineInput, buildRules, simpleServiceRequest, snapshotBusy } from "@/lib/scheduling/input";
import { staffWindows } from "@/lib/scheduling/engine";
import { localDay, subtract } from "@/lib/scheduling/intervals";
import type { Interval } from "@/lib/scheduling/types";
import { estimateQueue, pickServiceMinutes, type QueueJob, type QueueStaff } from "./estimate";

const DEFAULT_MINUTES = 30;
const SAMPLES_PER_SERVICE = 20;
const SAMPLE_DAYS = 30;
const CACHE_TTL_MS = 5_000;

export type QueueBoardEntry = {
  id: string;
  name: string;
  phone: string | null;
  locationId: string | null;
  clientId: string | null;
  serviceId: string | null;
  serviceName: string | null;
  preferredStaffId: string | null;
  preferredStaffName: string | null;
  assignedStaffId: string | null;
  assignedStaffName: string | null;
  appointmentId: string | null;
  status: "waiting" | "called" | "in_service";
  source: "qr" | "kiosk" | "front_desk";
  quotedWaitMin: number | null;
  notes: string | null;
  joinedAt: Date;
  calledAt: Date | null;
  startedAt: Date | null;
};

export type QueueBoardStaff = { id: string; name: string; freeAt: Date | null };
export type QueueBoardWaiting = QueueBoardEntry & { position: number; waitMinutes: number | null };

export type QueueBoard = {
  open: boolean;
  maxWaiting: number;
  textOnJoin: boolean;
  timezone: string;
  /** Wait for a hypothetical 30-minute any-staff job added at the end of the line; null = no one can fit it. */
  waitNowMinutes: number | null;
  staff: QueueBoardStaff[];
  waiting: QueueBoardWaiting[];
  called: QueueBoardEntry[];
  inService: QueueBoardEntry[];
};

const cache = new Map<string, { at: number; board: QueueBoard }>();

/**
 * @param locationId limits the line (and the staff hours) to one location; null = all.
 * @param opts.cached serve a copy up to 5 seconds old. Public reads only.
 */
export async function loadQueueBoard(
  slug: string,
  locationId: string | null,
  now: Date = new Date(),
  opts: { cached?: boolean } = {},
): Promise<QueueBoard> {
  const key = `${slug}:${locationId ?? ""}`;
  if (opts.cached) {
    const hit = cache.get(key);
    if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.board;
  }
  const board = await computeBoard(slug, locationId, now);
  if (opts.cached) cache.set(key, { at: Date.now(), board });
  return board;
}

async function computeBoard(slug: string, loc: string | null, now: Date): Promise<QueueBoard> {
  const schedSettings = await loadSchedulingSettings(slug);
  const timezone = schedSettings.timezone;

  const base = await withTenantDb(slug, async (db, t) => {
    // 1. Settings row (defaults when missing).
    const [settings] = await db
      .select({
        open: t.businessSettings.queueOpen,
        maxWaiting: t.businessSettings.queueMaxWaiting,
        textOnJoin: t.businessSettings.queueTextOnJoin,
      })
      .from(t.businessSettings)
      .limit(1);
    // 2. Active entries in join order.
    const entries = await db
      .select()
      .from(t.queueEntries)
      .where(
        and(
          inArray(t.queueEntries.status, ["waiting", "called", "in_service"]),
          loc ? eq(t.queueEntries.locationId, loc) : undefined,
        ),
      )
      .orderBy(asc(t.queueEntries.joinedAt), asc(t.queueEntries.id));
    const staffRows = await db
      .select({
        id: t.staff.id,
        name: t.staff.displayName,
        role: t.staff.role,
        isActive: t.staff.isActive,
        createdAt: t.staff.createdAt,
      })
      .from(t.staff)
      .orderBy(asc(t.staff.createdAt), asc(t.staff.id));
    const serviceIds = [...new Set(entries.map((e) => e.serviceId).filter((x): x is string => !!x))];
    const serviceRows = serviceIds.length
      ? await db
          .select({
            id: t.services.id,
            name: t.services.name,
            minutes: t.services.defaultDurationMinutes,
          })
          .from(t.services)
          .where(inArray(t.services.id, serviceIds))
      : [];
    // 6. Who offers each service.
    const offered = serviceIds.length
      ? await db
          .select({ staffId: t.staffServices.staffId, serviceId: t.staffServices.serviceId })
          .from(t.staffServices)
          .where(and(inArray(t.staffServices.serviceId, serviceIds), eq(t.staffServices.isOffered, 1)))
      : [];
    // 7. Recent pace, measured against the injected `now`.
    const cutoff = new Date(now.getTime() - SAMPLE_DAYS * 86_400_000);
    const sampleRows = serviceIds.length
      ? await db
          .select({
            serviceId: t.queueEntries.serviceId,
            m: sql<string>`EXTRACT(EPOCH FROM ${t.queueEntries.doneAt} - ${t.queueEntries.startedAt}) / 60`,
          })
          .from(t.queueEntries)
          .where(
            and(
              eq(t.queueEntries.status, "done"),
              isNotNull(t.queueEntries.startedAt),
              gt(t.queueEntries.doneAt, cutoff),
              inArray(t.queueEntries.serviceId, serviceIds),
            ),
          )
          .orderBy(desc(t.queueEntries.doneAt))
      : [];
    return { settings, entries, staffRows, serviceRows, offered, sampleRows };
  });

  const { settings, entries, staffRows, serviceRows, offered, sampleRows } = base;
  const staffName = new Map(staffRows.map((s) => [s.id, s.name]));
  const service = new Map(serviceRows.map((s) => [s.id, s]));

  // 3. Candidates.
  const candidates = staffRows.filter((s) => s.isActive === 1 && s.role === "provider");
  const candidateIds = candidates.map((s) => s.id);

  // 4. Today's availability.
  const today = localDay(now, timezone);
  const snapshot = await loadSchedulingSnapshot({
    slug,
    timezone,
    staffIds: candidateIds,
    fromDay: today,
    toDay: today,
    locationId: loc,
  });
  const input = buildEngineInput(snapshot, today, {
    candidateStaffIds: candidateIds,
    anyStaff: false,
    service: simpleServiceRequest(5),
    rules: buildRules(schedSettings, now, { extraAdvanceDays: 0, allowFlex: false }),
  });
  const busy = snapshotBusy(snapshot);

  // 5. Free windows per person, from now on.
  const poolStaff: QueueStaff[] = [];
  const boardStaff: QueueBoardStaff[] = [];
  candidates.forEach((person, order) => {
    const cuts: Interval[] = busy
      .filter((b) => b.staffId === person.id)
      .map((b) => b.interval);
    const free: Interval[] = [];
    for (const w of staffWindows(input, person.id)) {
      if (loc && w.locationId !== loc) continue;
      const start = new Date(Math.max(w.start.getTime(), now.getTime()));
      if (start.getTime() >= w.end.getTime()) continue;
      free.push(...subtract({ start, end: w.end }, cuts));
    }
    free.sort((a, b) => a.start.getTime() - b.start.getTime());
    poolStaff.push({ id: person.id, order, free });
    boardStaff.push({ id: person.id, name: person.name, freeAt: free[0]?.start ?? null });
  });

  // Service length per service.
  const samples = new Map<string, number[]>();
  for (const r of sampleRows) {
    if (!r.serviceId) continue;
    const list = samples.get(r.serviceId) ?? [];
    if (list.length < SAMPLES_PER_SERVICE) list.push(Number(r.m));
    samples.set(r.serviceId, list);
  }
  const offeredBy = new Map<string, string[]>();
  for (const o of offered) {
    offeredBy.set(o.serviceId, [...(offeredBy.get(o.serviceId) ?? []), o.staffId]);
  }
  const minutesFor = (serviceId: string | null) => {
    if (!serviceId) return DEFAULT_MINUTES;
    const svc = service.get(serviceId);
    return pickServiceMinutes(samples.get(serviceId) ?? [], svc?.minutes ?? DEFAULT_MINUTES);
  };
  const eligibleFor = (serviceId: string | null) => {
    if (!serviceId) return candidateIds;
    const who = offeredBy.get(serviceId) ?? [];
    return candidateIds.filter((id) => who.includes(id));
  };

  const toEntry = (e: (typeof entries)[number]): QueueBoardEntry => ({
    id: e.id,
    name: e.name,
    phone: e.phone,
    locationId: e.locationId,
    clientId: e.clientId,
    serviceId: e.serviceId,
    serviceName: e.serviceId ? (service.get(e.serviceId)?.name ?? null) : null,
    preferredStaffId: e.preferredStaffId,
    preferredStaffName: e.preferredStaffId ? (staffName.get(e.preferredStaffId) ?? null) : null,
    assignedStaffId: e.assignedStaffId,
    assignedStaffName: e.assignedStaffId ? (staffName.get(e.assignedStaffId) ?? null) : null,
    appointmentId: e.appointmentId,
    status: e.status as QueueBoardEntry["status"],
    source: e.source as QueueBoardEntry["source"],
    quotedWaitMin: e.quotedWaitMin,
    notes: e.notes,
    joinedAt: e.joinedAt,
    calledAt: e.calledAt,
    startedAt: e.startedAt,
  });

  const calledRows = entries.filter((e) => e.status === "called");
  const waitingRows = entries.filter((e) => e.status === "waiting");

  // 8. Called entries first (pinned to their person), then the line.
  const jobs: QueueJob[] = [
    ...calledRows.map((e) => ({
      id: e.id,
      minutes: minutesFor(e.serviceId),
      staffIds: e.assignedStaffId ? [e.assignedStaffId] : eligibleFor(e.serviceId),
    })),
    ...waitingRows.map((e) => {
      const eligible = eligibleFor(e.serviceId);
      const pref = e.preferredStaffId;
      return {
        id: e.id,
        minutes: minutesFor(e.serviceId),
        staffIds: pref && eligible.includes(pref) ? [pref] : eligible,
      };
    }),
  ];

  // 9. Estimate. Positions are 1-based over the waiting entries.
  const NEW_JOB = "__new_walk_in__";
  const estimates = estimateQueue(now, poolStaff, [
    ...jobs,
    { id: NEW_JOB, minutes: DEFAULT_MINUTES, staffIds: candidateIds },
  ]);
  const wait = new Map(estimates.map((r) => [r.id, r.waitMinutes]));

  return {
    open: (settings?.open ?? 0) === 1,
    maxWaiting: settings?.maxWaiting ?? 30,
    textOnJoin: (settings?.textOnJoin ?? 0) === 1,
    timezone,
    waitNowMinutes: wait.get(NEW_JOB) ?? null,
    staff: boardStaff,
    waiting: waitingRows.map((e, i) => ({
      ...toEntry(e),
      position: i + 1,
      waitMinutes: wait.get(e.id) ?? null,
    })),
    called: calledRows.map(toEntry),
    inService: entries.filter((e) => e.status === "in_service").map(toEntry),
  };
}
