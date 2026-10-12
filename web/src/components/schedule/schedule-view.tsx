"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { completeAppointment } from "@/actions/checkout";
import { useSchedule } from "@/hooks/use-schedule";
import { DateNav } from "./date-nav";
import { DayView } from "./day-view";
import { WeekView } from "./week-view";
import { MonthView } from "./month-view";
import { AgendaList } from "./agenda-list";
import { BookingPanel } from "@/components/booking/booking-panel";
import { AppointmentDetail } from "@/components/booking/appointment-detail";
import { RescheduleDialog } from "@/components/booking/reschedule-dialog";
import { TimeBlockFormDialog } from "./time-block-form-dialog";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from "@/components/ui/dialog";
import { ClipboardList } from "lucide-react";
import { AssistantTaskPanel } from "./assistant-task-panel";
import { StandaloneTaskDialog } from "./standalone-task-dialog";
import { TaskDetailDialog } from "./task-detail-dialog";
import type { AppointmentData } from "./appointment-block";
import type { TimeBlockData } from "./time-block";
import { deleteTimeBlock } from "@/actions/time-blocks";
import { useT } from "@/lib/terms/client";
import { toast } from "sonner";

interface StaffMember {
  id: string;
  displayName: string;
  photoUrl?: string | null;
  role?: string;
  services: { serviceId: string; serviceName: string }[];
}

interface TaskType {
  id: string;
  name: string;
  defaultDurationMinutes: number;
}

interface ScheduleViewProps {
  staff: StaffMember[];
  assistants?: StaffMember[];
  timezone: string;
  showAssistants?: boolean;
  taskTypes?: TaskType[];
}

export interface BookingPanelState {
  open: boolean;
  staffId: string | null;
  startTime: Date | null;
}

export interface RescheduleState {
  open: boolean;
  appointmentId: string;
  appointment: AppointmentData | null;
  newStaffId: string;
  newTime: Date | null;
  oldTime: Date | null;
}

export function ScheduleView({
  staff,
  assistants,
  showAssistants,
  taskTypes,
}: ScheduleViewProps) {
  const schedule = useSchedule();
  const t = useT("nav");
  const ts = useT("schedule");
  const [docked, setDocked] = useState(false);

  useEffect(() => {
    const media = window.matchMedia("(min-width: 1024px)");
    const apply = () => setDocked(media.matches);
    apply();
    media.addEventListener("change", apply);
    return () => media.removeEventListener("change", apply);
  }, []);

  // Booking panel state
  const [bookingPanel, setBookingPanel] = useState<BookingPanelState>({
    open: false,
    staffId: null,
    startTime: null,
  });

  // Selected appointment for detail panel
  const [selectedAppointment, setSelectedAppointment] =
    useState<AppointmentData | null>(null);

  // Reschedule dialog state (for drag-and-drop)
  const [rescheduleState, setRescheduleState] = useState<RescheduleState>({
    open: false,
    appointmentId: "",
    appointment: null,
    newStaffId: "",
    newTime: null,
    oldTime: null,
  });

  // Refresh trigger -- increment to force DayView/WeekView re-fetch
  const [refreshKey, setRefreshKey] = useState(0);
  const triggerRefresh = () => setRefreshKey((k) => k + 1);

  // Resume checkout after a Stripe 3DS full-page redirect (debit cards whose
  // issuer forces redirect_to_url instead of an inline iframe). The dialog set
  // ?checkout_resume=<apptId>&checkout_tip=<cents> as the return_url; Stripe
  // appended ?payment_intent=&payment_intent_client_secret=&redirect_status=.
  const router = useRouter();
  const searchParams = useSearchParams();
  const resumeRanRef = useRef(false);
  useEffect(() => {
    if (resumeRanRef.current) return;
    const apptId = searchParams.get("checkout_resume");
    if (!apptId) return;
    resumeRanRef.current = true;

    const piId = searchParams.get("payment_intent");
    const status = searchParams.get("redirect_status");
    const tipCents = Math.max(
      0,
      Number.parseInt(searchParams.get("checkout_tip") ?? "0", 10) || 0,
    );
    const finalProjectSession = searchParams.get("checkout_final") === "1";

    const stripParams = () => {
      const url = new URL(window.location.href);
      for (const k of [
        "checkout_resume",
        "checkout_tip",
        "checkout_final",
        "payment_intent",
        "payment_intent_client_secret",
        "redirect_status",
      ]) {
        url.searchParams.delete(k);
      }
      router.replace(url.pathname + url.search);
    };

    if (status === "succeeded" && piId) {
      (async () => {
        const result = await completeAppointment({
          appointmentId: apptId,
          paymentMethod: "new_card",
          stripePaymentIntentId: piId,
          tipCents,
          finalProjectSession,
        });
        if (result.success) {
          toast.success(
            `Checkout complete - $${(result.totalCents / 100).toFixed(2)}`,
          );
          triggerRefresh();
        } else {
          toast.error(result.error ?? "Could not finalize checkout");
        }
        stripParams();
      })();
    } else {
      toast.error(
        status === "failed"
          ? "Card authentication failed — please try again"
          : "Checkout could not be completed",
      );
      stripParams();
    }
  }, [searchParams, router]);

  // Assistant task panel state (per-appointment task assignment)
  const [taskPanelOpen, setTaskPanelOpen] = useState(false);

  // Standalone task dialog state (manual task on assistant column header)
  const [standaloneTaskAssistant, setStandaloneTaskAssistant] = useState<{
    id: string;
    displayName: string;
    startTime?: Date;
  } | null>(null);

  // Task detail/edit dialog state (click an existing task block)
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);

  /** Empty slot: choose book vs block */
  const [slotChoice, setSlotChoice] = useState<{
    staffId: string;
    time: Date;
  } | null>(null);
  const [blockFormOpen, setBlockFormOpen] = useState(false);
  const [blockContext, setBlockContext] = useState<{
    staffId: string;
    time: Date;
  } | null>(null);

  function handleSlotClick(staffId: string, time: Date) {
    setSelectedAppointment(null);
    setSlotChoice({ staffId, time });
  }

  async function handleTimeBlockSelect(block: TimeBlockData) {
    if (!window.confirm("Remove this time block?")) return;
    const result = await deleteTimeBlock({ id: block.id });
    if (result.success) {
      toast.success("Time block removed");
      triggerRefresh();
    } else {
      toast.error(
        "message" in result.error
          ? (result.error as { message: string }).message
          : "Failed to remove block",
      );
    }
  }

  function handleAppointmentSelect(appointment: AppointmentData) {
    setSelectedAppointment(appointment);
    setBookingPanel({ open: false, staffId: null, startTime: null });
  }

  function handleDragReschedule(
    appointmentId: string,
    appointment: AppointmentData,
    newStaffId: string,
    newMinutes: number,
    currentDate: Date,
  ) {
    const newTime = new Date(currentDate);
    newTime.setHours(Math.floor(newMinutes / 60), newMinutes % 60, 0, 0);

    setRescheduleState({
      open: true,
      appointmentId,
      appointment,
      newStaffId,
      newTime,
      oldTime: appointment.start,
    });
  }

  function handleDayClickInWeekView(date: Date) {
    schedule.setDate(date);
    schedule.setView("day");
  }

  /**
   * Drag-to-reschedule from the week view. The week view doesn't aggregate by
   * stylist (every column is a day, not a stylist), so we keep the
   * appointment's existing stylist and only change the date+time.
   */
  function handleWeekDragReschedule(
    appointmentId: string,
    appointment: AppointmentData,
    newDate: Date,
    newMinutes: number,
  ) {
    const newTime = new Date(newDate);
    newTime.setHours(Math.floor(newMinutes / 60), newMinutes % 60, 0, 0);

    setRescheduleState({
      open: true,
      appointmentId,
      appointment,
      newStaffId: appointment.staffId,
      newTime,
      oldTime: appointment.start,
    });
  }

  function handleForceBook(staffId: string, time: Date) {
    const confirmed = window.confirm(
      "This time overlaps with an external calendar event. Are you sure you want to book over it?",
    );
    if (confirmed) {
      handleSlotClick(staffId, time);
    }
  }

  const detail = (
    <AppointmentDetail
      layout={docked ? "dock" : "sheet"}
      appointment={selectedAppointment}
      onClose={() => setSelectedAppointment(null)}
      onMutationComplete={triggerRefresh}
    />
  );

  return (
    <div className="flex h-full min-h-0 flex-col">
    <div className="flex min-h-0 flex-1">
      <div className="flex min-w-0 flex-1 flex-col">
      {/* Top bar */}
      <div className="flex flex-wrap items-center justify-between gap-2 border-b px-4 py-3">
        <DateNav
          currentDate={schedule.currentDate}
          viewMode={schedule.viewMode}
          onNavigate={schedule.navigateDate}
          onToday={schedule.goToToday}
          onDateSelect={schedule.setDate}
        />

        <div className="flex flex-wrap items-center gap-2">
          {schedule.viewMode === "day" && (
            <div className="hidden items-center gap-2 md:flex" role="group" aria-label={ts("showBy")}>
              <span className="text-sm">{ts("showBy")}</span>
              <Button
                variant={schedule.dayAxis === "people" ? "default" : "outline"}
                className="min-h-11"
                onClick={() => schedule.setDayAxis("people")}
              >
                {ts("people")}
              </Button>
              <Button
                variant={schedule.dayAxis === "rooms" ? "default" : "outline"}
                className="min-h-11"
                onClick={() => schedule.setDayAxis("rooms")}
              >
                {ts("rooms")}
              </Button>
            </div>
          )}
          <div className="hidden gap-1 md:flex">
            <Button
              variant={schedule.viewMode === "day" ? "default" : "outline"}
              className="min-h-11"
              onClick={() => schedule.setView("day")}
            >
              {ts("day")}
            </Button>
            <Button
              variant={schedule.viewMode === "week" ? "default" : "outline"}
              className="min-h-11"
              onClick={() => schedule.setView("week")}
            >
              {ts("week")}
            </Button>
            <Button
              variant={schedule.viewMode === "month" ? "default" : "outline"}
              className="min-h-11"
              onClick={() => schedule.setView("month")}
            >
              {ts("month")}
            </Button>
          </div>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-auto md:hidden">
        <AgendaList
          key={`agenda-${refreshKey}`}
          staff={staff}
          currentDate={schedule.currentDate}
          refreshKey={refreshKey}
          onSelect={handleAppointmentSelect}
        />
      </div>

      {/* Schedule grid */}
      <div className="hidden min-h-0 flex-1 overflow-auto md:block" tabIndex={0} aria-label={t("schedule")}>
        {schedule.viewMode === "month" ? (
          <MonthView
            key={`month-${refreshKey}`}
            staff={staff}
            currentDate={schedule.currentDate}
            onDayClick={handleDayClickInWeekView}
          />
        ) : schedule.viewMode === "week" ? (
          <WeekView
            key={`week-${refreshKey}`}
            staff={staff}
            currentDate={schedule.currentDate}
            onDayClick={handleDayClickInWeekView}
            onAppointmentSelect={handleAppointmentSelect}
            onDragReschedule={handleWeekDragReschedule}
          />
        ) : (
          <DayView
            key={`day-${refreshKey}-${schedule.dayAxis}`}
            axis={schedule.dayAxis}
            staff={staff}
            assistants={assistants}
            showAssistants={showAssistants}
            taskTypes={taskTypes}
            currentDate={schedule.currentDate}
            onSlotClick={handleSlotClick}
            onAppointmentSelect={handleAppointmentSelect}
            onDragReschedule={handleDragReschedule}
            onForceBook={handleForceBook}
            onTimeBlockSelect={handleTimeBlockSelect}
            onAddAssistantTask={(assistant, startTime) =>
              setStandaloneTaskAssistant({
                id: assistant.id,
                displayName: assistant.displayName,
                startTime,
              })
            }
            onTaskSelect={(taskId) => setSelectedTaskId(taskId)}
          />
        )}
      </div>
      </div>

      {docked && (
        <aside
          data-testid="appointment-dock"
          className="flex w-96 shrink-0 flex-col overflow-y-auto border-l"
        >
          {selectedAppointment ? (
            detail
          ) : (
            <p className="p-4 text-sm text-muted-foreground">{ts("selectBooking")}</p>
          )}
        </aside>
      )}
    </div>

      <Dialog
        open={!!slotChoice}
        onOpenChange={(open) => {
          if (!open) setSlotChoice(null);
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>This time slot</DialogTitle>
            <DialogDescription>
              Book a client or block time for breaks and other tasks.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="flex-col gap-2 sm:flex-col">
            <Button
              className="w-full"
              onClick={() => {
                if (!slotChoice) return;
                const { staffId, time } = slotChoice;
                setSlotChoice(null);
                setBookingPanel({ open: true, staffId, startTime: time });
              }}
            >
              Book client
            </Button>
            <Button
              variant="secondary"
              className="w-full"
              onClick={() => {
                if (!slotChoice) return;
                setBlockContext(slotChoice);
                setSlotChoice(null);
                setBlockFormOpen(true);
              }}
            >
              Block time
            </Button>
            <Button
              variant="ghost"
              className="w-full"
              onClick={() => setSlotChoice(null)}
            >
              Cancel
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <TimeBlockFormDialog
        open={blockFormOpen}
        onOpenChange={(open) => {
          setBlockFormOpen(open);
          if (!open) setBlockContext(null);
        }}
        staffId={blockContext?.staffId ?? null}
        startTime={blockContext?.time ?? null}
        onCreated={triggerRefresh}
      />

      {/* Booking Panel */}
      <BookingPanel
        open={bookingPanel.open}
        onClose={() =>
          setBookingPanel({ open: false, staffId: null, startTime: null })
        }
        staffId={bookingPanel.staffId}
        startTime={bookingPanel.startTime}
        staff={staff}
        onBookingCreated={triggerRefresh}
      />

      {!docked && detail}

      {/* Assign Tasks button (shown as floating action when appointment selected + assistants enabled) */}
      {showAssistants &&
        selectedAppointment &&
        assistants &&
        assistants.length > 0 && (
          <div className="fixed bottom-4 right-4 z-50">
            <Button
              onClick={() => setTaskPanelOpen(true)}
              className="shadow-lg"
              
            >
              <ClipboardList className="mr-1.5 size-4" />
              Assign Tasks
            </Button>
          </div>
        )}

      {/* Assistant Task Panel — task assignment within an appointment context */}
      {showAssistants && selectedAppointment && assistants && (
        <AssistantTaskPanel
          open={taskPanelOpen}
          appointmentId={selectedAppointment.id}
          appointmentStart={selectedAppointment.start}
          appointmentEnd={selectedAppointment.end}
          assistants={assistants.map((a) => ({
            id: a.id,
            displayName: a.displayName,
          }))}
          taskTypes={taskTypes ?? []}
          onClose={() => setTaskPanelOpen(false)}
          onTasksChanged={triggerRefresh}
        />
      )}

      {/* Standalone task dialog — manual task on the assistant's day, no appointment */}
      {showAssistants && standaloneTaskAssistant && (
        <StandaloneTaskDialog
          open={!!standaloneTaskAssistant}
          onOpenChange={(open) => {
            if (!open) setStandaloneTaskAssistant(null);
          }}
          assistant={standaloneTaskAssistant}
          taskTypes={taskTypes ?? []}
          scheduleDate={schedule.currentDate}
          initialStartTime={standaloneTaskAssistant.startTime}
          onSaved={triggerRefresh}
        />
      )}

      {/* Task detail/edit dialog (clicked an existing task block) */}
      {showAssistants && (
        <TaskDetailDialog
          taskId={selectedTaskId}
          open={!!selectedTaskId}
          onOpenChange={(open) => {
            if (!open) setSelectedTaskId(null);
          }}
          onSaved={triggerRefresh}
        />
      )}

      {/* Drag-and-Drop Reschedule Dialog */}
      {rescheduleState.open && rescheduleState.appointment && (
        <RescheduleDialog
          open={rescheduleState.open}
          onOpenChange={(open) =>
            setRescheduleState((prev) => ({ ...prev, open }))
          }
          appointment={rescheduleState.appointment}
          newTime={rescheduleState.newTime}
          newStaffId={rescheduleState.newStaffId}
          onComplete={() => {
            setRescheduleState({
              open: false,
              appointmentId: "",
              appointment: null,
              newStaffId: "",
              newTime: null,
              oldTime: null,
            });
            triggerRefresh();
          }}
        />
      )}
    </div>
  );
}

// Re-export types for use by booking components
export type { AppointmentData } from "./appointment-block";
