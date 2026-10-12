import {
  uuid,
  text,
  integer,
  timestamp,
  date,
  uniqueIndex,
  unique,
  index,
  jsonb,
  doublePrecision,
  numeric,
  type AnyPgColumn,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import type { PgSchema } from "drizzle-orm/pg-core";
import { tstzrange } from "@/lib/db/custom-types";

/**
 * Creates all tenant-scoped table definitions parameterized by a pgSchema instance.
 * Tables mirror the public schema definitions but without salon_id columns,
 * since the schema itself IS the tenant context.
 */
export function createTenantTables(schema: PgSchema) {
  const services = schema.table("services", {
    id: uuid("id").primaryKey().defaultRandom(),
    name: text("name").notNull(),
    /** Optional notes shown during booking (e.g. add-on details) */
    description: text("description"),
    defaultDurationMinutes: integer("default_duration_minutes").notNull(),
    priceCents: integer("price_cents"),
    /** Estimated cost of delivering one unit (COGS), for margin analytics */
    costCents: integer("cost_cents"),
    category: text("category").notNull().default("other"),
    activeMinutes: integer("active_minutes"),
    processingMinutes: integer("processing_minutes"),
    isActive: integer("is_active").notNull().default(1),
    /** 0 = service is internal-only (staff can book it, clients can't see/self-book it online). */
    onlineBookable: integer("online_bookable").notNull().default(1),
    /** Who may self-book this online: 'all' | 'new' (first-timers only) | 'returning'. Staff booking ignores this. */
    bookingAudience: text("booking_audience").notNull().default("all"),
    /** How the price renders on the public booking page: 'show' = exact, 'starting' = "From $X", 'hidden' = no price. */
    priceDisplay: text("price_display").notNull().default("show"),
    /**
     * Per-service deposit override. NULL = inherit the salon's global deposit rule.
     * 'none' = never require a deposit. 'percent'/'fixed' = override with `depositAmount`
     * (percent points, e.g. 25, or cents, e.g. 5000).
     */
    depositType: text("deposit_type"),
    depositAmount: integer("deposit_amount"),
    /** When 1, booking this service triggers an auto assistant task for the stylist's default assistant */
    assistantWorkflow: integer("assistant_workflow").notNull().default(0),
    /** Optional task catalog row for auto task label / type */
    assistantTaskTypeId: uuid("assistant_task_type_id"),
    /** Prep time kept free before the service starts (0-240). */
    bufferBeforeMin: integer("buffer_before_min").notNull().default(0),
    /** Cleanup time kept free after the service ends (0-240). */
    bufferAfterMin: integer("buffer_after_min").notNull().default(0),
    /** Per-service minimum notice in minutes. NULL = use the business setting. */
    minNoticeMin: integer("min_notice_min"),
    /** Per-service booking horizon in days. NULL = use the business setting. */
    maxAdvanceDays: integer("max_advance_days"),
    /** Per-service start-time grid in minutes. NULL = use the business setting. */
    slotIntervalMin: integer("slot_interval_min"),
    /** 'in_studio' | 'on_site' | 'virtual' */
    locationType: text("location_type").notNull().default("in_studio"),
    /** This service is a version (variant) of another service. */
    /** 1 = runs as a group class (see class_sessions). */
    isClass: integer("is_class").notNull().default(0),
    /** Default seats per session for a class service. NULL = not set. */
    classCapacity: integer("class_capacity"),
    variantOfServiceId: uuid("variant_of_service_id").references(
      (): AnyPgColumn => services.id,
      { onDelete: "set null" },
    ),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  });

  const clients = schema.table(
    "clients",
    {
      id: uuid("id").primaryKey().defaultRandom(),
      name: text("name").notNull(),
      email: text("email"),
      phone: text("phone"),
      stripeCustomerId: text("stripe_customer_id"),
      stripePaymentMethodId: text("stripe_payment_method_id"),
      notes: text("notes"),
      birthday: date("birthday"),
      gender: text("gender"),
      address: text("address"),
      city: text("city"),
      state: text("state"),
      zip: text("zip"),
      customerSince: date("customer_since"),
      appointmentsBooked: integer("appointments_booked").default(0).notNull(),
      source: text("source"),
      attributes: jsonb("attributes").$type<Record<string, unknown>>().notNull().default({}),
      createdAt: timestamp("created_at", { withTimezone: true })
        .defaultNow()
        .notNull(),
      updatedAt: timestamp("updated_at", { withTimezone: true })
        .defaultNow()
        .notNull(),
      /** Soft-delete: archived clients are hidden from lists but keep their history. */
      deletedAt: timestamp("deleted_at", { withTimezone: true }),
    },
    (table) => [
      uniqueIndex("clients_email_unique").on(table.email).where(
        sql`${table.email} IS NOT NULL AND ${table.deletedAt} IS NULL`,
      ),
      uniqueIndex("clients_phone_unique").on(table.phone).where(
        sql`${table.phone} IS NOT NULL AND ${table.deletedAt} IS NULL`,
      ),
    ],
  );

  const clientServiceOverrides = schema.table(
    "client_service_overrides",
    {
      id: uuid("id").primaryKey().defaultRandom(),
      clientId: uuid("client_id")
        .notNull()
        .references(() => clients.id, { onDelete: "cascade" }),
      serviceId: uuid("service_id")
        .notNull()
        .references(() => services.id, { onDelete: "cascade" }),
      durationMinutes: integer("duration_minutes"),
      priceCents: integer("price_cents"),
      activeMinutes: integer("active_minutes"),
      processingMinutes: integer("processing_minutes"),
      createdAt: timestamp("created_at", { withTimezone: true })
        .defaultNow()
        .notNull(),
      updatedAt: timestamp("updated_at", { withTimezone: true })
        .defaultNow()
        .notNull(),
    },
    (table) => [
      unique("client_service_override_unique").on(
        table.clientId,
        table.serviceId,
      ),
    ],
  );

  const staff = schema.table("staff", {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: text("user_id"), // Links to public.user.id
    email: text("email"), // Contact email for the stylist
    /** Contact phone (admin-facing only, not surfaced to clients). */
    phone: text("phone"),
    displayName: text("display_name").notNull(),
    photoUrl: text("photo_url"),
    bio: text("bio"),
    role: text("role").notNull().default("provider"), // "provider" | "assistant"
    /** Assistant staff member paired with this stylist for auto assistant tasks */
    defaultAssistantId: uuid("default_assistant_id"),
    /** Capacity Coach goal: hours/week the stylist wants to work (null = unset). */
    targetHoursPerWeek: integer("target_hours_per_week"),
    /** Capacity Coach goal: take-home they want to average per hour, in cents. */
    targetHourlyEarningsCents: integer("target_hourly_earnings_cents"),
    /** Books: open (always bookable), windows (only inside booking_windows), closed. */
    booksMode: text("books_mode").notNull().default("open"),
    isActive: integer("is_active").notNull().default(1),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  });

  const staffServices = schema.table(
    "staff_services",
    {
      id: uuid("id").primaryKey().defaultRandom(),
      staffId: uuid("staff_id")
        .notNull()
        .references(() => staff.id, { onDelete: "cascade" }),
      serviceId: uuid("service_id")
        .notNull()
        .references(() => services.id, { onDelete: "cascade" }),
      /** Per-stylist overrides; NULL = use the catalog default on `services`. */
      priceCents: integer("price_cents"),
      durationMinutes: integer("duration_minutes"),
      activeMinutes: integer("active_minutes"),
      processingMinutes: integer("processing_minutes"),
      /** Stylist-specific display name (e.g. "Riley's signature haircut"). */
      customName: text("custom_name"),
      /** Soft toggle: 0 = stylist hides this service without unlinking. */
      isOffered: integer("is_offered").notNull().default(1),
      createdAt: timestamp("created_at", { withTimezone: true })
        .defaultNow()
        .notNull(),
      updatedAt: timestamp("updated_at", { withTimezone: true })
        .defaultNow()
        .notNull(),
    },
    (table) => [
      unique("staff_service_unique").on(table.staffId, table.serviceId),
      index("staff_services_staff_offered_idx").on(
        table.staffId,
        table.isOffered,
      ),
    ],
  );

  const locations = schema.table("locations", {
    id: uuid("id").primaryKey().defaultRandom(),
    name: text("name").notNull(),
    address: text("address"),
    isActive: integer("is_active").notNull().default(1),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  });

  /**
   * Appointments booked together (a couple, a party, one client with several
   * techs, a crew). `clientId` is the payer; members keep their own client.
   */
  const bookingGroups = schema.table(
    "booking_groups",
    {
      id: uuid("id").primaryKey().defaultRandom(),
      clientId: uuid("client_id")
        .notNull()
        .references(() => clients.id),
      kind: text("kind").notNull(),
      depositCents: integer("deposit_cents").notNull().default(0),
      notes: text("notes"),
      createdAt: timestamp("created_at", { withTimezone: true })
        .defaultNow()
        .notNull(),
      updatedAt: timestamp("updated_at", { withTimezone: true })
        .defaultNow()
        .notNull(),
    },
    (table) => [index("booking_groups_client_idx").on(table.clientId)],
  );

  /**
   * A repeating series (every week or every 2 weeks). The nightly materializer
   * books visits up to 84 days ahead; `materializedThrough` is how far it got.
   */
  const recurrenceRules = schema.table(
    "recurrence_rules",
    {
      id: uuid("id").primaryKey().defaultRandom(),
      rrule: text("rrule").notNull(),
      startsAt: timestamp("starts_at", { withTimezone: true }).notNull(),
      until: timestamp("until", { withTimezone: true }),
      count: integer("count"),
      timezone: text("timezone").notNull(),
      materializedThrough: timestamp("materialized_through", { withTimezone: true }),
      staffId: uuid("staff_id").notNull(),
      clientId: uuid("client_id")
        .notNull()
        .references(() => clients.id, { onDelete: "cascade" }),
      locationId: uuid("location_id").references(() => locations.id, {
        onDelete: "set null",
      }),
      serviceIds: jsonb("service_ids").$type<string[]>().notNull().default([]),
      isActive: integer("is_active").notNull().default(1),
      createdAt: timestamp("created_at", { withTimezone: true })
        .defaultNow()
        .notNull(),
      updatedAt: timestamp("updated_at", { withTimezone: true })
        .defaultNow()
        .notNull(),
    },
  );

  /** Where a client wants an on-site visit. lat/lng come from the ZIP centroid or a manual pin. */
  const clientAddresses = schema.table(
    "client_addresses",
    {
      id: uuid("id").primaryKey().defaultRandom(),
      clientId: uuid("client_id")
        .notNull()
        .references(() => clients.id, { onDelete: "cascade" }),
      label: text("label"),
      line1: text("line1").notNull(),
      line2: text("line2"),
      city: text("city"),
      region: text("region"),
      postalCode: text("postal_code").notNull(),
      country: text("country").notNull().default("US"),
      lat: doublePrecision("lat"),
      lng: doublePrecision("lng"),
      geoSource: text("geo_source"), // postal_centroid | manual
      accessNotes: text("access_notes"),
      isDefault: integer("is_default").notNull().default(0),
      createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
      updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
    },
    (table) => [index("client_addresses_client_idx").on(table.clientId)],
  );

  const appointments = schema.table("appointments", {
    id: uuid("id").primaryKey().defaultRandom(),
    staffId: uuid("staff_id").notNull(),
    clientId: uuid("client_id")
      .notNull()
      .references(() => clients.id),
    serviceId: uuid("service_id").references(() => services.id),
    locationId: uuid("location_id").references(() => locations.id),
    /** Deposit collected at booking (cents); credited against the final bill at checkout. */
    depositCents: integer("deposit_cents").notNull().default(0),
    during: tstzrange("during").notNull(),
    status: text("status").notNull().default("confirmed"),
    notes: text("notes"),
    isDoubleBook: integer("is_double_book").notNull().default(0),
    /** The credit_ledger redeem row that paid for this booking, if any. */
    creditEntryId: uuid("credit_entry_id").references(
      (): AnyPgColumn => creditLedger.id,
      { onDelete: "set null" },
    ),
    doubleBookParentAppointmentId: uuid(
      "double_book_parent_appointment_id",
    ).references((): AnyPgColumn => appointments.id, { onDelete: "set null" }),
    calendarEventId: text("calendar_event_id"),
    calendarSyncStatus: text("calendar_sync_status").default("pending"),
    reminderSentAt: timestamp("reminder_sent_at", { withTimezone: true }),
    smsReminderSentAt: timestamp("sms_reminder_sent_at", {
      withTimezone: true,
    }),
    reminderSentAt2: timestamp("reminder_sent_at_2", { withTimezone: true }),
    smsReminderSentAt2: timestamp("sms_reminder_sent_at_2", {
      withTimezone: true,
    }),
    pushReminderSentAt: timestamp("push_reminder_sent_at", {
      withTimezone: true,
    }),
    pushReminderSentAt2: timestamp("push_reminder_sent_at_2", {
      withTimezone: true,
    }),
    /** At booking time: first-ever booking for client in salon vs returning */
    clientStatusAtBooking: text("client_status_at_booking"),
    /** Set when this appointment is one member of a group booking. */
    bookingGroupId: uuid("booking_group_id").references(() => bookingGroups.id, {
      onDelete: "set null",
    }),
    /** Set when this appointment is one visit of a repeating series. */
    recurrenceRuleId: uuid("recurrence_rule_id").references(() => recurrenceRules.id, {
      onDelete: "set null",
    }),
    recurrenceIndex: integer("recurrence_index"),
    /** On-site visits: where the job is, the arrival window shown to the client, and the "On my way" text. */
    serviceAddressId: uuid("service_address_id").references(() => clientAddresses.id, {
      onDelete: "set null",
    }),
    arrivalWindowMin: integer("arrival_window_min"),
    onMyWaySentAt: timestamp("on_my_way_sent_at", { withTimezone: true }),
    checkedInAt: timestamp("checked_in_at", { withTimezone: true }),
    /** Multi-session work (tattoo, etc.): the project this visit belongs to. */
    projectId: uuid("project_id").references((): AnyPgColumn => projects.id, {
      onDelete: "set null",
    }),
    attributes: jsonb("attributes").$type<Record<string, unknown>>().notNull().default({}),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  }, (table) => [
    index("appointments_staff_status_idx").on(table.staffId, table.status),
    index("appointments_client_id_idx").on(table.clientId),
    index("appointments_calendar_sync_status_idx").on(table.calendarSyncStatus),
    index("appointments_reminder_sent_at_idx").on(table.reminderSentAt),
    index("appointments_project_idx").on(table.projectId).where(sql`project_id IS NOT NULL`),
  ]);

  /** Walk-in line. One row per person; the status link token is stored hashed. */
  const queueEntries = schema.table(
    "queue_entries",
    {
      id: uuid("id").primaryKey().defaultRandom(),
      locationId: uuid("location_id").references(() => locations.id, { onDelete: "set null" }),
      clientId: uuid("client_id").references(() => clients.id, { onDelete: "set null" }),
      name: text("name").notNull(),
      phone: text("phone"),
      serviceId: uuid("service_id").references(() => services.id, { onDelete: "set null" }),
      preferredStaffId: uuid("preferred_staff_id").references(() => staff.id, { onDelete: "set null" }),
      assignedStaffId: uuid("assigned_staff_id").references(() => staff.id, { onDelete: "set null" }),
      appointmentId: uuid("appointment_id").references(() => appointments.id, { onDelete: "set null" }),
      /** 'waiting' | 'called' | 'in_service' | 'done' | 'left' */
      status: text("status").notNull().default("waiting"),
      /** 'qr' | 'kiosk' | 'front_desk' */
      source: text("source").notNull().default("qr"),
      quotedWaitMin: integer("quoted_wait_min"),
      publicTokenHash: text("public_token_hash").notNull(),
      notes: text("notes"),
      joinedAt: timestamp("joined_at", { withTimezone: true }).defaultNow().notNull(),
      calledAt: timestamp("called_at", { withTimezone: true }),
      startedAt: timestamp("started_at", { withTimezone: true }),
      doneAt: timestamp("done_at", { withTimezone: true }),
      leftAt: timestamp("left_at", { withTimezone: true }),
      createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
      updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
    },
    (t) => [
      uniqueIndex("queue_entries_token_unique").on(t.publicTokenHash),
      index("queue_entries_active_idx")
        .on(t.locationId, t.joinedAt)
        .where(sql`${t.status} IN ('waiting','called','in_service')`),
      uniqueIndex("queue_entries_phone_active_unique")
        .on(t.phone)
        .where(sql`${t.phone} IS NOT NULL AND ${t.status} IN ('waiting','called')`),
      index("queue_entries_service_done_idx")
        .on(t.serviceId, t.doneAt)
        .where(sql`${t.status} = 'done'`),
    ],
  );

  /** A cancelled appointment that can be offered to the slot waitlist. */
  const waitlistOpenings = schema.table(
    "waitlist_openings",
    {
      id: uuid("id").primaryKey().defaultRandom(),
      appointmentId: uuid("appointment_id").references(() => appointments.id, { onDelete: "set null" }),
      staffId: uuid("staff_id")
        .notNull()
        .references(() => staff.id, { onDelete: "cascade" }),
      locationId: uuid("location_id").references(() => locations.id, { onDelete: "set null" }),
      startsAt: timestamp("starts_at", { withTimezone: true }).notNull(),
      endsAt: timestamp("ends_at", { withTimezone: true }).notNull(),
      /** 'open' | 'offered' | 'filled' | 'closed' */
      status: text("status").notNull().default("open"),
      attempts: integer("attempts").notNull().default(0),
      offeredEntryIds: jsonb("offered_entry_ids").$type<string[]>().notNull().default([]),
      createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
      updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
    },
    (t) => [
      uniqueIndex("waitlist_openings_appointment_unique")
        .on(t.appointmentId)
        .where(sql`${t.appointmentId} IS NOT NULL`),
      index("waitlist_openings_open_idx")
        .on(t.startsAt)
        .where(sql`${t.status} = 'open'`),
    ],
  );

  /** A client waiting for a cancelled time. An offered row is the public hold. */
  const slotWaitlist = schema.table(
    "slot_waitlist",
    {
      id: uuid("id").primaryKey().defaultRandom(),
      clientId: uuid("client_id")
        .notNull()
        .references(() => clients.id, { onDelete: "cascade" }),
      serviceIds: jsonb("service_ids").$type<string[]>().notNull(),
      staffId: uuid("staff_id").references(() => staff.id, { onDelete: "cascade" }),
      locationId: uuid("location_id").references(() => locations.id, { onDelete: "set null" }),
      dateFrom: date("date_from").notNull(),
      dateTo: date("date_to").notNull(),
      timeFrom: text("time_from").notNull().default("00:00"),
      timeTo: text("time_to").notNull().default("23:59"),
      /** 'waiting' | 'offered' | 'booked' | 'expired' | 'cancelled' */
      status: text("status").notNull().default("waiting"),
      /** 'online' | 'front_desk' */
      source: text("source").notNull().default("online"),
      notifiedAt: timestamp("notified_at", { withTimezone: true }),
      missedOffers: integer("missed_offers").notNull().default(0),
      openingId: uuid("opening_id").references(() => waitlistOpenings.id, { onDelete: "set null" }),
      offerTokenHash: text("offer_token_hash"),
      offerExpiresAt: timestamp("offer_expires_at", { withTimezone: true }),
      offeredStaffId: uuid("offered_staff_id").references(() => staff.id, { onDelete: "set null" }),
      offeredStart: timestamp("offered_start", { withTimezone: true }),
      offeredEnd: timestamp("offered_end", { withTimezone: true }),
      offeredLocationId: uuid("offered_location_id").references(() => locations.id, {
        onDelete: "set null",
      }),
      bookedAppointmentId: uuid("booked_appointment_id").references(() => appointments.id, {
        onDelete: "set null",
      }),
      createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
      updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
    },
    (t) => [
      index("slot_waitlist_match_idx")
        .on(t.dateFrom, t.dateTo)
        .where(sql`${t.status} = 'waiting'`),
      index("slot_waitlist_client_idx")
        .on(t.clientId)
        .where(sql`${t.status} IN ('waiting','offered')`),
      uniqueIndex("slot_waitlist_offer_token_unique")
        .on(t.offerTokenHash)
        .where(sql`${t.offerTokenHash} IS NOT NULL`),
      index("slot_waitlist_holds_idx")
        .on(t.offeredStaffId, t.offerExpiresAt)
        .where(sql`${t.status} = 'offered'`),
    ],
  );

  /**
   * A client's request for something that needs a quote first (tattoo, home
   * services). `answers` holds the pack's request fields; the booking comes later.
   */
  const bookingRequests = schema.table(
    "booking_requests",
    {
      id: uuid("id").primaryKey().defaultRandom(),
      clientId: uuid("client_id")
        .notNull()
        .references(() => clients.id, { onDelete: "cascade" }),
      serviceId: uuid("service_id").references(() => services.id, { onDelete: "set null" }),
      staffId: uuid("staff_id").references(() => staff.id, { onDelete: "set null" }),
      kind: text("kind").notNull().default("quote"), // quote | consultation | custom_piece
      status: text("status").notNull().default("new"), // new | reviewing | quoted | accepted | declined | converted | expired
      answers: jsonb("answers").$type<Record<string, unknown>>().notNull().default({}),
      preferredWindows: jsonb("preferred_windows")
        .$type<{ days: number[]; parts: ("morning" | "afternoon" | "evening")[] }[]>()
        .notNull()
        .default([]),
      appointmentId: uuid("appointment_id").references(() => appointments.id, {
        onDelete: "set null",
      }),
      addressId: uuid("address_id").references(() => clientAddresses.id, { onDelete: "set null" }),
      declineReason: text("decline_reason"),
      attributes: jsonb("attributes").$type<Record<string, unknown>>().notNull().default({}),
      reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
      createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
      updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
    },
    (table) => [
      index("booking_requests_status_created_idx").on(table.status, table.createdAt.desc()),
      index("booking_requests_client_idx").on(table.clientId),
    ],
  );

  /** Where the business (or one staff member) travels: a ZIP list or a distance from a center point. */
  const serviceAreas = schema.table("service_areas", {
    id: uuid("id").primaryKey().defaultRandom(),
    staffId: uuid("staff_id").references(() => staff.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    kind: text("kind").notNull(), // postal_codes | radius
    postalCodes: text("postal_codes").array().notNull().default(sql`'{}'`),
    centerLat: doublePrecision("center_lat"),
    centerLng: doublePrecision("center_lng"),
    radiusKm: numeric("radius_km", { precision: 6, scale: 2 }),
    isActive: integer("is_active").notNull().default(1),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  });

  /** Where a staff member starts the day and how they drive. Needed before they can take on-site jobs. */
  const staffTravelSettings = schema.table("staff_travel_settings", {
    staffId: uuid("staff_id")
      .primaryKey()
      .references(() => staff.id, { onDelete: "cascade" }),
    basePostalCode: text("base_postal_code"),
    baseLat: doublePrecision("base_lat").notNull(),
    baseLng: doublePrecision("base_lng").notNull(),
    maxTravelMin: integer("max_travel_min").notNull().default(60),
    travelBufferMin: integer("travel_buffer_min").notNull().default(0),
    speedKmh: integer("speed_kmh").notNull().default(40),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  });

  /**
   * Private files. Only a storage key is kept (never a URL); reads go through
   * signed links. `id_document` rows must stay private (CHECK in migration 0047).
   */
  const attachments = schema.table(
    "attachments",
    {
      id: uuid("id").primaryKey().defaultRandom(),
      ownerType: text("owner_type").notNull(), // request | appointment | project | form_response | client
      ownerId: uuid("owner_id"),
      clientId: uuid("client_id").references(() => clients.id, { onDelete: "cascade" }),
      kind: text("kind").notNull(), // reference | before | after | site | id_document | design
      storageKey: text("storage_key").notNull(),
      mime: text("mime").notNull(),
      sizeBytes: integer("size_bytes").notNull(),
      originalName: text("original_name"),
      isPrivate: integer("is_private").notNull().default(1),
      uploadedBy: text("uploaded_by").notNull(),
      caption: text("caption"),
      deleteAfter: timestamp("delete_after", { withTimezone: true }),
      deletedAt: timestamp("deleted_at", { withTimezone: true }),
      createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    },
    (table) => [
      unique("attachments_storage_key_unique").on(table.storageKey),
      index("attachments_owner_idx")
        .on(table.ownerType, table.ownerId)
        .where(sql`deleted_at IS NULL`),
      index("attachments_owner_created_idx").on(table.ownerType, table.ownerId, table.createdAt),
      index("attachments_delete_after_idx")
        .on(table.deleteAfter)
        .where(sql`delete_after IS NOT NULL AND deleted_at IS NULL`),
    ],
  );

  /** Steps for one service. Copied onto an appointment the first time it is opened. */
  const checklistTemplates = schema.table(
    "checklist_templates",
    {
      id: uuid("id").primaryKey().defaultRandom(),
      serviceId: uuid("service_id")
        .notNull()
        .references(() => services.id, { onDelete: "cascade" }),
      items: jsonb("items")
        .$type<{ id: string; label: string }[]>()
        .notNull()
        .default([]),
      createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
      updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
    },
    (t) => [unique("checklist_templates_service_unique").on(t.serviceId)],
  );

  const appointmentChecklistItems = schema.table(
    "appointment_checklist_items",
    {
      id: uuid("id").primaryKey().defaultRandom(),
      appointmentId: uuid("appointment_id")
        .notNull()
        .references(() => appointments.id, { onDelete: "cascade" }),
      label: text("label").notNull(),
      sortOrder: integer("sort_order").notNull().default(0),
      sourceKey: text("source_key"),
      doneAt: timestamp("done_at", { withTimezone: true }),
      doneBy: text("done_by"),
      createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
      updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
    },
    (t) => [
      uniqueIndex("appointment_checklist_items_source_unique")
        .on(t.appointmentId, t.sourceKey)
        .where(sql`source_key IS NOT NULL`),
      index("appointment_checklist_items_appt_idx").on(t.appointmentId, t.sortOrder),
    ],
  );

  /** An owner's priced offer for a request. At most one "sent" quote per request. */
  const quotes = schema.table(
    "quotes",
    {
      id: uuid("id").primaryKey().defaultRandom(),
      requestId: uuid("request_id")
        .notNull()
        .references(() => bookingRequests.id, { onDelete: "cascade" }),
      staffId: uuid("staff_id").references(() => staff.id, { onDelete: "set null" }),
      status: text("status").notNull().default("draft"), // draft | sent | accepted | declined | expired | withdrawn
      accessToken: text("access_token").notNull(),
      subtotalCents: integer("subtotal_cents").notNull().default(0),
      depositCents: integer("deposit_cents").notNull().default(0),
      message: text("message"),
      validUntil: timestamp("valid_until", { withTimezone: true }),
      sentAt: timestamp("sent_at", { withTimezone: true }),
      acceptedAt: timestamp("accepted_at", { withTimezone: true }),
      acceptedName: text("accepted_name"),
      acceptedIp: text("accepted_ip"),
      declinedAt: timestamp("declined_at", { withTimezone: true }),
      appointmentId: uuid("appointment_id").references(() => appointments.id, {
        onDelete: "set null",
      }),
      /** When set, accepting the quote creates a project with this many sessions. */
      projectSessions: integer("project_sessions"),
      createdBy: text("created_by"),
      createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
      updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
    },
    (table) => [
      unique("quotes_access_token_unique").on(table.accessToken),
      uniqueIndex("quotes_one_sent_per_request")
        .on(table.requestId)
        .where(sql`status = 'sent'`),
      index("quotes_request_idx").on(table.requestId),
    ],
  );

  /** A multi-session piece of work (e.g. a tattoo) with one quoted total and a shared deposit credit. */
  const projects = schema.table(
    "projects",
    {
      id: uuid("id").primaryKey().defaultRandom(),
      clientId: uuid("client_id")
        .notNull()
        .references(() => clients.id, { onDelete: "cascade" }),
      staffId: uuid("staff_id").references(() => staff.id, { onDelete: "set null" }),
      requestId: uuid("request_id").references(() => bookingRequests.id, { onDelete: "set null" }),
      title: text("title").notNull(),
      placement: text("placement"),
      size: text("size"),
      status: text("status").notNull().default("consult"), // consult | design | scheduled | in_progress | healing | touch_up | complete | cancelled
      estSessions: integer("est_sessions").notNull().default(1),
      quotedTotalCents: integer("quoted_total_cents"),
      designAttachmentId: uuid("design_attachment_id").references(() => attachments.id, {
        onDelete: "set null",
      }),
      designSentAt: timestamp("design_sent_at", { withTimezone: true }),
      designApprovedAt: timestamp("design_approved_at", { withTimezone: true }),
      designApprovedName: text("design_approved_name"),
      accessToken: text("access_token").notNull(),
      notes: text("notes"),
      attributes: jsonb("attributes").$type<Record<string, unknown>>().notNull().default({}),
      createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
      updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
    },
    (table) => [
      unique("projects_access_token_unique").on(table.accessToken),
      index("projects_client_idx").on(table.clientId),
      index("projects_status_idx").on(table.status, sql`${table.updatedAt} DESC`),
    ],
  );

  /** When a staff member's books are open (books_mode = 'windows'); requests or direct booking. */
  const bookingWindows = schema.table(
    "booking_windows",
    {
      id: uuid("id").primaryKey().defaultRandom(),
      staffId: uuid("staff_id").references(() => staff.id, { onDelete: "cascade" }),
      opensAt: timestamp("opens_at", { withTimezone: true }).notNull(),
      closesAt: timestamp("closes_at", { withTimezone: true }).notNull(),
      mode: text("mode").notNull().default("requests"), // requests | direct
      note: text("note"),
      createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
      updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
    },
    (table) => [index("booking_windows_staff_closes_idx").on(table.staffId, table.closesAt)],
  );

  /** Quote lines always reference a service; description, price and minutes override it. */
  const quoteLineItems = schema.table(
    "quote_line_items",
    {
      id: uuid("id").primaryKey().defaultRandom(),
      quoteId: uuid("quote_id")
        .notNull()
        .references(() => quotes.id, { onDelete: "cascade" }),
      serviceId: uuid("service_id")
        .notNull()
        .references(() => services.id, { onDelete: "restrict" }),
      description: text("description").notNull(),
      quantity: integer("quantity").notNull().default(1),
      unitCents: integer("unit_cents").notNull(),
      minutes: integer("minutes").notNull().default(0),
      sort: integer("sort").notNull().default(0),
      createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    },
    (table) => [index("quote_line_items_quote_idx").on(table.quoteId, table.sort)],
  );

  /**
   * APNs device tokens for native iOS push notifications. Polymorphic owner:
   * `client` (booking app, owner_id = clients.id) or `user` (owner/staff app,
   * owner_id = public user id). Tenant-scoped so the reminder cron can join
   * tokens to appointments within the salon.
   */
  const deviceTokens = schema.table(
    "device_tokens",
    {
      id: uuid("id").primaryKey().defaultRandom(),
      ownerType: text("owner_type").notNull(), // "client" | "user"
      ownerId: text("owner_id").notNull(),
      apnsToken: text("apns_token").notNull(),
      environment: text("environment").notNull().default("production"), // "sandbox" | "production"
      revoked: integer("revoked").notNull().default(0),
      createdAt: timestamp("created_at", { withTimezone: true })
        .defaultNow()
        .notNull(),
      lastSeenAt: timestamp("last_seen_at", { withTimezone: true })
        .defaultNow()
        .notNull(),
    },
    (table) => [
      uniqueIndex("device_tokens_apns_token_unique").on(table.apnsToken),
      index("device_tokens_owner_idx").on(table.ownerType, table.ownerId),
    ],
  );

  /** Internal busy blocks (between clients) — same stylist + location lane as appointments overlap rules */
  const timeBlocks = schema.table(
    "time_blocks",
    {
      id: uuid("id").primaryKey().defaultRandom(),
      staffId: uuid("staff_id")
        .notNull()
        .references(() => staff.id, { onDelete: "cascade" }),
      locationId: uuid("location_id").references(() => locations.id, {
        onDelete: "set null",
      }),
      during: tstzrange("during").notNull(),
      label: text("label"),
      createdAt: timestamp("created_at", { withTimezone: true })
        .defaultNow()
        .notNull(),
      updatedAt: timestamp("updated_at", { withTimezone: true })
        .defaultNow()
        .notNull(),
    },
    (table) => [
      index("time_blocks_staff_during_idx").on(table.staffId),
    ],
  );

  /** A room, chair, station, piece of equipment or vehicle. Capacity 1 = one booking at a time. */
  const resources = schema.table(
    "resources",
    {
      id: uuid("id").primaryKey().defaultRandom(),
      /** NULL = usable at every location. */
      locationId: uuid("location_id").references(() => locations.id, {
        onDelete: "set null",
      }),
      /** 'room' | 'chair' | 'station' | 'equipment' | 'vehicle' */
      kind: text("kind").notNull(),
      name: text("name").notNull(),
      capacity: integer("capacity").notNull().default(1),
      isActive: integer("is_active").notNull().default(1),
      createdAt: timestamp("created_at", { withTimezone: true })
        .defaultNow()
        .notNull(),
      updatedAt: timestamp("updated_at", { withTimezone: true })
        .defaultNow()
        .notNull(),
    },
    (t) => [
      index("resources_location_kind_idx")
        .on(t.locationId, t.kind)
        .where(sql`${t.isActive} = 1`),
    ],
  );

  /** What a service needs: a type of resource or one specific resource. */
  const serviceResourceRequirements = schema.table(
    "service_resource_requirements",
    {
      id: uuid("id").primaryKey().defaultRandom(),
      serviceId: uuid("service_id")
        .notNull()
        .references(() => services.id, { onDelete: "cascade" }),
      resourceKind: text("resource_kind"),
      resourceId: uuid("resource_id").references(() => resources.id, {
        onDelete: "cascade",
      }),
      quantity: integer("quantity").notNull().default(1),
      /** Minutes after the start of the service when the need begins. */
      offsetMin: integer("offset_min").notNull().default(0),
      /** NULL = for the whole service. */
      durationMin: integer("duration_min"),
      createdAt: timestamp("created_at", { withTimezone: true })
        .defaultNow()
        .notNull(),
    },
    (t) => [index("srr_service_idx").on(t.serviceId)],
  );

  /**
   * Which resource a booking holds, and when. isExclusive is set by a database
   * trigger from resources.capacity; never write it from the app.
   */
  const appointmentResources = schema.table(
    "appointment_resources",
    {
      id: uuid("id").primaryKey().defaultRandom(),
      appointmentId: uuid("appointment_id")
        .notNull()
        .references(() => appointments.id, { onDelete: "cascade" }),
      resourceId: uuid("resource_id")
        .notNull()
        .references(() => resources.id, { onDelete: "restrict" }),
      during: tstzrange("during").notNull(),
      isExclusive: integer("is_exclusive").notNull().default(1),
      createdAt: timestamp("created_at", { withTimezone: true })
        .defaultNow()
        .notNull(),
    },
    (t) => [index("appointment_resources_appointment_idx").on(t.appointmentId)],
  );

  /** One scheduled run of a class service. Seats are enforced by class_enrollments_guard. */
  const classSessions = schema.table(
    "class_sessions",
    {
      id: uuid("id").primaryKey().defaultRandom(),
      serviceId: uuid("service_id")
        .notNull()
        .references(() => services.id, { onDelete: "restrict" }),
      staffId: uuid("staff_id")
        .notNull()
        .references(() => staff.id, { onDelete: "restrict" }),
      locationId: uuid("location_id").references(() => locations.id, {
        onDelete: "set null",
      }),
      resourceId: uuid("resource_id").references(() => resources.id, {
        onDelete: "set null",
      }),
      during: tstzrange("during").notNull(),
      capacity: integer("capacity").notNull(),
      waitlistCapacity: integer("waitlist_capacity").notNull().default(10),
      /** 'scheduled' | 'cancelled' | 'completed' */
      status: text("status").notNull().default("scheduled"),
      seriesId: uuid("series_id"),
      timeBlockId: uuid("time_block_id").references(() => timeBlocks.id, {
        onDelete: "set null",
      }),
      priceCents: integer("price_cents"),
      notes: text("notes"),
      createdAt: timestamp("created_at", { withTimezone: true })
        .defaultNow()
        .notNull(),
      updatedAt: timestamp("updated_at", { withTimezone: true })
        .defaultNow()
        .notNull(),
    },
    (t) => [
      index("class_sessions_start_idx")
        .using("btree", sql`lower(${t.during})`)
        .where(sql`${t.status} = 'scheduled'`),
      index("class_sessions_series_idx")
        .on(t.seriesId)
        .where(sql`${t.seriesId} IS NOT NULL`),
    ],
  );

  /** A client's seat or place in line. Status changes are checked by the database trigger. */
  const classEnrollments = schema.table(
    "class_enrollments",
    {
      id: uuid("id").primaryKey().defaultRandom(),
      sessionId: uuid("session_id")
        .notNull()
        .references(() => classSessions.id, { onDelete: "cascade" }),
      clientId: uuid("client_id")
        .notNull()
        .references(() => clients.id, { onDelete: "cascade" }),
      /** 'booked' | 'waitlisted' | 'attended' | 'no_show' | 'late_cancel' | 'cancelled' */
      status: text("status").notNull(),
      /** Set by the trigger for waitlisted rows; NULL otherwise. */
      waitlistPosition: integer("waitlist_position"),
      creditEntryId: uuid("credit_entry_id").references(
        (): AnyPgColumn => creditLedger.id,
        { onDelete: "set null" },
      ),
      promotedAt: timestamp("promoted_at", { withTimezone: true }),
      cancelledAt: timestamp("cancelled_at", { withTimezone: true }),
      checkedInAt: timestamp("checked_in_at", { withTimezone: true }),
      createdAt: timestamp("created_at", { withTimezone: true })
        .defaultNow()
        .notNull(),
      updatedAt: timestamp("updated_at", { withTimezone: true })
        .defaultNow()
        .notNull(),
    },
    (t) => [
      uniqueIndex("class_enrollments_active_unique")
        .on(t.sessionId, t.clientId)
        .where(sql`${t.status} IN ('booked','waitlisted')`),
      index("class_enrollments_session_status_idx").on(
        t.sessionId,
        t.status,
        t.waitlistPosition,
      ),
      index("class_enrollments_client_idx").on(t.clientId),
    ],
  );

  const appointmentServices = schema.table("appointment_services", {
    id: uuid("id").primaryKey().defaultRandom(),
    appointmentId: uuid("appointment_id")
      .notNull()
      .references(() => appointments.id, { onDelete: "cascade" }),
    serviceId: uuid("service_id")
      .notNull()
      .references(() => services.id),
    durationMinutes: integer("duration_minutes").notNull(),
    isOverride: integer("is_override").notNull().default(0),
    priceChargedCents: integer("price_charged_cents"),
    activeMinutes: integer("active_minutes"),
    processingMinutes: integer("processing_minutes"),
    notes: text("notes"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  });

  const workingHours = schema.table(
    "working_hours",
    {
      id: uuid("id").primaryKey().defaultRandom(),
      staffId: uuid("staff_id")
        .notNull()
        .references(() => staff.id, { onDelete: "cascade" }),
      dayOfWeek: integer("day_of_week").notNull(),
      locationId: uuid("location_id").references(() => locations.id),
      startTime: text("start_time").notNull(),
      endTime: text("end_time").notNull(),
      isEnabled: integer("is_enabled").notNull().default(1),
      createdAt: timestamp("created_at", { withTimezone: true })
        .defaultNow()
        .notNull(),
      updatedAt: timestamp("updated_at", { withTimezone: true })
        .defaultNow()
        .notNull(),
    },
    (table) => [
      index("working_hours_staff_day_idx").on(table.staffId, table.dayOfWeek),
    ],
  );

  /** Replaces a staff member's weekly hours on one date. Empty intervals = closed. */
  const availabilityOverrides = schema.table(
    "availability_overrides",
    {
      id: uuid("id").primaryKey().defaultRandom(),
      staffId: uuid("staff_id")
        .notNull()
        .references(() => staff.id, { onDelete: "cascade" }),
      date: date("date").notNull(),
      intervals: jsonb("intervals")
        .$type<{ start: string; end: string; locationId: string | null }[]>()
        .notNull()
        .default([]),
      reason: text("reason"),
      createdAt: timestamp("created_at", { withTimezone: true })
        .defaultNow()
        .notNull(),
      updatedAt: timestamp("updated_at", { withTimezone: true })
        .defaultNow()
        .notNull(),
    },
    (t) => [
      unique("availability_overrides_staff_date_unique").on(t.staffId, t.date),
    ],
  );

  const membershipPlans = schema.table("membership_plans", {
    id: uuid("id").primaryKey().defaultRandom(),
    name: text("name").notNull(),
    monthlyAmountCents: integer("monthly_amount_cents").notNull(),
    retailDiscountPercent: integer("retail_discount_percent")
      .notNull()
      .default(0),
    priorityBooking: integer("priority_booking").notNull().default(0),
    priorityBookingDays: integer("priority_booking_days").notNull().default(14),
    /** When 1, clients may choose any whole-dollar amount >= monthlyAmountCents. */
    allowCustomAmount: integer("allow_custom_amount").notNull().default(0),
    stripePriceId: text("stripe_price_id"),
    stripeProductId: text("stripe_product_id"),
    description: text("description"),
    isActive: integer("is_active").notNull().default(1),
    /** 'stored_value' | 'credits' | 'discount' */
    kind: text("kind").notNull().default("stored_value"),
    /** Credits granted each paid period (kind = 'credits'). */
    creditsPerPeriod: integer("credits_per_period"),
    /** Unused credits above this are expired at renewal. */
    rolloverMax: integer("rollover_max").notNull().default(0),
    /** Service ids credits can pay for. Empty = any service. */
    eligibleServiceIds: jsonb("eligible_service_ids")
      .$type<string[]>()
      .notNull()
      .default(sql`'[]'::jsonb`),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  });

  const clientMemberships = schema.table(
    "client_memberships",
    {
      id: uuid("id").primaryKey().defaultRandom(),
      clientId: uuid("client_id")
        .notNull()
        .references(() => clients.id, { onDelete: "cascade" }),
      planId: uuid("plan_id")
        .notNull()
        .references(() => membershipPlans.id),
      /** Effective monthly amount for this membership; NULL = fall back to plan. */
      monthlyAmountCents: integer("monthly_amount_cents"),
      /** The Stripe price actually subscribed (custom or plan default). */
      stripePriceId: text("stripe_price_id"),
      stripeSubscriptionId: text("stripe_subscription_id"),
      stripeCustomerId: text("stripe_customer_id"),
      status: text("status").notNull().default("active"),
      currentPeriodStart: timestamp("current_period_start", {
        withTimezone: true,
      }),
      currentPeriodEnd: timestamp("current_period_end", { withTimezone: true }),
      cancelledAt: timestamp("cancelled_at", { withTimezone: true }),
      createdAt: timestamp("created_at", { withTimezone: true })
        .defaultNow()
        .notNull(),
      updatedAt: timestamp("updated_at", { withTimezone: true })
        .defaultNow()
        .notNull(),
    },
    (table) => [
      index("client_memberships_stripe_sub_idx").on(table.stripeSubscriptionId),
    ],
  );

  /** A sellable credit pack. */
  const packages = schema.table("packages", {
    id: uuid("id").primaryKey().defaultRandom(),
    name: text("name").notNull(),
    description: text("description"),
    priceCents: integer("price_cents").notNull(),
    credits: integer("credits").notNull(),
    /** Days until a purchased pack expires. NULL = never. */
    validDays: integer("valid_days"),
    /** Service ids credits can pay for. Empty = any service. */
    eligibleServiceIds: jsonb("eligible_service_ids")
      .$type<string[]>()
      .notNull()
      .default(sql`'[]'::jsonb`),
    isActive: integer("is_active").notNull().default(1),
    sort: integer("sort").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  });

  /**
   * A client's owned credits. creditsRemaining/creditsTotal are a cache written
   * only by the credit_ledger insert trigger; never write them from TypeScript.
   */
  const clientPackages = schema.table(
    "client_packages",
    {
      id: uuid("id").primaryKey().defaultRandom(),
      clientId: uuid("client_id")
        .notNull()
        .references(() => clients.id, { onDelete: "cascade" }),
      packageId: uuid("package_id").references(() => packages.id, {
        onDelete: "set null",
      }),
      clientMembershipId: uuid("client_membership_id").references(
        () => clientMemberships.id,
        { onDelete: "set null" },
      ),
      name: text("name").notNull(),
      creditsTotal: integer("credits_total").notNull().default(0),
      creditsRemaining: integer("credits_remaining").notNull().default(0),
      eligibleServiceIds: jsonb("eligible_service_ids")
        .$type<string[]>()
        .notNull()
        .default(sql`'[]'::jsonb`),
      expiresAt: timestamp("expires_at", { withTimezone: true }),
      /** 'active' | 'expired' | 'cancelled' */
      status: text("status").notNull().default("active"),
      priceCents: integer("price_cents").notNull().default(0),
      stripePaymentIntentId: text("stripe_payment_intent_id"),
      createdAt: timestamp("created_at", { withTimezone: true })
        .defaultNow()
        .notNull(),
      updatedAt: timestamp("updated_at", { withTimezone: true })
        .defaultNow()
        .notNull(),
    },
    (t) => [
      uniqueIndex("client_packages_membership_unique")
        .on(t.clientMembershipId)
        .where(sql`${t.clientMembershipId} IS NOT NULL`),
      index("client_packages_client_idx").on(t.clientId, t.status),
    ],
  );

  /** Append-only credit history. Inserts drive client_packages via trigger. */
  const creditLedger = schema.table(
    "credit_ledger",
    {
      id: uuid("id").primaryKey().defaultRandom(),
      clientPackageId: uuid("client_package_id")
        .notNull()
        .references(() => clientPackages.id, { onDelete: "cascade" }),
      appointmentId: uuid("appointment_id").references(() => appointments.id, {
        onDelete: "set null",
      }),
      enrollmentId: uuid("enrollment_id").references(
        () => classEnrollments.id,
        { onDelete: "set null" },
      ),
      delta: integer("delta").notNull(),
      /** 'purchase' | 'grant' | 'redeem' | 'refund' | 'expire' | 'late_cancel' | 'adjust' */
      reason: text("reason").notNull(),
      /** Set by the trigger. */
      balanceAfter: integer("balance_after").notNull().default(0),
      referenceId: text("reference_id"),
      note: text("note"),
      createdBy: text("created_by"),
      createdAt: timestamp("created_at", { withTimezone: true })
        .defaultNow()
        .notNull(),
    },
    (t) => [
      uniqueIndex("credit_ledger_reference_unique")
        .on(t.clientPackageId, t.reason, t.referenceId)
        .where(sql`${t.referenceId} IS NOT NULL`),
      index("credit_ledger_package_idx").on(t.clientPackageId, t.createdAt),
    ],
  );

  const storedValueTransactions = schema.table(
    "stored_value_transactions",
    {
      id: uuid("id").primaryKey().defaultRandom(),
      clientId: uuid("client_id")
        .notNull()
        .references(() => clients.id, { onDelete: "cascade" }),
      type: text("type").notNull(),
      amountCents: integer("amount_cents").notNull(),
      runningBalanceCents: integer("running_balance_cents").notNull(),
      referenceId: text("reference_id"),
      counterpartyClientId: uuid("counterparty_client_id").references(
        () => clients.id,
        { onDelete: "set null" },
      ),
      note: text("note"),
      createdAt: timestamp("created_at", { withTimezone: true })
        .defaultNow()
        .notNull(),
      createdBy: text("created_by"),
    },
    (table) => [
      index("stored_value_transactions_client_created_idx").on(
        table.clientId,
        table.createdAt,
      ),
    ],
  );

  const storedValueBalances = schema.table("stored_value_balances", {
    clientId: uuid("client_id")
      .primaryKey()
      .references(() => clients.id, { onDelete: "cascade" }),
    balanceCents: integer("balance_cents").notNull().default(0),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  });

  const businessSettings = schema.table("business_settings", {
    id: uuid("id").primaryKey().defaultRandom(),
    timezone: text("timezone").notNull().default("America/New_York"),
    cancellationWindowHours: integer("cancellation_window_hours")
      .notNull()
      .default(24),
    cancellationFeePercent: integer("cancellation_fee_percent")
      .notNull()
      .default(50),
    noShowFeePercent: integer("no_show_fee_percent").notNull().default(100),
    requireCardOnFile: integer("require_card_on_file").notNull().default(1),
    confirmationEnabled: integer("confirmation_enabled").notNull().default(1),
    reminderEnabled: integer("reminder_enabled").notNull().default(1),
    reminderHoursBefore: integer("reminder_hours_before").notNull().default(24),
    /** Optional second email reminder window (hours before start); null = disabled */
    reminderHoursBefore2: integer("reminder_hours_before_2"),
    confirmationGreeting: text("confirmation_greeting"),
    confirmationBody: text("confirmation_body"),
    reminderGreeting: text("reminder_greeting"),
    reminderBody: text("reminder_body"),
    businessAddress: text("business_address"),
    /** Booking rules (Settings -> Booking Rules). Existing rows were set to same-day off by 0042. */
    minNoticeMinutes: integer("min_notice_minutes").notNull().default(120),
    maxAdvanceDays: integer("max_advance_days").notNull().default(28),
    slotIntervalMinutes: integer("slot_interval_minutes").notNull().default(15),
    sameDayBooking: integer("same_day_booking").notNull().default(1),
    /** On-site visits: minutes of the arrival window shown to clients (0 = exact time). */
    arrivalWindowMin: integer("arrival_window_min").notNull().default(120),
    /** Days an uploaded ID photo is kept (30, 90, 180, 365 or 730). */
    idRetentionDays: integer("id_retention_days").notNull().default(365),
    applePayEnabled: integer("apple_pay_enabled").notNull().default(1),
    googlePayEnabled: integer("google_pay_enabled").notNull().default(1),
    afterpayEnabled: integer("afterpay_enabled").notNull().default(1),
    cashappEnabled: integer("cashapp_enabled").notNull().default(1),
    smsRemindersEnabled: integer("sms_reminders_enabled")
      .notNull()
      .default(0),
    smsReminderHoursBefore: integer("sms_reminder_hours_before")
      .notNull()
      .default(24),
    /** Optional second SMS reminder window; null = disabled */
    smsReminderHoursBefore2: integer("sms_reminder_hours_before_2"),
    smsReminderBody: text("sms_reminder_body"),
    smsConfirmationEnabled: integer("sms_confirmation_enabled")
      .notNull()
      .default(0),
    smsConfirmationBody: text("sms_confirmation_body"),
    smsAftercareEnabled: integer("sms_aftercare_enabled").notNull().default(0),
    smsFormRequestsEnabled: integer("sms_form_requests_enabled")
      .notNull()
      .default(0),
    smsIntakeRequestsEnabled: integer("sms_intake_requests_enabled")
      .notNull()
      .default(0),
    /** Salon policies prose shown to clients to review and sign during intake */
    policyText: text("policy_text"),
    /** Who may self-book online: 'both' | 'existing_only' | 'new_only'. */
    onlineBookingAudience: text("online_booking_audience")
      .notNull()
      .default("both"),
    /** Global deposit rule (applies to services that don't override it). */
    depositEnabled: integer("deposit_enabled").notNull().default(0),
    depositDefaultType: text("deposit_default_type").notNull().default("percent"),
    depositDefaultAmount: integer("deposit_default_amount").notNull().default(0),
    /** When set, the global rule only applies to services at/above this duration (e.g. 240 = "4+ hours"). */
    depositDurationThresholdMinutes: integer(
      "deposit_duration_threshold_minutes",
    ),
    /** Beauty Bank credits expire this many months after they're earned; null = never expire. */
    storedValueExpiryMonths: integer("stored_value_expiry_months"),
    /** Storefront sales tax in basis points (725 = 7.25%); 0 = no tax collected. */
    retailTaxBps: integer("retail_tax_bps").notNull().default(0),
    /** Flat shipping rate for storefront orders (cents); null = pickup only. */
    retailShipFlatCents: integer("retail_ship_flat_cents"),
    /** Salon-wide target service revenue for a calendar month (cents); null = no goal set. */
    monthlyRevenueGoalCents: integer("monthly_revenue_goal_cents"),
    /** Walk-in line: 1 = accepting new people. */
    queueOpen: integer("queue_open").notNull().default(0),
    /** Walk-in line: most people allowed to wait at once. */
    queueMaxWaiting: integer("queue_max_waiting").notNull().default(30),
    /** Walk-in line: text the person their status link when they join. */
    queueTextOnJoin: integer("queue_text_on_join").notNull().default(0),
    /** SHA-256 of the kiosk link token; null = no kiosk link. */
    queueKioskTokenHash: text("queue_kiosk_token_hash"),
    /** Minutes a waitlist offer stays held for the person who was texted. */
    waitlistHoldMinutes: integer("waitlist_hold_minutes").notNull().default(15),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  });

  /** Custom, salon-defined service categories (defaults seeded on provision). */
  const serviceCategories = schema.table(
    "service_categories",
    {
      id: uuid("id").primaryKey().defaultRandom(),
      /** Stable key stored on services.category (e.g. "color", "maintenance"). */
      slug: text("slug").notNull(),
      name: text("name").notNull(),
      sortOrder: integer("sort_order").notNull().default(0),
      /** 1 = built-in default category (cannot be deleted, only deactivated). */
      isDefault: integer("is_default").notNull().default(0),
      isActive: integer("is_active").notNull().default(1),
      createdAt: timestamp("created_at", { withTimezone: true })
        .defaultNow()
        .notNull(),
      updatedAt: timestamp("updated_at", { withTimezone: true })
        .defaultNow()
        .notNull(),
    },
    (table) => [uniqueIndex("service_categories_slug_unique").on(table.slug)],
  );

  /** Links optional add-on services to a primary service (offered together at booking). */
  const serviceAddons = schema.table(
    "service_addons",
    {
      id: uuid("id").primaryKey().defaultRandom(),
      primaryServiceId: uuid("primary_service_id")
        .notNull()
        .references(() => services.id, { onDelete: "cascade" }),
      addonServiceId: uuid("addon_service_id")
        .notNull()
        .references(() => services.id, { onDelete: "cascade" }),
      sortOrder: integer("sort_order").notNull().default(0),
      createdAt: timestamp("created_at", { withTimezone: true })
        .defaultNow()
        .notNull(),
    },
    (table) => [
      unique("service_addon_unique").on(
        table.primaryServiceId,
        table.addonServiceId,
      ),
      index("service_addons_primary_idx").on(table.primaryServiceId),
    ],
  );

  /**
   * A gift card is a liability. The code is stored only as a SHA-256 hash
   * plus last4. `balance_cents` must equal the sum of its ledger rows.
   */
  const giftCards = schema.table(
    "gift_cards",
    {
      id: uuid("id").primaryKey().defaultRandom(),
      codeHash: text("code_hash").notNull(),
      last4: text("last4").notNull(),
      initialCents: integer("initial_cents").notNull(),
      balanceCents: integer("balance_cents").notNull(),
      /** 'active' | 'void' */
      status: text("status").notNull().default("active"),
      /** 'online' | 'in_person' | 'comp' | 'replacement' */
      source: text("source").notNull(),
      purchaserClientId: uuid("purchaser_client_id").references(() => clients.id, {
        onDelete: "set null",
      }),
      purchaserName: text("purchaser_name"),
      purchaserEmail: text("purchaser_email"),
      recipientName: text("recipient_name"),
      recipientEmail: text("recipient_email"),
      message: text("message"),
      stripeCheckoutSessionId: text("stripe_checkout_session_id"),
      stripePaymentIntentId: text("stripe_payment_intent_id"),
      platformFeeCents: integer("platform_fee_cents").notNull().default(0),
      replacedById: uuid("replaced_by_id").references((): AnyPgColumn => giftCards.id, {
        onDelete: "set null",
      }),
      deliveredAt: timestamp("delivered_at", { withTimezone: true }),
      expiresAt: timestamp("expires_at", { withTimezone: true }),
      createdBy: text("created_by"),
      createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
      updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
    },
    (t) => [
      uniqueIndex("gift_cards_code_hash_unique").on(t.codeHash),
      uniqueIndex("gift_cards_checkout_session_unique")
        .on(t.stripeCheckoutSessionId)
        .where(sql`${t.stripeCheckoutSessionId} IS NOT NULL`),
      index("gift_cards_created_idx").on(t.createdAt),
    ],
  );

  const charges = schema.table(
    "charges",
    {
      id: uuid("id").primaryKey().defaultRandom(),
      /** NULL for pack-sale charges. */
      appointmentId: uuid("appointment_id").references(() => appointments.id),
      /** Set when the charge sold a credit pack. */
      clientPackageId: uuid("client_package_id").references(
        () => clientPackages.id,
        { onDelete: "set null" },
      ),
      clientId: uuid("client_id")
        .notNull()
        .references(() => clients.id),
      stripePaymentIntentId: text("stripe_payment_intent_id"),
      amountCents: integer("amount_cents").notNull(),
      reason: text("reason").notNull(),
      status: text("status").notNull().default("pending"),
      stripeRefundId: text("stripe_refund_id"),
      failureReason: text("failure_reason"),
      platformFeeCents: integer("platform_fee_cents"),
      connectAccountId: text("connect_account_id"),
      /** Portion of amount paid from Beauty Bank stored value */
      storedValueCents: integer("stored_value_cents"),
      /** Gratuity included in amount_cents (service + tip) */
      tipCents: integer("tip_cents"),
      /** Portion of a project deposit applied to this service payment. */
      depositAppliedCents: integer("deposit_applied_cents").notNull().default(0),
      /** Gift card redeemed against this charge. The sale itself is not a charge. */
      giftCardId: uuid("gift_card_id").references(() => giftCards.id, { onDelete: "set null" }),
      giftCardCents: integer("gift_card_cents"),
      /** Set on the single charge that pays a whole group booking. */
      bookingGroupId: uuid("booking_group_id").references(() => bookingGroups.id, {
        onDelete: "set null",
      }),
      createdAt: timestamp("created_at", { withTimezone: true })
        .defaultNow()
        .notNull(),
      updatedAt: timestamp("updated_at", { withTimezone: true })
        .defaultNow()
        .notNull(),
    },
    (table) => [
      index("charges_appointment_id_idx").on(table.appointmentId),
      index("charges_client_id_idx").on(table.clientId),
      index("charges_status_idx").on(table.status),
    ],
  );

  const giftCardTransactions = schema.table(
    "gift_card_transactions",
    {
      id: uuid("id").primaryKey().defaultRandom(),
      giftCardId: uuid("gift_card_id")
        .notNull()
        .references(() => giftCards.id, { onDelete: "restrict" }),
      chargeId: uuid("charge_id").references(() => charges.id, { onDelete: "set null" }),
      appointmentId: uuid("appointment_id").references(() => appointments.id, {
        onDelete: "set null",
      }),
      deltaCents: integer("delta_cents").notNull(),
      balanceAfterCents: integer("balance_after_cents").notNull(),
      /** 'issue' | 'redeem' | 'reversal' | 'adjustment' | 'void' */
      reason: text("reason").notNull(),
      note: text("note"),
      createdBy: text("created_by"),
      createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    },
    (t) => [
      index("gift_card_transactions_card_idx").on(t.giftCardId, t.createdAt),
      index("gift_card_transactions_charge_idx")
        .on(t.chargeId)
        .where(sql`${t.chargeId} IS NOT NULL`),
    ],
  );

  const expenses = schema.table(
    "expenses",
    {
      id: uuid("id").primaryKey().defaultRandom(),
      expenseDate: date("expense_date").notNull(),
      vendorName: text("vendor_name").notNull(),
      category: text("category").notNull(),
      amountCents: integer("amount_cents").notNull(),
      createdAt: timestamp("created_at", { withTimezone: true })
        .defaultNow()
        .notNull(),
      updatedAt: timestamp("updated_at", { withTimezone: true })
        .defaultNow()
        .notNull(),
    },
    (table) => [
      index("expenses_expense_date_idx").on(table.expenseDate),
      index("expenses_category_idx").on(table.category),
    ],
  );

  /** Per-tenant expense categories; expenses.category stores the slug (no FK). */
  const expenseCategories = schema.table(
    "expense_categories",
    {
      id: uuid("id").primaryKey().defaultRandom(),
      slug: text("slug").notNull(),
      name: text("name").notNull(),
      sortOrder: integer("sort_order").notNull().default(0),
      /** 1 = seeded from the industry pack (or matches a pack slug). */
      isDefault: integer("is_default").notNull().default(0),
      isActive: integer("is_active").notNull().default(1),
      createdAt: timestamp("created_at", { withTimezone: true })
        .defaultNow()
        .notNull(),
      updatedAt: timestamp("updated_at", { withTimezone: true })
        .defaultNow()
        .notNull(),
    },
    (table) => [uniqueIndex("expense_categories_slug_unique").on(table.slug)],
  );

  const bookingVerifications = schema.table("booking_verifications", {
    id: uuid("id").primaryKey().defaultRandom(),
    identifier: text("identifier").notNull(),
    type: text("type").notNull(),
    code: text("code").notNull(),
    attempts: integer("attempts").notNull().default(0),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  });

  const calendarConnections = schema.table(
    "calendar_connections",
    {
      id: uuid("id").primaryKey().defaultRandom(),
      staffId: uuid("staff_id")
        .notNull()
        .references(() => staff.id),
      platform: text("platform").notNull(), // 'google_calendar' (legacy: microsoft_calendar)
      accessToken: text("access_token").notNull(),
      refreshToken: text("refresh_token").notNull(),
      tokenExpiresAt: timestamp("token_expires_at", {
        withTimezone: true,
      }).notNull(),
      platformUserId: text("platform_user_id"),
      platformEmail: text("platform_email"),
      calendarId: text("calendar_id"), // Selected calendar ID for sync/push
      status: text("status").notNull().default("active"),
      errorMessage: text("error_message"),
      /** Consecutive token refresh failures before escalating to status error */
      errorCount: integer("error_count").notNull().default(0),
      lastSyncedAt: timestamp("last_synced_at", { withTimezone: true }),
      createdAt: timestamp("created_at", { withTimezone: true })
        .defaultNow()
        .notNull(),
      updatedAt: timestamp("updated_at", { withTimezone: true })
        .defaultNow()
        .notNull(),
    },
    (table) => [
      index("calendar_connections_staff_id_idx").on(table.staffId),
      uniqueIndex("calendar_connections_staff_platform_idx").on(
        table.staffId,
        table.platform,
      ),
    ],
  );

  const externalEvents = schema.table(
    "external_events",
    {
      id: uuid("id").primaryKey().defaultRandom(),
      connectionId: uuid("connection_id")
        .notNull()
        .references(() => calendarConnections.id, { onDelete: "cascade" }),
      staffId: uuid("staff_id").notNull(),
      calendarId: text("calendar_id").notNull(),
      eventUid: text("event_uid"),
      startTime: timestamp("start_time", { withTimezone: true }).notNull(),
      endTime: timestamp("end_time", { withTimezone: true }).notNull(),
      isAllDay: integer("is_all_day").notNull().default(0),
      freeBusyStatus: text("free_busy_status").notNull().default("busy"),
      lastSyncedAt: timestamp("last_synced_at", { withTimezone: true })
        .defaultNow()
        .notNull(),
      createdAt: timestamp("created_at", { withTimezone: true })
        .defaultNow()
        .notNull(),
      updatedAt: timestamp("updated_at", { withTimezone: true })
        .defaultNow()
        .notNull(),
    },
    (table) => [
      index("external_events_staff_time_idx").on(
        table.staffId,
        table.startTime,
        table.endTime,
      ),
      index("external_events_connection_idx").on(table.connectionId),
    ],
  );

  const formTemplates = schema.table("form_templates", {
    id: uuid("id").primaryKey().defaultRandom(),
    name: text("name").notNull(),
    description: text("description"),
    fields: jsonb("fields").notNull().default([]),
    /** intake | waiver | consent | health_history | par_q */
    kind: text("kind").notNull().default("intake"),
    /** Consent forms: minimum client age (13-99), null = no age gate. */
    minAge: integer("min_age"),
    /** 1 when the client must upload a photo ID with this form. */
    requiresId: integer("requires_id").notNull().default(0),
    isActive: integer("is_active").notNull().default(1),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  });

  const serviceFormAssignments = schema.table(
    "service_form_assignments",
    {
      id: uuid("id").primaryKey().defaultRandom(),
      serviceId: uuid("service_id")
        .notNull()
        .references(() => services.id, { onDelete: "cascade" }),
      formTemplateId: uuid("form_template_id")
        .notNull()
        .references(() => formTemplates.id, { onDelete: "cascade" }),
      createdAt: timestamp("created_at", { withTimezone: true })
        .defaultNow()
        .notNull(),
    },
    (table) => [
      unique("service_form_assignment_unique").on(
        table.serviceId,
        table.formTemplateId,
      ),
    ],
  );

  const formResponses = schema.table("form_responses", {
    id: uuid("id").primaryKey().defaultRandom(),
    formTemplateId: uuid("form_template_id")
      .notNull()
      .references(() => formTemplates.id),
    appointmentId: uuid("appointment_id")
      .notNull()
      .references(() => appointments.id),
    clientId: uuid("client_id")
      .notNull()
      .references(() => clients.id),
    responses: jsonb("responses").notNull().default({}),
    submittedAt: timestamp("submitted_at", { withTimezone: true }),
    dob: date("dob"),
    idAttachmentId: uuid("id_attachment_id").references(() => attachments.id, {
      onDelete: "set null",
    }),
    /** Staff who checked the ID; set together with verified_at. */
    verifiedBy: text("verified_by"),
    verifiedAt: timestamp("verified_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  });

  const smsConsent = schema.table(
    "sms_consent",
    {
      id: uuid("id").primaryKey().defaultRandom(),
      clientId: uuid("client_id")
        .notNull()
        .references(() => clients.id, { onDelete: "cascade" }),
      phone: text("phone").notNull(),
      consentedAt: timestamp("consented_at", { withTimezone: true }),
      optedOutAt: timestamp("opted_out_at", { withTimezone: true }),
      consentMethod: text("consent_method").notNull(),
      consentSource: text("consent_source"),
      createdAt: timestamp("created_at", { withTimezone: true })
        .defaultNow()
        .notNull(),
    },
    (table) => [
      index("sms_consent_phone_idx").on(table.phone),
      index("sms_consent_client_id_idx").on(table.clientId),
    ],
  );

  const smsMessages = schema.table(
    "sms_messages",
    {
      id: uuid("id").primaryKey().defaultRandom(),
      appointmentId: uuid("appointment_id").references(() => appointments.id),
      clientId: uuid("client_id").references(() => clients.id),
      toPhone: text("to_phone").notNull(),
      body: text("body").notNull(),
      messageSid: text("message_sid"),
      status: text("status").notNull().default("queued"),
      errorCode: text("error_code"),
      errorMessage: text("error_message"),
      messageType: text("message_type").notNull().default("reminder"),
      createdAt: timestamp("created_at", { withTimezone: true })
        .defaultNow()
        .notNull(),
      updatedAt: timestamp("updated_at", { withTimezone: true })
        .defaultNow()
        .notNull(),
    },
    (table) => [
      uniqueIndex("sms_messages_sid_idx")
        .on(table.messageSid)
        .where(sql`${table.messageSid} IS NOT NULL`),
    ],
  );

  const brandingSettings = schema.table("branding_settings", {
    id: uuid("id").primaryKey().defaultRandom(),
    primaryColor: text("primary_color").default("#6b8f3c"),
    accentColor: text("accent_color").default("#d4c9a8"),
    logoUrl: text("logo_url"),
    fontPreference: text("font_preference").default("system"),
    brandColor: text("brand_color").notNull().default("#B3122E"),
    fontPairing: text("font_pairing").notNull().default("score"),
    cornerStyle: text("corner_style").notNull().default("soft"),
    density: text("density").notNull().default("comfortable"),
    colorMode: text("color_mode").notNull().default("light"),
    showPoweredBy: integer("show_powered_by").notNull().default(1),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  });

  const aftercareTemplates = schema.table("aftercare_templates", {
    id: uuid("id").primaryKey().defaultRandom(),
    name: text("name").notNull(),
    content: text("content").notNull(),
    productRecommendations: text("product_recommendations"),
    isActive: integer("is_active").notNull().default(1),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  });

  const serviceAftercareAssignments = schema.table(
    "service_aftercare_assignments",
    {
      id: uuid("id").primaryKey().defaultRandom(),
      serviceId: uuid("service_id")
        .notNull()
        .references(() => services.id, { onDelete: "cascade" }),
      aftercareTemplateId: uuid("aftercare_template_id")
        .notNull()
        .references(() => aftercareTemplates.id, { onDelete: "cascade" }),
      createdAt: timestamp("created_at", { withTimezone: true })
        .defaultNow()
        .notNull(),
    },
    (table) => [
      unique("service_aftercare_assignment_unique").on(
        table.serviceId,
        table.aftercareTemplateId,
      ),
    ],
  );

  const policySignatures = schema.table(
    "policy_signatures",
    {
      id: uuid("id").primaryKey().defaultRandom(),
      clientId: uuid("client_id")
        .notNull()
        .references(() => clients.id),
      appointmentId: uuid("appointment_id").references(() => appointments.id),
      /** Snapshot of salonPolicies.policyText at send-time (so future edits don't change historical signatures) */
      policyText: text("policy_text").notNull(),
      signedName: text("signed_name"),
      signedAt: timestamp("signed_at", { withTimezone: true }),
      paymentMethodId: text("payment_method_id"),
      ipAddress: text("ip_address"),
      createdAt: timestamp("created_at", { withTimezone: true })
        .defaultNow()
        .notNull(),
      updatedAt: timestamp("updated_at", { withTimezone: true })
        .defaultNow()
        .notNull(),
    },
    (table) => [
      index("policy_signatures_client_id_idx").on(table.clientId),
      index("policy_signatures_appointment_id_idx").on(table.appointmentId),
    ],
  );

  const taskCatalog = schema.table("task_catalog", {
    id: uuid("id").primaryKey().defaultRandom(),
    name: text("name").notNull(),
    defaultDurationMinutes: integer("default_duration_minutes").notNull(),
    isActive: integer("is_active").notNull().default(1),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  });

  const assistantTasks = schema.table("assistant_tasks", {
    id: uuid("id").primaryKey().defaultRandom(),
    /** Nullable: standalone tasks (e.g. "morning prep") have no appointment. */
    appointmentId: uuid("appointment_id").references(
      () => appointments.id,
      { onDelete: "cascade" },
    ),
    assignedTo: uuid("assigned_to")
      .notNull()
      .references(() => staff.id),
    taskTypeId: uuid("task_type_id").references(() => taskCatalog.id),
    taskName: text("task_name").notNull(),
    during: tstzrange("during").notNull(),
    status: text("status").notNull().default("pending"), // "pending" | "in-progress" | "completed" | "cancelled"
    notes: text("notes"),
    /** 1 = created from service assistant-workflow rules; 0 = manual */
    isAuto: integer("is_auto").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  });

  /**
   * In-app alerts surfaced to the salon owner in the dashboard (bell menu).
   * Generic by design (`type` discriminates the source) but currently produced
   * by the Capacity Coach evaluator. `dedupeKey` makes re-evaluation idempotent
   * (upsert), and `data` carries the structured payload the UI renders.
   */
  const alerts = schema.table(
    "alerts",
    {
      id: uuid("id").primaryKey().defaultRandom(),
      type: text("type").notNull(), // e.g. "capacity_coach"
      severity: text("severity").notNull().default("info"), // "info" | "warning"
      title: text("title").notNull(),
      body: text("body").notNull(),
      data: jsonb("data"),
      dedupeKey: text("dedupe_key"),
      readAt: timestamp("read_at", { withTimezone: true }),
      dismissedAt: timestamp("dismissed_at", { withTimezone: true }),
      createdAt: timestamp("created_at", { withTimezone: true })
        .defaultNow()
        .notNull(),
      updatedAt: timestamp("updated_at", { withTimezone: true })
        .defaultNow()
        .notNull(),
    },
    (table) => [
      // Nullable → Postgres allows many NULL keys; only keyed alerts upsert.
      uniqueIndex("alerts_dedupe_key_unique").on(table.dedupeKey),
      index("alerts_active_idx").on(table.dismissedAt, table.createdAt),
    ],
  );

  /**
   * Retail products the salon sells (storefront). Managed by the stylist in the
   * admin; `tags` drive client-facing recommendations, and
   * `is_active` controls storefront visibility.
   */
  const products = schema.table(
    "products",
    {
      id: uuid("id").primaryKey().defaultRandom(),
      name: text("name").notNull(),
      brand: text("brand"),
      description: text("description"),
      size: text("size"), // e.g. "118 ml / 4 fl oz"
      priceCents: integer("price_cents").notNull(),
      costCents: integer("cost_cents"), // wholesale cost, for margin
      photoUrl: text("photo_url"),
      tags: jsonb("tags").$type<string[]>().notNull().default([]),
      isActive: integer("is_active").notNull().default(1),
      sortOrder: integer("sort_order").notNull().default(0),
      createdAt: timestamp("created_at", { withTimezone: true })
        .defaultNow()
        .notNull(),
      updatedAt: timestamp("updated_at", { withTimezone: true })
        .defaultNow()
        .notNull(),
    },
    (table) => [
      index("products_active_sort_idx").on(table.isActive, table.sortOrder),
    ],
  );

  /**
   * Storefront orders. Written by the Stripe webhook when a storefront Checkout
   * Session completes (unique session id makes that idempotent). `items` is a
   * snapshot of what was bought — products may later change or be deleted.
   */
  const orders = schema.table(
    "orders",
    {
      id: uuid("id").primaryKey().defaultRandom(),
      stripeCheckoutSessionId: text("stripe_checkout_session_id").notNull(),
      stripePaymentIntentId: text("stripe_payment_intent_id"),
      /** Booking client when the buyer was signed in; null for guest checkout. */
      clientId: uuid("client_id"),
      customerName: text("customer_name"),
      customerEmail: text("customer_email"),
      items: jsonb("items")
        .$type<
          Array<{
            productId: string | null;
            name: string;
            quantity: number;
            unitCents: number;
          }>
        >()
        .default([])
        .notNull(),
      subtotalCents: integer("subtotal_cents").notNull(),
      taxCents: integer("tax_cents").notNull().default(0),
      shippingCents: integer("shipping_cents").notNull().default(0),
      totalCents: integer("total_cents").notNull(),
      platformFeeCents: integer("platform_fee_cents").notNull().default(0),
      fulfillment: text("fulfillment").notNull().default("pickup"), // "pickup" | "ship"
      shippingAddress: jsonb("shipping_address"),
      status: text("status").notNull().default("paid"), // "paid" | "fulfilled" | "refunded"
      createdAt: timestamp("created_at", { withTimezone: true })
        .defaultNow()
        .notNull(),
      updatedAt: timestamp("updated_at", { withTimezone: true })
        .defaultNow()
        .notNull(),
    },
    (table) => [
      uniqueIndex("orders_checkout_session_unique").on(
        table.stripeCheckoutSessionId,
      ),
      index("orders_status_created_idx").on(table.status, table.createdAt),
    ],
  );

  const customFieldDefinitions = schema.table(
    "custom_field_definitions",
    {
      id: uuid("id").primaryKey().defaultRandom(),
      entity: text("entity").notNull(),
      key: text("key").notNull(),
      label: text("label").notNull(),
      type: text("type").notNull(),
      options: jsonb("options").$type<{ value: string; label: string }[]>().notNull().default([]),
      sort: integer("sort").notNull().default(0),
      isActive: integer("is_active").notNull().default(1),
      isDefault: integer("is_default").notNull().default(0),
      showOnCard: integer("show_on_card").notNull().default(1),
      clientEditable: integer("client_editable").notNull().default(0),
      matchProductTags: integer("match_product_tags").notNull().default(0),
      createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
      updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
    },
    (table) => [
      unique("custom_field_definitions_entity_key_unique").on(table.entity, table.key),
    ],
  );

  return {
    queueEntries,
    waitlistOpenings,
    slotWaitlist,
    services,
    serviceCategories,
    serviceAddons,
    membershipPlans,
    clientMemberships,
    packages,
    clientPackages,
    creditLedger,
    storedValueTransactions,
    storedValueBalances,
    clients,
    customFieldDefinitions,
    clientServiceOverrides,
    staff,
    staffServices,
    locations,
    bookingGroups,
    recurrenceRules,
    clientAddresses,
    appointments,
    bookingRequests,
    serviceAreas,
    staffTravelSettings,
    attachments,
    checklistTemplates,
    appointmentChecklistItems,
    projects,
    bookingWindows,
    quotes,
    quoteLineItems,
    resources,
    serviceResourceRequirements,
    appointmentResources,
    classSessions,
    classEnrollments,
    deviceTokens,
    timeBlocks,
    appointmentServices,
    workingHours,
    availabilityOverrides,
    businessSettings,
    giftCards,
    charges,
    giftCardTransactions,
    expenses,
    expenseCategories,
    bookingVerifications,
    calendarConnections,
    externalEvents,
    formTemplates,
    serviceFormAssignments,
    formResponses,
    aftercareTemplates,
    serviceAftercareAssignments,
    smsConsent,
    smsMessages,
    brandingSettings,
    taskCatalog,
    assistantTasks,
    policySignatures,
    alerts,
    products,
    orders,
  };
}

export type TenantTables = ReturnType<typeof createTenantTables>;
