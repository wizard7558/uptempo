/**
 * Pure scheduling engine types. No I/O, no framework imports.
 * All instants are `Date`; wall-clock values are "HH:mm" / "YYYY-MM-DD"
 * strings interpreted in `Rules.timezone`.
 */

export type Interval = { start: Date; end: Date };

export type WeeklyHours = {
  staffId: string;
  /** 0 = Sunday ... 6 = Saturday (same as Date#getDay). */
  dayOfWeek: 0 | 1 | 2 | 3 | 4 | 5 | 6;
  start: string; // "HH:mm"
  end: string; // "HH:mm"
  locationId: string | null;
}[];

/** Replaces the weekly hours for one staff member on one date. Empty intervals = closed. */
export type DateOverride = {
  staffId: string;
  date: string; // "YYYY-MM-DD"
  intervals: { start: string; end: string; locationId: string | null }[];
};

export type BusyKind = "appointment" | "block" | "external" | "class" | "task";

export type Busy = {
  staffId?: string;
  resourceId?: string;
  interval: Interval;
  kind: BusyKind;
  appointmentId?: string;
  /** Processing windows of a host appointment; flex bookings may sit inside one. */
  processingGaps?: Interval[];
  /**
   * Marks this item as an existing flex (double-book) child of the host appointment
   * with this id. Mirrors legacy `isDoubleBook` + `doubleBookParentAppointmentId`:
   * a flex child blocks normal slots, never blocks a flex candidate, and a host that
   * already has a child offers no further flex.
   */
  flexHostId?: string;
};

export type ResourceNeed = {
  kind?: string;
  resourceId?: string;
  quantity: number;
  offsetMinutes: number;
  /** null = the whole service duration. */
  durationMinutes: number | null;
};

export type LocationType = "in_studio" | "on_site" | "virtual";

export type ServiceRequest = {
  totalMinutes: number;
  activeMinutes?: number;
  processingMinutes?: number;
  bufferBeforeMinutes: number;
  bufferAfterMinutes: number;
  resourceNeeds: ResourceNeed[];
  locationType: LocationType;
};

export type Resource = {
  id: string;
  kind: string;
  locationId: string | null;
  /** Capacity 1 = exclusive. Capacity > 1 lets that many bookings overlap (peak concurrent use is counted). */
  capacity: number;
};

export type LatLng = { lat: number; lng: number };

export type Travel = {
  jobPoint: LatLng;
  staffBase: Record<
    string,
    LatLng & {
      speedKmh: number;
      maxTravelMinutes: number;
      /** Extra minutes required between jobs, on both sides of the visit. */
      bufferMinutes?: number;
    }
  >;
  neighbors: { staffId: string; point: LatLng; interval: Interval }[];
  /** Length of the arrival window shown for on-site slots (default 120; 0 = exact time, no window). */
  arrivalWindowMinutes?: number;
};

export type Rules = {
  timezone: string;
  now: Date;
  minNoticeMinutes: number;
  maxAdvanceDays: number;
  slotIntervalMinutes: number;
  allowFlex: boolean;
  /** When a staff id is present, slot starts must fall inside one of its windows. */
  bookingWindows?: Record<string, { opensAt: Date; closesAt: Date }[]>;
};

export type EngineInput = {
  day: string; // "YYYY-MM-DD" in rules.timezone
  candidateStaffIds: string[];
  anyStaff: boolean;
  hours: WeeklyHours;
  overrides: DateOverride[];
  busy: Busy[];
  resources: Resource[];
  service: ServiceRequest;
  travel?: Travel;
  rules: Rules;
  /** Existing bookings per staff that day; used for any-staff balancing. */
  dayLoad?: Record<string, number>;
};

export type Slot = {
  start: Date;
  end: Date;
  staffId: string;
  resourceIds: string[];
  /** Which resource is held, and when. Set only when the service needs resources. */
  resourceAssignments?: { resourceId: string; interval: Interval }[];
  isFlex: boolean;
  hostAppointmentId?: string;
  locationId: string | null;
  travelBeforeMinutes?: number;
  arrivalWindow?: Interval;
};

export type RejectReason =
  | "OUTSIDE_HOURS"
  | "CLOSED_DAY"
  | "BUSY_APPOINTMENT"
  | "BUSY_BLOCK"
  | "BUSY_EXTERNAL"
  | "BUSY_CLASS"
  | "RESOURCE_UNAVAILABLE"
  | "TOO_SOON"
  | "TOO_FAR"
  | "TRAVEL"
  | "WINDOW_CLOSED";
