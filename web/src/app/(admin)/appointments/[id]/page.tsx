import { notFound } from "next/navigation";
import { z } from "zod";
import { listCustomFieldDefinitions } from "@/actions/custom-fields";
import { getAppointmentChecklist } from "@/actions/checklists";
import { listAppointmentPhotos } from "@/actions/appointment-photos";
import { requireRole } from "@/lib/auth/rbac";
import { eq } from "drizzle-orm";
import { withTenantDb } from "@/lib/db/tenant";
import { getServicesForAppointment } from "@/lib/queries/appointment-services";
import { getT } from "@/lib/terms/server";
import { hasModule } from "@/lib/tenant/modules";
import { AppointmentWorkClient } from "./appointment-work-client";

const STATUS_KEYS = {
  confirmed: "page.status.confirmed",
  completed: "page.status.completed",
  cancelled: "page.status.cancelled",
  no_show: "page.status.no_show",
  pending: "page.status.pending",
} as const;

function asDate(value: Date | string): Date {
  return value instanceof Date ? value : new Date(value);
}

function formatRange(start: Date, end: Date, timeZone: string): string {
  const day = new Intl.DateTimeFormat("en-US", {
    timeZone,
    weekday: "short",
    month: "short",
    day: "numeric",
  }).format(start);
  const clock = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour: "numeric",
    minute: "2-digit",
  });
  return `${day}, ${clock.format(start)} to ${clock.format(end)}`;
}

export default async function AppointmentWorkPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const session = await requireRole("owner", "admin", "provider", "assistant");
  if (!session.tenantSlug || !z.string().uuid().safeParse(id).success) notFound();
  const slug = session.tenantSlug;

  const appointment = await withTenantDb(slug, async (db, tables) => {
    const [row] = await db
      .select({
        id: tables.appointments.id,
        staffId: tables.appointments.staffId,
        during: tables.appointments.during,
        status: tables.appointments.status,
        attributes: tables.appointments.attributes,
        clientName: tables.clients.name,
        staffName: tables.staff.displayName,
      })
      .from(tables.appointments)
      .innerJoin(tables.clients, eq(tables.appointments.clientId, tables.clients.id))
      .innerJoin(tables.staff, eq(tables.appointments.staffId, tables.staff.id))
      .where(eq(tables.appointments.id, id))
      .limit(1);
    if (!row) return null;
    const [settings, services] = await Promise.all([
      db.select({ timezone: tables.businessSettings.timezone }).from(tables.businessSettings).limit(1),
      getServicesForAppointment(db, {
        appointmentServices: tables.appointmentServices,
        services: tables.services,
      }, row.id),
    ]);
    return {
      id: row.id,
      clientName: row.clientName,
      staffName: row.staffName,
      status: row.status,
      start: row.during.start,
      end: row.during.end,
      timeZone: settings[0]?.timezone || "America/New_York",
      serviceNames: services.map((service) => service.serviceName).join(", "),
      attributes: row.attributes ?? {},
    };
  });
  if (!appointment) notFound();

  const photosOn = await hasModule(slug, "attachments");
  const t = await getT("appointmentWork", slug);
  const [checklist, photos, fieldDefinitions] = await Promise.all([
    photosOn ? getAppointmentChecklist(id) : Promise.resolve([]),
    photosOn ? listAppointmentPhotos(id) : Promise.resolve([]),
    listCustomFieldDefinitions("appointment"),
  ]);
  const statusKey = STATUS_KEYS[appointment.status as keyof typeof STATUS_KEYS];

  return (
    <AppointmentWorkClient
      appointmentId={appointment.id}
      clientName={appointment.clientName}
      whenLabel={formatRange(asDate(appointment.start), asDate(appointment.end), appointment.timeZone)}
      serviceNames={appointment.serviceNames}
      staffName={appointment.staffName}
      statusLabel={statusKey ? t(statusKey) : appointment.status}
      timeZone={appointment.timeZone}
      photosOn={photosOn}
      checklist={checklist}
      photos={photos}
      fieldDefinitions={fieldDefinitions}
      attributes={appointment.attributes}
    />
  );
}
