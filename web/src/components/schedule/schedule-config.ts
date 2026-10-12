/** Height in pixels per 15-minute slot */
export const SLOT_HEIGHT_PX = 20;

/** Duration of each time slot in minutes */
export const SLOT_DURATION_MINUTES = 15;

/** Slots per hour */
export const SLOTS_PER_HOUR = 60 / SLOT_DURATION_MINUTES;

/** Pixels per hour */
export const HOUR_HEIGHT_PX = SLOT_HEIGHT_PX * SLOTS_PER_HOUR;

/** Default earliest hour shown on the schedule */
export const DEFAULT_START_HOUR = 6;

/** Default latest hour shown on the schedule */
export const DEFAULT_END_HOUR = 22;

/** Total visible hours */
export const TOTAL_HOURS = DEFAULT_END_HOUR - DEFAULT_START_HOUR;

/** Total visible height in pixels */
export const TOTAL_HEIGHT_PX = TOTAL_HOURS * HOUR_HEIGHT_PX;

/**
 * Pixel height of the day-view column header. The header is `h-16` so a photo
 * or initial fits in a 44px circle. CurrentTimeMarker uses this offset because
 * it is a sibling of the columns, not inside each column's grid.
 */
export const COLUMN_HEADER_HEIGHT_PX = 64;

/**
 * Converts a Date to a pixel offset from the top of the schedule.
 */
export function timeToPixelOffset(
  date: Date,
  startHour: number = DEFAULT_START_HOUR,
): number {
  const hours = date.getHours() + date.getMinutes() / 60;
  return (hours - startHour) * HOUR_HEIGHT_PX;
}

/**
 * Converts a pixel offset to minutes from midnight.
 */
export function pixelOffsetToMinutes(
  offset: number,
  startHour: number = DEFAULT_START_HOUR,
): number {
  return startHour * 60 + (offset / HOUR_HEIGHT_PX) * 60;
}

/**
 * Snaps minutes to the nearest 15-minute boundary.
 */
export function snapToSlot(minutes: number): number {
  return Math.round(minutes / SLOT_DURATION_MINUTES) * SLOT_DURATION_MINUTES;
}

export interface LaidOutItem<T> {
  item: T;
  lane: number;
  lanes: number;
}

/**
 * Assigns each item a lane (column index) and total lanes so overlapping
 * time ranges render side-by-side within the same stylist column.
 * Items that share a cluster (transitively overlap) all receive the same
 * `lanes` count, matching Google Calendar / Vagaro layout.
 */
export function computeOverlapLanes<T extends { start: Date; end: Date }>(
  items: T[],
): LaidOutItem<T>[] {
  if (items.length === 0) return [];

  const sorted = items
    .map((item, originalIndex) => ({ item, originalIndex }))
    .sort((a, b) => {
      const startDiff = a.item.start.getTime() - b.item.start.getTime();
      if (startDiff !== 0) return startDiff;
      return b.item.end.getTime() - a.item.end.getTime();
    });

  type Entry = (typeof sorted)[number];
  const clusters: Entry[][] = [];
  let current: Entry[] = [];
  let clusterMaxEnd = -Infinity;
  for (const entry of sorted) {
    const startMs = entry.item.start.getTime();
    if (current.length === 0 || startMs < clusterMaxEnd) {
      current.push(entry);
      clusterMaxEnd = Math.max(clusterMaxEnd, entry.item.end.getTime());
    } else {
      clusters.push(current);
      current = [entry];
      clusterMaxEnd = entry.item.end.getTime();
    }
  }
  if (current.length > 0) clusters.push(current);

  const result: LaidOutItem<T>[] = new Array(items.length);
  for (const cluster of clusters) {
    const laneEnds: number[] = [];
    const assignments: { entry: Entry; lane: number }[] = [];
    for (const entry of cluster) {
      const startMs = entry.item.start.getTime();
      let lane = laneEnds.findIndex((end) => end <= startMs);
      if (lane === -1) {
        lane = laneEnds.length;
        laneEnds.push(entry.item.end.getTime());
      } else {
        laneEnds[lane] = entry.item.end.getTime();
      }
      assignments.push({ entry, lane });
    }
    const totalLanes = laneEnds.length;
    for (const { entry, lane } of assignments) {
      result[entry.originalIndex] = {
        item: entry.item,
        lane,
        lanes: totalLanes,
      };
    }
  }

  return result;
}
