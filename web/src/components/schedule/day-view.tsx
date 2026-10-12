"use client";

import {
  useEffect,
  useRef,
  useState,
  useTransition,
  useCallback,
  useMemo,
} from "react";
import {
  DndContext,
  type DragEndEvent,
  MouseSensor,
  TouchSensor,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import { startOfDay, endOfDay } from "date-fns";
import { TimeColumn } from "./time-column";
import { StaffColumn } from "./staff-column";
import { ResourceColumn } from "./resource-column";
import { CurrentTimeMarker } from "./current-time-marker";
import type { AppointmentData } from "./appointment-block";
import type { ExternalBlockData } from "./external-block";
import type { TimeBlockData } from "./time-block";
import { getRoomDay, getScheduleData } from "@/actions/appointments";
import type { DayAxis } from "@/hooks/use-schedule";
import { listTasksForAssistants } from "@/actions/assistant-tasks";
import {
  TOTAL_HEIGHT_PX,
  DEFAULT_START_HOUR,
  DEFAULT_END_HOUR,
  HOUR_HEIGHT_PX,
  SLOT_HEIGHT_PX,
  SLOT_DURATION_MINUTES,
} from "./schedule-config";
import { useIsMobile } from "@/hooks/use-mobile";
import {
  Select,
  SelectTrigger,
  SelectContent,
  SelectItem,
  SelectValue,
} from "@/components/ui/select";
import { StickyNote } from "lucide-react";
import { useT } from "@/lib/terms/client";

interface StaffMember {
  id: string;
  displayName: string;
  photoUrl?: string | null;
}

interface TaskType {
  id: string;
  name: string;
  defaultDurationMinutes: number;
}

interface AssistantTaskData {
  id: string;
  taskName: string;
  during: { start: Date; end: Date };
  status: string;
  notes: string | null;
  appointmentId: string | null;
}

interface DayViewProps {
  staff: StaffMember[];
  axis?: DayAxis;
  assistants?: StaffMember[];
  showAssistants?: boolean;
  taskTypes?: TaskType[];
  currentDate: Date;
  onSlotClick: (staffId: string, time: Date, date: Date) => void;
  onAppointmentSelect: (appointment: AppointmentData) => void;
  onDragReschedule: (
    appointmentId: string,
    appointment: AppointmentData,
    newStaffId: string,
    newMinutes: number,
    currentDate: Date,
  ) => void;
  onForceBook?: (staffId: string, time: Date, date: Date) => void;
  onTimeBlockSelect?: (block: TimeBlockData) => void;
  onAddAssistantTask?: (assistant: StaffMember, startTime?: Date) => void;
  onTaskSelect?: (taskId: string) => void;
}

export function DayView({
  staff,
  axis = "people",
  assistants,
  showAssistants,
  currentDate,
  onSlotClick,
  onAppointmentSelect,
  onDragReschedule,
  onForceBook,
  onTimeBlockSelect,
  onAddAssistantTask,
  onTaskSelect,
}: DayViewProps) {
  const t = useT("schedule");
  const [appointmentsByStaffMember, setAppointmentsByStaffMember] = useState<
    Record<string, AppointmentData[]>
  >({});
  const [externalBlocksByStaffMember, setExternalBlocksByStaffMember] = useState<
    Record<string, ExternalBlockData[]>
  >({});
  const [timeBlocksByStaffMember, setTimeBlocksByStaffMember] = useState<
    Record<string, TimeBlockData[]>
  >({});
  const [tasksByAssistant, setTasksByAssistant] = useState<
    Record<string, AssistantTaskData[]>
  >({});
  const [rooms, setRooms] = useState<{ id: string; name: string }[]>([]);
  const [appointmentsByRoom, setAppointmentsByRoom] = useState<
    Record<string, AppointmentData[]>
  >({});
  const [isPending, startTransition] = useTransition();
  const fetchToken = useRef(0);
  const [selectedColumnId, setSelectedColumnId] = useState<string | null>(null);
  const isMobile = useIsMobile();

  const visibleAssistants = useMemo(
    () => (showAssistants ? (assistants ?? []) : []),
    [showAssistants, assistants],
  );

  /** Combined picker entries on mobile: stylists first, then assistants. */
  const mobileColumns = useMemo(
    () => [
      ...staff.map((s) => ({ kind: "stylist" as const, value: s })),
      ...visibleAssistants.map((a) => ({
        kind: "assistant" as const,
        value: a,
      })),
    ],
    [staff, visibleAssistants],
  );

  // Default / clamp the mobile selection to the first available column.
  useEffect(() => {
    if (!isMobile) return;
    if (mobileColumns.length === 0) {
      setSelectedColumnId(null);
      return;
    }
    const stillValid = mobileColumns.some((c) => c.value.id === selectedColumnId);
    if (!stillValid) {
      setSelectedColumnId(mobileColumns[0].value.id);
    }
  }, [isMobile, mobileColumns, selectedColumnId]);

  const selectedColumn = useMemo(
    () => mobileColumns.find((c) => c.value.id === selectedColumnId) ?? null,
    [mobileColumns, selectedColumnId],
  );

  const visibleStaff = useMemo(() => {
    if (!isMobile) return staff;
    return selectedColumn?.kind === "stylist" ? [selectedColumn.value] : [];
  }, [isMobile, staff, selectedColumn]);

  const renderedAssistants = useMemo(() => {
    if (!isMobile) return visibleAssistants;
    return selectedColumn?.kind === "assistant" ? [selectedColumn.value] : [];
  }, [isMobile, visibleAssistants, selectedColumn]);

  const mouseSensor = useSensor(MouseSensor, {
    activationConstraint: { distance: 8 },
  });
  const touchSensor = useSensor(TouchSensor, {
    activationConstraint: { delay: 250, tolerance: 5 },
  });
  const sensors = useSensors(mouseSensor, touchSensor);

  const fetchAppointments = useCallback(() => {
    const dayStart = startOfDay(currentDate);
    const dayEnd = endOfDay(currentDate);

    const token = ++fetchToken.current;
    startTransition(async () => {
      if (axis === "rooms") {
        const data = await getRoomDay(dayStart, dayEnd);
        if (token !== fetchToken.current) return;
        setRooms(data.rooms.map((room) => ({ id: room.id, name: room.name })));
        const results: Record<string, AppointmentData[]> = {};
        for (const [roomId, appts] of Object.entries(data.appointments)) {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          results[roomId] = (appts as any[]).map((a) => ({
            ...a,
            start: new Date(a.start),
            end: new Date(a.end),
          }));
        }
        setAppointmentsByRoom(results);
        return;
      }

      const staffIds = staff.map((s) => s.id);
      if (staffIds.length === 0) {
        if (token !== fetchToken.current) return;
        setAppointmentsByStaffMember({});
        setExternalBlocksByStaffMember({});
        setTimeBlocksByStaffMember({});
        return;
      }

      const data = await getScheduleData(staffIds, dayStart, dayEnd);
      if (token !== fetchToken.current) return;

      // Convert serialized dates back to Date objects
      const results: Record<string, AppointmentData[]> = {};
      for (const [staffId, appts] of Object.entries(data.appointments)) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        results[staffId] = appts.map((a: any) => ({
          ...a,
          start: new Date(a.start),
          end: new Date(a.end),
        }));
      }

      const externalResults: Record<string, ExternalBlockData[]> = {};
      for (const [staffId, events] of Object.entries(data.externalEvents)) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        externalResults[staffId] = events.map((e: any) => ({
          id: e.id,
          startTime: new Date(e.startTime),
          endTime: new Date(e.endTime),
          isAllDay: e.isAllDay,
          freeBusyStatus: e.freeBusyStatus,
        }));
      }

      const timeBlockResults: Record<string, TimeBlockData[]> = {};
      const rawBlocks = data.timeBlocks ?? {};
      for (const [staffId, blocks] of Object.entries(rawBlocks)) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        timeBlockResults[staffId] = (blocks as any[]).map((b) => ({
          id: b.id,
          startTime: new Date(b.startTime),
          endTime: new Date(b.endTime),
          label: b.label ?? null,
        }));
      }

      setAppointmentsByStaffMember(results);
      setExternalBlocksByStaffMember(externalResults);
      setTimeBlocksByStaffMember(timeBlockResults);
    });
  }, [axis, currentDate, staff]);

  useEffect(() => {
    fetchAppointments();
  }, [fetchAppointments]);

  // Fetch assistant tasks when assistants are enabled
  useEffect(() => {
    const activeAssistants = assistants ?? [];

    if (axis === "rooms" || !showAssistants || activeAssistants.length === 0) {
      setTasksByAssistant({});
      return;
    }

    async function fetchAssistantTasks() {
      try {
        const groupedTasks = await listTasksForAssistants(
          activeAssistants.map((assistant) => assistant.id),
          currentDate,
        );

        const results = Object.fromEntries(
          activeAssistants.map((assistant) => [
            assistant.id,
            (groupedTasks[assistant.id] ?? []).map((task) => ({
              ...task,
              during: {
                start: new Date(task.during.start),
                end: new Date(task.during.end),
              },
            })),
          ]),
        ) as Record<string, AssistantTaskData[]>;

        setTasksByAssistant(results);
      } catch {
        const results: Record<string, AssistantTaskData[]> = {};
        for (const assistant of activeAssistants) {
          results[assistant.id] = [];
        }
        setTasksByAssistant(results);
      }
    }

    fetchAssistantTasks();
  }, [axis, showAssistants, assistants, currentDate]);

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || !active.data.current) return;

    const appointment = active.data.current.appointment as AppointmentData;
    const dropData = over.data.current as
      | { staffId: string; minutes: number }
      | undefined;
    if (!dropData) return;

    onDragReschedule(
      appointment.id,
      appointment,
      axis === "rooms" ? appointment.staffId : dropData.staffId,
      dropData.minutes,
      currentDate,
    );
  }

  return (
    <DndContext sensors={sensors} onDragEnd={handleDragEnd}>
      {isMobile && mobileColumns.length > 1 && (
        <div className="flex items-center gap-2 border-b px-4 py-2">
          <Select
            value={selectedColumnId ?? undefined}
            onValueChange={(id) => setSelectedColumnId(id)}
          >
            <SelectTrigger className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {mobileColumns.map((col) => (
                <SelectItem key={col.value.id} value={col.value.id}>
                  <span className="flex items-center gap-2">
                    <span>{col.value.displayName}</span>
                    {col.kind === "assistant" && (
                      <span className="rounded bg-blue-100 px-1.5 py-0.5 text-xs font-medium uppercase tracking-wide text-blue-800 dark:bg-blue-900/40 dark:text-blue-200">
                        Assistant
                      </span>
                    )}
                  </span>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}
      <div
        className={`flex overflow-x-auto ${isPending ? "opacity-60" : ""}`}
        style={{ minHeight: TOTAL_HEIGHT_PX + 40 }}
      >
        <TimeColumn />
        <div className="relative flex flex-1">
          <CurrentTimeMarker currentDate={currentDate} />
          {axis === "rooms"
            ? rooms.map((room) => (
                <ResourceColumn
                  key={room.id}
                  resourceId={room.id}
                  resourceName={room.name}
                  appointments={appointmentsByRoom[room.id] ?? []}
                  onAppointmentSelect={onAppointmentSelect}
                  currentDate={currentDate}
                />
              ))
            : visibleStaff.map((staffMember) => (
                <StaffColumn
                  key={staffMember.id}
                  staffId={staffMember.id}
                  staffName={staffMember.displayName}
                  photoUrl={staffMember.photoUrl}
                  appointments={appointmentsByStaffMember[staffMember.id] ?? []}
                  externalBlocks={externalBlocksByStaffMember[staffMember.id] ?? []}
                  timeBlocks={timeBlocksByStaffMember[staffMember.id] ?? []}
                  onSlotClick={onSlotClick}
                  onAppointmentSelect={onAppointmentSelect}
                  onTimeBlockSelect={onTimeBlockSelect}
                  onForceBook={onForceBook}
                  currentDate={currentDate}
                />
              ))}
          {/* Assistant columns */}
          {axis === "people" && showAssistants && renderedAssistants.length > 0 && (
              <>
                {!isMobile && (
                  <div className="flex flex-col items-center justify-center px-2 border-l-2 border-dashed border-muted-foreground/30">
                    <span className="text-xs text-muted-foreground -rotate-90 whitespace-nowrap">
                      Assistants
                    </span>
                  </div>
                )}
                {renderedAssistants.map((assistant) => {
                  const tasks = tasksByAssistant[assistant.id] ?? [];
                  return (
                    <div
                      key={assistant.id}
                      className="flex min-w-[140px] flex-1 flex-col border-l"
                    >
                      {/* Assistant column header */}
                      <div className="sticky top-0 z-10 flex items-center justify-between gap-1 border-b bg-blue-50 px-2 py-1.5 text-xs font-medium dark:bg-blue-950/30">
                        <span className="min-w-0 flex-1 truncate text-center">
                          {assistant.displayName}
                        </span>
                        {onAddAssistantTask && (
                          <button
                            type="button"
                            onClick={() => onAddAssistantTask(assistant)}
                            className="flex size-5 shrink-0 items-center justify-center rounded text-blue-700 transition-colors hover:bg-blue-100 dark:text-blue-300 dark:hover:bg-blue-900"
                            aria-label={`Add task for ${assistant.displayName}`}
                            title="Add task"
                          >
                            +
                          </button>
                        )}
                      </div>
                      <div
                        className="relative"
                        style={{ height: TOTAL_HEIGHT_PX }}
                      >
                        {Array.from({
                          length: DEFAULT_END_HOUR - DEFAULT_START_HOUR,
                        }).map((_, i) => (
                          <div
                            key={i}
                            className="absolute left-0 right-0 border-t border-border/50"
                            style={{ top: i * HOUR_HEIGHT_PX }}
                          />
                        ))}
                        {onAddAssistantTask && (
                          <AssistantSlotGrid
                            assistant={assistant}
                            currentDate={currentDate}
                            onAddAssistantTask={onAddAssistantTask}
                          />
                        )}
                        {/* Task blocks */}
                        {tasks.map((task) => {
                          const startHours =
                            task.during.start.getHours() +
                            task.during.start.getMinutes() / 60;
                          const endHours =
                            task.during.end.getHours() +
                            task.during.end.getMinutes() / 60;
                          const top =
                            (startHours - DEFAULT_START_HOUR) * HOUR_HEIGHT_PX;
                          const height =
                            (endHours - startHours) * HOUR_HEIGHT_PX;
                          const minHeight = isMobile ? 32 : 16;
                          const hasNotes =
                            task.notes !== null && task.notes.trim().length > 0;
                          const tooltip = hasNotes
                            ? `${task.taskName} (${task.status}) — ${task.notes}`
                            : `${task.taskName} (${task.status})`;

                          return (
                            <button
                              key={task.id}
                              type="button"
                              className="absolute left-1 right-1 z-10 overflow-hidden rounded border border-blue-300 bg-blue-100 px-1.5 py-0.5 text-left text-xs text-blue-900 transition-colors hover:bg-blue-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring dark:border-blue-700 dark:bg-blue-900/30 dark:text-blue-200 dark:hover:bg-blue-900/50"
                              style={{
                                top,
                                height: Math.max(height, minHeight),
                              }}
                              title={tooltip}
                              onClick={() => onTaskSelect?.(task.id)}
                            >
                              <div className="flex items-center gap-1">
                                <span className="truncate font-medium">
                                  {task.taskName}
                                </span>
                                {hasNotes && (
                                  <StickyNote
                                    className="size-3 shrink-0 opacity-70"
                                    aria-label="Has notes"
                                  />
                                )}
                              </div>
                              {height > 24 && (
                                <div className="truncate text-xs opacity-70">
                                  {task.during.start.toLocaleTimeString([], {
                                    hour: "numeric",
                                    minute: "2-digit",
                                  })}{" "}
                                  -{" "}
                                  {task.during.end.toLocaleTimeString([], {
                                    hour: "numeric",
                                    minute: "2-digit",
                                  })}
                                </div>
                              )}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  );
                })}
              </>
            )}
          {axis === "rooms" && rooms.length === 0 && (
            <div className="flex flex-1 items-center justify-center p-12 text-sm text-muted-foreground">
              {t("noRooms")}
            </div>
          )}
          {axis === "people" && staff.length === 0 && (
            <div className="flex flex-1 items-center justify-center p-12 text-sm text-muted-foreground">
              {t("dayView.noStaff")}
            </div>
          )}
        </div>
      </div>
    </DndContext>
  );
}

function AssistantSlotGrid({
  assistant,
  currentDate,
  onAddAssistantTask,
}: {
  assistant: StaffMember;
  currentDate: Date;
  onAddAssistantTask: (assistant: StaffMember, startTime: Date) => void;
}) {
  const totalSlots =
    ((DEFAULT_END_HOUR - DEFAULT_START_HOUR) * 60) / SLOT_DURATION_MINUTES;
  const [focusedSlot, setFocusedSlot] = useState(0);

  function buildTime(minutes: number) {
    const time = new Date(currentDate);
    time.setHours(Math.floor(minutes / 60), minutes % 60, 0, 0);
    return time;
  }

  return (
    <div role="grid" aria-label={`Task schedule for ${assistant.displayName}`}>
      {Array.from({ length: totalSlots }).map((_, index) => {
        const minutes = DEFAULT_START_HOUR * 60 + index * SLOT_DURATION_MINUTES;
        const hour = Math.floor(minutes / 60);
        const min = minutes % 60;
        const period = hour >= 12 ? "PM" : "AM";
        const displayHour = hour % 12 || 12;
        const timeLabel = `${displayHour}:${String(min).padStart(2, "0")} ${period}`;

        return (
          <div
            key={`${assistant.id}-${minutes}`}
            role="row"
            className="absolute left-0 right-0"
            style={{
              top: index * SLOT_HEIGHT_PX,
              height: SLOT_HEIGHT_PX,
            }}
          >
          <button
            type="button"
            role="gridcell"
            id={`assistant-slot-${assistant.id}-${index}`}
            tabIndex={focusedSlot === index ? 0 : -1}
            aria-label={`Add task for ${assistant.displayName} at ${timeLabel}`}
            className="h-full w-full cursor-pointer hover:bg-blue-500/10 focus-visible:z-20 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
            onClick={() => onAddAssistantTask(assistant, buildTime(minutes))}
            onFocus={() => setFocusedSlot(index)}
            onKeyDown={(e) => {
              let nextIndex: number | null = null;
              switch (e.key) {
                case "ArrowDown":
                  e.preventDefault();
                  nextIndex = Math.min(index + 1, totalSlots - 1);
                  break;
                case "ArrowUp":
                  e.preventDefault();
                  nextIndex = Math.max(index - 1, 0);
                  break;
                case "Enter":
                case " ":
                  e.preventDefault();
                  onAddAssistantTask(assistant, buildTime(minutes));
                  return;
              }
              if (nextIndex !== null) {
                setFocusedSlot(nextIndex);
                document
                  .getElementById(`assistant-slot-${assistant.id}-${nextIndex}`)
                  ?.focus();
              }
            }}
          />
          </div>
        );
      })}
    </div>
  );
}
