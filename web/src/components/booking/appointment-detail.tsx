"use client";

import { useEffect, useState, type ReactNode } from "react";
import Link from "next/link";
import { format } from "date-fns";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { AppointmentFieldsSlot } from "@/components/custom-fields/custom-fields-card";
import { DurationBadge } from "./duration-badge";
import { RescheduleDialog } from "./reschedule-dialog";
import { CancelDialog } from "./cancel-dialog";
import { EditServicesDialog } from "./edit-services-dialog";
import { CheckoutDialog } from "@/components/checkout/checkout-dialog";
import { OnSiteDetails } from "./on-site-details";
import type { AppointmentData } from "@/components/schedule/appointment-block";
import {
  getChargesForAppointment,
  chargeNoShowFee,
  waiveCharge,
  refundCharge,
} from "@/actions/charges";
import { checkInAppointment, deleteBooking, sendClientText, stopRecurrence } from "@/actions/appointments";
import { prepareManualSms, toPlainSms } from "@/lib/sms/plain-text";
import { visitWord } from "@/lib/schedule/visit-status";
import { getLateCancelCreditOption, takeLateCancelCredit } from "@/actions/credit-redemption";
import { useT } from "@/lib/terms/client";
import { sendCheckoutLink } from "@/actions/checkout";
import { sendIntakeRequest } from "@/actions/policies";
import { rescheduleBooking } from "@/actions/appointments";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { BOOKING_TIME_OPTIONS } from "@/lib/booking/time-options";
import {
  Clock,
  User,
  Scissors,
  Calendar,
  CreditCard,
  AlertTriangle,
  CheckCircle,
  Loader2,
  Send,
  MapPin,
  Pencil,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";

interface ChargeRecord {
  id: string;
  amountCents: number;
  reason: string;
  status: string;
  failureReason: string | null;
  createdAt: Date;
}

interface AppointmentDetailProps {
  appointment: AppointmentData | null;
  onClose: () => void;
  onMutationComplete: () => void;
  staffName?: string;
  /** Dock is the fixed panel on wide screens. Sheet covers the phone. */
  layout?: "dock" | "sheet";
}

function statusBadgeVariant(
  status: string,
): "default" | "secondary" | "destructive" | "outline" {
  switch (status) {
    case "completed":
      return "default";
    case "pending":
      return "secondary";
    case "failed":
      return "destructive";
    case "refunded":
    case "waived":
      return "outline";
    default:
      return "secondary";
  }
}

function reasonLabel(reason: string): string {
  switch (reason) {
    case "no_show":
      return "No-show";
    case "late_cancellation":
      return "Late cancel";
    case "service_payment":
      return "Service payment";
    default:
      return reason;
  }
}

export function AppointmentDetail({
  appointment,
  onClose,
  onMutationComplete,
  staffName,
  layout = "sheet",
}: AppointmentDetailProps) {
  const [rescheduleOpen, setRescheduleOpen] = useState(false);
  const [cancelOpen, setCancelOpen] = useState(false);
  const [editServicesOpen, setEditServicesOpen] = useState(false);
  const [checkoutOpen, setCheckoutOpen] = useState(false);
  const [checkedInOverride, setCheckedInOverride] = useState<string | null>(null);
  const [checkingIn, setCheckingIn] = useState(false);
  const [textOpen, setTextOpen] = useState(false);
  const [textBody, setTextBody] = useState("");
  const [sendingText, setSendingText] = useState(false);
  const [charges, setCharges] = useState<ChargeRecord[]>([]);
  const [noShowLoading, setNoShowLoading] = useState(false);
  const [sendingLink, setSendingLink] = useState(false);
  const [sendingIntake, setSendingIntake] = useState(false);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [editDate, setEditDate] = useState("");
  const [editTime, setEditTime] = useState("");
  const [savingDateTime, setSavingDateTime] = useState(false);
  const [deleteLoading, setDeleteLoading] = useState(false);
  const [stopOpen, setStopOpen] = useState(false);
  const [stopLoading, setStopLoading] = useState(false);
  const t = useT("schedule");
  const tp = useT("projects");
  const tpk = useT("packages");
  const tw = useT("appointmentWork");
  // "Take a credit for this late cancel": only for a cancelled or no-show visit the client has a pack for.
  const [lateCreditEligible, setLateCreditEligible] = useState(false);
  const [lateCreditLoading, setLateCreditLoading] = useState(false);

  useEffect(() => {
    setCheckedInOverride(null);
    setTextOpen(false);
    setTextBody("");
  }, [appointment?.id]);

  useEffect(() => {
    if (appointment) {
      getChargesForAppointment(appointment.id).then(setCharges);
    } else {
      setCharges([]);
    }
  }, [appointment]);

  const appointmentId = appointment?.id;
  const appointmentStatus = appointment?.status;
  useEffect(() => {
    setLateCreditEligible(false);
    if (!appointmentId || (appointmentStatus !== "cancelled" && appointmentStatus !== "no_show")) return;
    let cancelled = false;
    getLateCancelCreditOption(appointmentId)
      .then((ok) => {
        if (!cancelled) setLateCreditEligible(ok);
      })
      .catch(() => {
        if (!cancelled) setLateCreditEligible(false);
      });
    return () => {
      cancelled = true;
    };
  }, [appointmentId, appointmentStatus]);

  useEffect(() => {
    if (!appointment) return;
    setEditDate(format(appointment.start, "yyyy-MM-dd"));
    const h = appointment.start.getHours().toString().padStart(2, "0");
    const m = appointment.start.getMinutes().toString().padStart(2, "0");
    setEditTime(`${h}:${m}`);
  }, [appointment]);

  if (!appointment) return null;

  const shownCheckIn = checkedInOverride ?? appointment.checkedInAt ?? null;
  const visitClosed =
    appointment.status === "cancelled" ||
    appointment.status === "no_show" ||
    appointment.status === "completed";
  const preparedText = prepareManualSms(textBody);

  const durationMinutes =
    (appointment.end.getTime() - appointment.start.getTime()) / 60_000;

  async function handleMarkNoShow() {
    if (!appointment) return;
    setNoShowLoading(true);
    const result = await chargeNoShowFee(appointment.id);
    setNoShowLoading(false);

    if (result.success) {
      if ("waived" in result && result.waived) {
        toast.success("Marked as no-show (no fee -- $0 configured)");
      } else if ("amountCents" in result && result.amountCents != null) {
        const amount = (result.amountCents / 100).toFixed(2);
        if ("status" in result && result.status === "completed") {
          toast.success(`No-show fee of $${amount} charged`);
        } else {
          toast.error(
            `No-show marked but charge failed -- fee of $${amount} could not be collected`,
          );
        }
      }
      // Refresh charges list
      const updatedCharges = await getChargesForAppointment(appointment.id);
      setCharges(updatedCharges);
      onMutationComplete();
    } else {
      if ("error" in result) {
        if (result.error === "No payment method on file") {
          toast.error("No payment method on file for this client");
          if ("markedNoShow" in result && result.markedNoShow) {
            toast.info("Appointment marked as no-show without fee");
            onMutationComplete();
          }
        } else {
          toast.error(result.error);
        }
      }
    }
  }

  async function handleCheckIn() {
    if (!appointment) return;
    setCheckingIn(true);
    const result = await checkInAppointment(appointment.id);
    setCheckingIn(false);
    if (result.success) {
      setCheckedInOverride(result.checkedInAt);
      toast.success(t("checkedIn"));
      onMutationComplete();
    } else {
      toast.error(result.error.message);
    }
  }

  async function handleSendText() {
    if (!appointment) return;
    if (!preparedText.ok) {
      toast.error(
        preparedText.error === "too_long" ? t("textDialog.tooLong") : t("textDialog.empty"),
      );
      return;
    }
    setSendingText(true);
    const result = await sendClientText(appointment.id, preparedText.body);
    setSendingText(false);
    if (result.success) {
      toast.success(t("textDialog.sent"));
      setTextOpen(false);
      setTextBody("");
    } else {
      toast.error(result.error.message);
    }
  }

  async function handleTakeLateCredit() {
    if (!appointment) return;
    setLateCreditLoading(true);
    const result = await takeLateCancelCredit(appointment.id);
    setLateCreditLoading(false);
    if (result.success) {
      toast.success(tpk("lateCancelTaken"));
      setLateCreditEligible(false);
      onMutationComplete();
    } else {
      toast.error(result.error);
    }
  }

  async function handleWaive(chargeId: string) {
    setActionLoading(chargeId);
    const result = await waiveCharge(chargeId);
    setActionLoading(null);

    if (result.success) {
      toast.success("Charge waived");
      if (appointment) {
        const updatedCharges = await getChargesForAppointment(appointment.id);
        setCharges(updatedCharges);
      }
      onMutationComplete();
    } else {
      toast.error("error" in result ? result.error : "Failed to waive charge");
    }
  }

  async function handleRefund(chargeId: string) {
    setActionLoading(chargeId);
    const result = await refundCharge(chargeId);
    setActionLoading(null);

    if (result.success) {
      toast.success("Charge refunded");
      if (appointment) {
        const updatedCharges = await getChargesForAppointment(appointment.id);
        setCharges(updatedCharges);
      }
      onMutationComplete();
    } else {
      toast.error(
        "error" in result ? result.error : "Failed to refund charge",
      );
    }
  }

  const content = (
    <div className="space-y-4">
      <p className="text-sm">{t(`status.${visitWord(appointment.status, shownCheckIn)}`)}</p>
      <div className="grid grid-cols-2 gap-2">
        <Button
          className="min-h-11"
          onClick={handleCheckIn}
          disabled={checkingIn || Boolean(shownCheckIn) || visitClosed}
        >
          {shownCheckIn ? t("checkedIn") : t("checkIn")}
        </Button>
        <Button
          variant="outline"
          className="min-h-11"
          onClick={() => setRescheduleOpen(true)}
          disabled={appointment.status === "cancelled" || appointment.status === "no_show"}
        >
          {t("reschedule")}
        </Button>
        <Button
          variant="outline"
          className="min-h-11"
          onClick={() => setTextOpen(true)}
          disabled={appointment.status === "cancelled"}
        >
          {t("sendText")}
        </Button>
        <Button
          variant="destructive"
          className="min-h-11"
          onClick={() => setCancelOpen(true)}
          disabled={appointment.status === "cancelled" || appointment.status === "no_show"}
        >
          {t("cancel")}
        </Button>
      </div>
      {/* Client */}
      <div className="flex flex-wrap items-center gap-2">
        <User className="h-4 w-4 shrink-0 text-muted-foreground" />
        <span className="font-medium">{appointment.clientName}</span>
        {appointment.clientStatusAtBooking === "new" && (
          <Badge variant="secondary" className="text-xs">
            New client
          </Badge>
        )}
        {appointment.clientStatusAtBooking === "repeat" && (
          <Badge variant="outline" className="text-xs">
            Repeat client
          </Badge>
        )}
      </div>

      <AppointmentFieldsSlot
        appointmentId={appointment.id}
        values={appointment.attributes ?? {}}
      />

      {/* Date & time — inline edit when appointment is still active */}
      {appointment.status !== "cancelled" &&
      appointment.status !== "no_show" &&
      appointment.status !== "completed" ? (
        <div className="space-y-2 rounded-md border bg-muted/20 p-3">
          <div className="flex items-center gap-2 text-sm font-medium">
            <Calendar className="h-4 w-4 text-muted-foreground" />
            <Clock className="h-4 w-4 text-muted-foreground" />
            Date & time
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-1">
              <Label htmlFor="appt-edit-date" className="text-xs">
                Date
              </Label>
              <Input
                id="appt-edit-date"
                type="date"
                value={editDate}
                onChange={(e) => setEditDate(e.target.value)}
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="appt-edit-time" className="text-xs">
                Start time
              </Label>
              <Select value={editTime} onValueChange={setEditTime}>
                <SelectTrigger id="appt-edit-time">
                  <SelectValue placeholder="Time" />
                </SelectTrigger>
                <SelectContent>
                  {BOOKING_TIME_OPTIONS.map((opt) => (
                    <SelectItem key={opt.value} value={opt.value}>
                      {opt.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <p className="text-xs text-muted-foreground">
            Ends {format(appointment.end, "h:mm a")} ({durationMinutes} min
            total)
          </p>
          <Button
            type="button"
            variant="secondary"
            
            className="w-full"
            disabled={savingDateTime || !editDate || !editTime}
            onClick={async () => {
              setSavingDateTime(true);
              const newStart = new Date(`${editDate}T${editTime}`);
              const result = await rescheduleBooking({
                appointmentId: appointment.id,
                newStartTime: newStart.toISOString(),
              });
              setSavingDateTime(false);
              if (result.success) {
                toast.success("Date & time updated");
                onMutationComplete();
              } else {
                const errorMsg =
                  "message" in result.error
                    ? (result.error as { message: string }).message
                    : "Failed to update";
                toast.error(errorMsg);
              }
            }}
          >
            {savingDateTime ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Saving…
              </>
            ) : (
              "Save date & time"
            )}
          </Button>
        </div>
      ) : (
        <>
          <div className="flex items-center gap-2">
            <Calendar className="h-4 w-4 text-muted-foreground" />
            <span className="text-sm">
              {format(appointment.start, "EEEE, MMM d, yyyy")}
            </span>
          </div>
          <div className="flex items-center gap-2">
            <Clock className="h-4 w-4 text-muted-foreground" />
            <span className="text-sm">
              {format(appointment.start, "h:mm a")} -{" "}
              {format(appointment.end, "h:mm a")}
              <span className="ml-1 text-muted-foreground">
                ({durationMinutes} min)
              </span>
            </span>
          </div>
        </>
      )}

      {/* Staff */}
      {staffName && (
        <div className="flex items-center gap-2">
          <Scissors className="h-4 w-4 text-muted-foreground" />
          <span className="text-sm">{staffName}</span>
        </div>
      )}

      {/* Location */}
      {(appointment.locationName || appointment.locationAddress) && (
        <div className="flex items-start gap-2">
          <MapPin className="mt-0.5 h-4 w-4 text-muted-foreground" />
          <div className="text-sm">
            {appointment.locationName && (
              <div>{appointment.locationName}</div>
            )}
            {appointment.locationAddress && (
              <div className="text-muted-foreground">
                {appointment.locationAddress}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Multi-session project: link and design warning */}
      {appointment.project && (
        <div className="space-y-1 text-sm">
          <Link
            href={`/projects/${appointment.project.id}`}
            className="inline-flex min-h-11 items-center font-medium underline"
          >
            {tp("projectLink", { title: appointment.project.title })}
          </Link>
          {appointment.project.designPending && (
            <p role="status" className="flex items-center gap-2 font-medium text-amber-700">
              <AlertTriangle className="h-4 w-4 shrink-0" aria-hidden />
              {tp("notApproved")}
            </p>
          )}
        </div>
      )}

      {/* On-site: address, arrival window, "On my way" text */}
      <OnSiteDetails key={appointment.id} appointment={appointment} />

      {/* Status */}
      <div className="flex items-center gap-2">
        <Badge
          variant={
            appointment.status === "confirmed" ? "default" : "secondary"
          }
        >
          {appointment.status}
        </Badge>
      </div>

      {/* Repeating series */}
      {appointment.recurrenceRuleId && (
        <div className="space-y-2">
          <p className="text-sm">
            {appointment.rrule === "FREQ=WEEKLY;INTERVAL=2"
              ? t("recurrence.repeatsBiweekly")
              : t("recurrence.repeatsWeekly")}
          </p>
          {appointment.status === "confirmed" && (
            <Button variant="outline"  onClick={() => setStopOpen(true)}>
              {t("recurrence.stopRepeating")}
            </Button>
          )}
        </div>
      )}

      {/* Calendar sync status */}
      {appointment.calendarSyncStatus &&
        appointment.calendarSyncStatus !== "not_applicable" && (
          <div className="flex items-center gap-2 text-xs">
            {appointment.calendarSyncStatus === "pushed" && (
              <>
                <CheckCircle className="size-3 text-green-600" />
                <span className="text-muted-foreground">
                  Synced to calendar
                </span>
              </>
            )}
            {appointment.calendarSyncStatus === "failed" && (
              <>
                <AlertTriangle className="size-3 text-red-500" />
                <span className="text-muted-foreground">
                  Calendar sync failed
                </span>
              </>
            )}
            {appointment.calendarSyncStatus === "pending" && (
              <>
                <Loader2 className="size-3 animate-spin text-muted-foreground" />
                <span className="text-muted-foreground">
                  Syncing to calendar...
                </span>
              </>
            )}
          </div>
        )}

      <Separator />

      {/* Services */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <h4 className="text-sm font-medium">Services</h4>
          {appointment.status !== "cancelled" &&
            appointment.status !== "no_show" &&
            appointment.status !== "completed" && (
              <Button
                variant="ghost"
                
                className="h-6 gap-1 px-2 text-xs text-muted-foreground"
                onClick={() => setEditServicesOpen(true)}
              >
                <Pencil className="h-3 w-3" />
                Edit
              </Button>
            )}
        </div>
        {appointment.services.map((svc) => (
          <div
            key={svc.serviceId}
            className="flex min-w-0 items-center justify-between gap-2"
          >
            <span className="truncate text-sm">{svc.serviceName}</span>
            <DurationBadge
              durationMinutes={svc.durationMinutes}
              isOverride={svc.isOverride === 1}
            />
          </div>
        ))}
      </div>

      {/* Notes */}
      {appointment.notes && (
        <>
          <Separator />
          <div className="space-y-1">
            <h4 className="text-sm font-medium">Notes</h4>
            <p className="text-sm text-muted-foreground">
              {appointment.notes}
            </p>
          </div>
        </>
      )}

      <Separator />

      {/* Payment section */}
      <div className="space-y-3">
        <h4 className="text-sm font-medium flex items-center gap-2">
          <CreditCard className="h-4 w-4" />
          Payment
        </h4>

        {/* Card on file status */}
        <div>
          {appointment.hasCardOnFile ? (
            <Badge
              variant="default"
              className="bg-green-600 hover:bg-green-700"
            >
              Card on file
            </Badge>
          ) : (
            <Badge
              variant="secondary"
              className="bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200"
            >
              No card
            </Badge>
          )}
        </div>

        {/* Charge history */}
        {charges.length > 0 && (
          <div className="space-y-2">
            <h5 className="text-xs font-medium text-muted-foreground">
              Charges
            </h5>
            {charges.map((charge) => (
              <div
                key={charge.id}
                className="rounded-md border bg-muted/30 p-2 text-sm space-y-1"
              >
                <div className="flex items-center justify-between">
                  <span>
                    ${(charge.amountCents / 100).toFixed(2)} -{" "}
                    {reasonLabel(charge.reason)}
                  </span>
                  <div className="flex items-center gap-1">
                    {charge.status === "failed" && (
                      <AlertTriangle className="h-3 w-3 text-destructive" />
                    )}
                    <Badge variant={statusBadgeVariant(charge.status)}>
                      {charge.status}
                    </Badge>
                  </div>
                </div>
                {charge.status === "failed" && charge.failureReason && (
                  <p className="text-xs text-destructive">
                    {charge.failureReason}
                  </p>
                )}
                <div className="flex items-center gap-1 pt-1">
                  {(charge.status === "pending" ||
                    charge.status === "completed") && (
                    <Button
                      variant="ghost"
                      
                      className="h-6 px-2 text-xs"
                      disabled={actionLoading === charge.id}
                      onClick={() => handleWaive(charge.id)}
                    >
                      Waive
                    </Button>
                  )}
                  {charge.status === "completed" && (
                    <Button
                      variant="ghost"
                      
                      className="h-6 px-2 text-xs"
                      disabled={actionLoading === charge.id}
                      onClick={() => handleRefund(charge.id)}
                    >
                      Refund
                    </Button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <Separator />

      {/* Actions — stacked for narrow sheets; avoids horizontal clipping */}
      <div className="space-y-2">
        <Button variant="outline"  className="w-full" asChild>
          <Link href={`/appointments/${appointment.id}`}>{tw("detail.openFull")}</Link>
        </Button>
        <Button
          variant="default"
          
          className="w-full bg-green-600 text-white hover:bg-green-700"
          onClick={() => setCheckoutOpen(true)}
          disabled={
            appointment.status === "cancelled" ||
            appointment.status === "no_show" ||
            appointment.status === "completed"
          }
        >
          Complete
        </Button>
        {(() => {
          const rowItems: ReactNode[] = [];
          if (appointment.status === "confirmed") {
            rowItems.push(
              <Button
                key="send-link"
                variant="outline"
                
                className="w-full"
                disabled={sendingLink}
                onClick={async () => {
                  setSendingLink(true);
                  try {
                    const result = await sendCheckoutLink(appointment.id);
                    if (result.success) {
                      toast.success("Checkout link sent to client");
                    } else {
                      toast.error(
                        "error" in result
                          ? result.error
                          : "Failed to send checkout link",
                      );
                    }
                  } catch {
                    toast.error("Failed to send checkout link");
                  } finally {
                    setSendingLink(false);
                  }
                }}
              >
                {sendingLink ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Send className="h-4 w-4" />
                )}
                <span className="ml-1">Send Link</span>
              </Button>,
            );
            rowItems.push(
              <Button
                key="send-intake"
                variant="outline"
                
                className="w-full"
                disabled={sendingIntake}
                onClick={async () => {
                  setSendingIntake(true);
                  try {
                    const result = await sendIntakeRequest({
                      appointmentId: appointment.id,
                    });
                    if (result.success) {
                      toast.success("Intake link sent to client");
                    } else {
                      toast.error(
                        result.error ?? "Failed to send intake link",
                      );
                    }
                  } catch {
                    toast.error("Failed to send intake link");
                  } finally {
                    setSendingIntake(false);
                  }
                }}
              >
                {sendingIntake ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Send className="h-4 w-4" />
                )}
                <span className="ml-1">Send Intake</span>
              </Button>,
            );
          }
          if (
            appointment.status !== "cancelled" &&
            appointment.status !== "no_show" &&
            appointment.status !== "completed"
          ) {
            rowItems.push(
              <Button
                key="delete"
                variant="outline"
                
                className="w-full border-destructive/50 text-destructive hover:bg-destructive/10"
                disabled={deleteLoading}
                title="Remove mistaken booking without counting as a cancellation"
                onClick={async () => {
                  if (
                    !window.confirm(
                      "Permanently delete this booking? It will not appear as cancelled. This cannot be undone.",
                    )
                  ) {
                    return;
                  }
                  setDeleteLoading(true);
                  const result = await deleteBooking({
                    appointmentId: appointment.id,
                  });
                  setDeleteLoading(false);
                  if (result.success) {
                    toast.success("Booking deleted");
                    onClose();
                    onMutationComplete();
                  } else {
                    toast.error(
                      "message" in result.error
                        ? (result.error as { message: string }).message
                        : "Could not delete booking",
                    );
                  }
                }}
              >
                {deleteLoading ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Trash2 className="h-4 w-4" />
                )}
                <span className="ml-1">Delete</span>
              </Button>,
            );
          }
          rowItems.push(
            <Button
              key="no-show"
              variant="destructive"
              
              className="w-full"
              onClick={handleMarkNoShow}
              disabled={
                noShowLoading ||
                appointment.status === "no_show" ||
                appointment.status === "cancelled"
              }
            >
              {noShowLoading ? "Charging..." : "No-Show"}
            </Button>,
          );
          if (lateCreditEligible) {
            rowItems.push(
              <Button
                key="late-credit"
                variant="outline"
                
                className="min-h-11 w-full"
                disabled={lateCreditLoading}
                onClick={handleTakeLateCredit}
              >
                {lateCreditLoading && <Loader2 className="h-4 w-4 animate-spin" />}
                <span className="ml-1">{tpk("takeLateCancel")}</span>
              </Button>,
            );
          }

          const pairs: ReactNode[][] = [];
          for (let i = 0; i < rowItems.length; i += 2) {
            pairs.push(rowItems.slice(i, i + 2));
          }

          return pairs.map((pair, idx) => (
            <div key={idx} className="grid grid-cols-2 gap-2">
              {pair.length === 1 ? (
                <div className="col-span-2">{pair[0]}</div>
              ) : (
                pair
              )}
            </div>
          ));
        })()}
      </div>

      {/* Dialogs */}
      <Dialog open={stopOpen} onOpenChange={setStopOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("recurrence.stopRepeating")}</DialogTitle>
            <DialogDescription>{t("recurrence.stopConfirm")}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setStopOpen(false)} disabled={stopLoading}>
              Keep repeating
            </Button>
            <Button
              disabled={stopLoading}
              onClick={async () => {
                setStopLoading(true);
                const result = await stopRecurrence({ appointmentId: appointment.id });
                setStopLoading(false);
                setStopOpen(false);
                if (result.success) {
                  toast.success(t("recurrence.stopped"));
                  onClose();
                  onMutationComplete();
                } else {
                  toast.error(result.error);
                }
              }}
            >
              {t("recurrence.stopRepeating")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={textOpen} onOpenChange={setTextOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("textDialog.title")}</DialogTitle>
            <DialogDescription>{t("textDialog.hint")}</DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="client-text">{t("textDialog.title")}</Label>
            <Textarea
              id="client-text"
              value={textBody}
              placeholder={t("textDialog.placeholder")}
              onChange={(event) => setTextBody(event.target.value)}
              maxLength={400}
            />
            <p className="text-sm text-muted-foreground">
              {toPlainSms(textBody).length} / 320
            </p>
          </div>
          <DialogFooter>
            <Button
              className="min-h-11"
              onClick={handleSendText}
              disabled={sendingText || !preparedText.ok}
            >
              {t("textDialog.send")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <RescheduleDialog
        open={rescheduleOpen}
        onOpenChange={setRescheduleOpen}
        appointment={appointment}
        onComplete={() => {
          setRescheduleOpen(false);
          onClose();
          onMutationComplete();
        }}
      />
      <CancelDialog
        open={cancelOpen}
        onOpenChange={setCancelOpen}
        appointment={appointment}
        onComplete={() => {
          setCancelOpen(false);
          onClose();
          onMutationComplete();
        }}
      />
      <EditServicesDialog
        open={editServicesOpen}
        onOpenChange={setEditServicesOpen}
        appointment={appointment}
        onComplete={() => {
          setEditServicesOpen(false);
          onClose();
          onMutationComplete();
        }}
      />
      <CheckoutDialog
        appointmentId={checkoutOpen ? appointment.id : null}
        onClose={() => setCheckoutOpen(false)}
        onComplete={() => {
          setCheckoutOpen(false);
          onClose();
          onMutationComplete();
        }}
      />
    </div>
  );

  const title = `${appointment.clientName} — ${
    appointment.services.length > 1
      ? appointment.services.map((s) => s.serviceName).join(" + ")
      : appointment.services[0]?.serviceName ?? "Appointment"
  }`;

  if (layout === "dock") {
    return (
      <section data-testid="appointment-detail" className="flex h-full min-h-0 flex-col overflow-y-auto px-4 py-4">
        <div className="mb-3 flex items-center justify-between gap-2">
          <h2 className="text-base font-medium">{title}</h2>
          <Button type="button" variant="ghost" size="icon" aria-label={t("details.close")} onClick={onClose}>
            ×
          </Button>
        </div>
        {content}
      </section>
    );
  }

  return (
    <Sheet open={!!appointment} onOpenChange={(v) => !v && onClose()}>
      <SheetContent className="flex h-full w-full max-w-none flex-col overflow-y-auto px-4 sm:max-w-none">
        <SheetHeader>
          <SheetTitle>{title}</SheetTitle>
        </SheetHeader>
        {content}
      </SheetContent>
    </Sheet>
  );
}
