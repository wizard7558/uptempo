"use client";

import { useT } from "@/lib/terms/client";
import { useReducer, useCallback, useEffect, useMemo } from "react";
import { ProgressBar } from "@/components/booking-public/progress-bar";
import { ServiceStep } from "@/components/booking-public/service-step";
import { TimeStep } from "@/components/booking-public/time-step";
import { DetailsStep } from "@/components/booking-public/details-step";
import { ConfirmPayStep } from "@/components/booking-public/confirm-pay-step";
import { SuccessView } from "@/components/booking-public/success-view";
import { getClientPaymentMethod } from "@/actions/stripe";
import { servicesNeedAddress } from "@/actions/booking-public";
import { trackClientEvent } from "@/lib/analytics/posthog-provider";
import type { BookingVerificationChannel } from "@/lib/booking/verification-channel";

export const SLOT_NO_LONGER_FITS_MESSAGE =
  "That time no longer fits your visit. Pick another time.";

type WizardStep = "service" | "time" | "details" | "confirm";

interface BookingResult {
  id: string;
  staffName: string;
  services: { name: string; durationMinutes: number }[];
  start: string;
  end: string;
  totalDuration: number;
  locationName?: string | null;
  locationAddress?: string | null;
  depositCents?: number;
  depositCharged?: boolean;
}

export interface BookingState {
  currentStep: WizardStep;
  completedSteps: WizardStep[];
  clientId: string | null;
  clientName: string | null;
  clientPhone: string | null;
  staffId: string | null;
  staffName: string | null;
  assignedStaffId: string | null;
  assignedStaffName: string | null;
  serviceIds: string[];
  serviceSummary: string;
  totalDuration: number;
  locationId: string | null;
  locationName: string | null;
  locationAddress: string | null;
  needsAddress: boolean | null;
  serviceAddressId: string | null;
  selectedDate: string | null;
  selectedTime: string | null;
  isDoubleBook: boolean;
  doubleBookParentAppointmentId: string | null;
  timeNotice: string | null;
  bookingResult: BookingResult | null;
  hasCardOnFile: boolean;
  requireCardOnFile: boolean;
}

interface PrefillParams {
  staffId?: string;
  serviceIds?: string[];
  appointmentId?: string;
  staffName?: string;
  serviceSummary?: string;
  totalDuration?: number;
}

interface ClientSession {
  clientId: string;
  clientName: string;
  clientPhone?: string | null;
}

export type BookingAction =
  | { type: "GO_TO_STEP"; step: WizardStep }
  | {
      type: "SET_SERVICE";
      staffId: string;
      staffName: string;
      serviceIds: string[];
      serviceSummary: string;
      totalDuration: number;
      needsAddress: boolean;
    }
  | { type: "SET_NEEDS_ADDRESS"; needsAddress: boolean }
  | { type: "SET_ADDRESS"; addressId: string }
  | {
      type: "SET_LOCATION";
      locationId: string | null;
      locationName: string;
      locationAddress?: string | null;
    }
  | {
      type: "SET_TIME";
      date: string;
      time: string;
      isDoubleBook?: boolean;
      doubleBookParentAppointmentId?: string | null;
      assignedStaffId?: string;
      assignedStaffName?: string | null;
    }
  | { type: "SET_CLIENT"; clientId: string; clientName: string; clientPhone: string | null }
  | { type: "ACK_CLIENT" }
  | { type: "CLEAR_CLIENT" }
  | { type: "SLOT_NO_LONGER_FITS" }
  | { type: "SET_BOOKING_RESULT"; result: BookingResult }
  | { type: "SET_PAYMENT_INFO"; hasCardOnFile: boolean; requireCardOnFile: boolean }
  | { type: "CARD_SAVED" }
  | {
      type: "APPLY_PREFILL";
      staffId: string;
      serviceIds: string[];
      staffName?: string;
      serviceSummary?: string;
      totalDuration?: number;
    }
  | { type: "RESET" }
  | { type: "RESET_KEEP_CLIENT" };

const STEPS: WizardStep[] = ["service", "time", "details", "confirm"];

function withStep(completed: WizardStep[], step: WizardStep): WizardStep[] {
  return completed.includes(step) ? completed : [...completed, step];
}

function blankVisit(): Pick<
  BookingState,
  | "assignedStaffId"
  | "assignedStaffName"
  | "selectedDate"
  | "selectedTime"
  | "isDoubleBook"
  | "doubleBookParentAppointmentId"
  | "timeNotice"
> {
  return {
    assignedStaffId: null,
    assignedStaffName: null,
    selectedDate: null,
    selectedTime: null,
    isDoubleBook: false,
    doubleBookParentAppointmentId: null,
    timeNotice: null,
  };
}

export function createInitialState(
  clientSession: ClientSession | null,
  prefill?: PrefillParams,
): BookingState {
  const base: BookingState = {
    currentStep: "service",
    completedSteps: [],
    clientId: null,
    clientName: null,
    clientPhone: null,
    staffId: null,
    staffName: null,
    assignedStaffId: null,
    assignedStaffName: null,
    serviceIds: [],
    serviceSummary: "",
    totalDuration: 0,
    locationId: null,
    locationName: null,
    locationAddress: null,
    needsAddress: false,
    serviceAddressId: null,
    selectedDate: null,
    selectedTime: null,
    isDoubleBook: false,
    doubleBookParentAppointmentId: null,
    timeNotice: null,
    bookingResult: null,
    hasCardOnFile: false,
    requireCardOnFile: true,
  };

  if (clientSession) {
    base.clientId = clientSession.clientId;
    base.clientName = clientSession.clientName;
    base.clientPhone = clientSession.clientPhone ?? null;
  }

  if (prefill?.staffId && prefill.serviceIds?.length) {
    base.staffId = prefill.staffId;
    base.staffName = prefill.staffName ?? null;
    base.serviceIds = prefill.serviceIds;
    base.serviceSummary = prefill.serviceSummary ?? "";
    base.totalDuration = prefill.totalDuration ?? 0;
    base.needsAddress = null;
    base.completedSteps = ["service"];
    base.currentStep = "time";
  }

  return base;
}

export function bookingReducer(state: BookingState, action: BookingAction): BookingState {
  switch (action.type) {
    case "GO_TO_STEP": {
      const targetIndex = STEPS.indexOf(action.step);
      const currentIndex = STEPS.indexOf(state.currentStep);
      if (targetIndex <= currentIndex || state.completedSteps.includes(action.step)) {
        return { ...state, currentStep: action.step };
      }
      return state;
    }

    case "SET_SERVICE": {
      const staffChanged = state.staffId != null && state.staffId !== action.staffId;
      return {
        ...state,
        staffId: action.staffId,
        staffName: action.staffName,
        serviceIds: action.serviceIds,
        serviceSummary: action.serviceSummary,
        totalDuration: action.totalDuration,
        needsAddress: action.needsAddress,
        serviceAddressId: null,
        locationId: staffChanged ? null : state.locationId,
        locationName: staffChanged ? null : state.locationName,
        locationAddress: staffChanged ? null : state.locationAddress,
        ...blankVisit(),
        completedSteps: ["service"],
        currentStep: "time",
      };
    }

    case "SET_NEEDS_ADDRESS":
      return { ...state, needsAddress: action.needsAddress };

    case "SET_ADDRESS":
      return {
        ...state,
        serviceAddressId: action.addressId,
        ...blankVisit(),
        completedSteps: state.completedSteps.filter(
          (step) => step !== "time" && step !== "details" && step !== "confirm",
        ),
        currentStep: "time",
      };

    case "SET_LOCATION": {
      const locationChanged = state.locationId !== action.locationId;
      return {
        ...state,
        locationId: action.locationId,
        locationName: action.locationName,
        locationAddress: action.locationAddress ?? null,
        selectedDate: locationChanged ? null : state.selectedDate,
        selectedTime: locationChanged ? null : state.selectedTime,
        isDoubleBook: locationChanged ? false : state.isDoubleBook,
        doubleBookParentAppointmentId: locationChanged
          ? null
          : state.doubleBookParentAppointmentId,
        completedSteps: locationChanged
          ? state.completedSteps.filter(
              (step) => step !== "time" && step !== "details" && step !== "confirm",
            )
          : state.completedSteps,
        currentStep: "time",
      };
    }

    case "SET_TIME": {
      const nextIsDoubleBook = action.isDoubleBook ?? false;
      return {
        ...state,
        selectedDate: action.date,
        selectedTime: action.time,
        isDoubleBook: nextIsDoubleBook,
        assignedStaffId: action.assignedStaffId ?? null,
        assignedStaffName: action.assignedStaffName ?? null,
        doubleBookParentAppointmentId: nextIsDoubleBook
          ? action.doubleBookParentAppointmentId ?? null
          : null,
        timeNotice: null,
        completedSteps: withStep(state.completedSteps, "time"),
        currentStep: "details",
      };
    }

    case "SET_CLIENT":
      return {
        ...state,
        clientId: action.clientId,
        clientName: action.clientName,
        clientPhone: action.clientPhone,
        completedSteps: withStep(state.completedSteps, "details"),
        currentStep: "confirm",
      };

    case "ACK_CLIENT":
      return {
        ...state,
        completedSteps: withStep(state.completedSteps, "details"),
        currentStep: "confirm",
      };

    case "CLEAR_CLIENT":
      return {
        ...state,
        clientId: null,
        clientName: null,
        clientPhone: null,
        completedSteps: state.completedSteps.filter(
          (step) => step !== "details" && step !== "confirm",
        ),
        currentStep: "details",
      };

    case "SLOT_NO_LONGER_FITS":
      return {
        ...state,
        currentStep: "time",
        selectedTime: null,
        isDoubleBook: false,
        doubleBookParentAppointmentId: null,
        timeNotice: SLOT_NO_LONGER_FITS_MESSAGE,
        completedSteps: state.completedSteps.filter(
          (step) => step !== "time" && step !== "details" && step !== "confirm",
        ),
      };

    case "SET_BOOKING_RESULT":
      return {
        ...state,
        bookingResult: action.result,
        completedSteps: withStep(state.completedSteps, "confirm"),
      };

    case "SET_PAYMENT_INFO":
      return {
        ...state,
        hasCardOnFile: action.hasCardOnFile,
        requireCardOnFile: action.requireCardOnFile,
      };

    case "CARD_SAVED":
      return { ...state, hasCardOnFile: true };

    case "APPLY_PREFILL":
      return {
        ...state,
        staffId: action.staffId,
        staffName: action.staffName ?? null,
        serviceIds: action.serviceIds,
        serviceSummary: action.serviceSummary ?? "",
        totalDuration: action.totalDuration ?? 0,
        needsAddress: null,
        serviceAddressId: null,
        ...blankVisit(),
        completedSteps: withStep(state.completedSteps, "service"),
        currentStep: "time",
      };

    case "RESET":
      return createInitialState(null);

    case "RESET_KEEP_CLIENT": {
      if (state.clientId && state.clientName) {
        const base = createInitialState({
          clientId: state.clientId,
          clientName: state.clientName,
          clientPhone: state.clientPhone,
        });
        return {
          ...base,
          hasCardOnFile: state.hasCardOnFile,
          requireCardOnFile: state.requireCardOnFile,
        };
      }
      return createInitialState(null);
    }

    default:
      return state;
  }
}

interface BookingWizardProps {
  salonId: string;
  salonSlug: string;
  salonName: string;
  hasSalonLogo: boolean;
  salonTimezone: string;
  requireCardOnFile: boolean;
  clientSession: ClientSession | null;
  waitlistEnabled?: boolean;
  clientPhone?: string | null;
  verificationChannel?: BookingVerificationChannel;
  prefillStaffId?: string;
  prefillServiceIds?: string[];
  prefillStaffName?: string;
  prefillServiceSummary?: string;
  prefillTotalDuration?: number;
  prefillLocationId?: string;
  reschedulingAppointmentId?: string;
}

function rethrowAuth(err: unknown): void {
  if (err instanceof Error && err.name === "AuthError") throw err;
}

export function BookingWizard({
  salonId,
  salonSlug,
  salonName,
  hasSalonLogo,
  salonTimezone,
  requireCardOnFile,
  clientSession,
  waitlistEnabled = false,
  clientPhone = null,
  verificationChannel = "phone",
  prefillStaffId,
  prefillServiceIds,
  prefillStaffName,
  prefillServiceSummary,
  prefillTotalDuration,
  prefillLocationId,
  reschedulingAppointmentId,
}: BookingWizardProps) {
  const t = useT("booking");
  const stepLabels = [
    t("bookingWizard.stepService"),
    t("bookingWizard.stepTime"),
    t("bookingWizard.stepDetails"),
    t("bookingWizard.stepConfirm"),
  ];
  const prefill = useMemo<PrefillParams | undefined>(
    () =>
      prefillStaffId && prefillServiceIds?.length
        ? {
            staffId: prefillStaffId,
            serviceIds: prefillServiceIds,
            appointmentId: reschedulingAppointmentId,
            staffName: prefillStaffName,
            serviceSummary: prefillServiceSummary,
            totalDuration: prefillTotalDuration,
          }
        : undefined,
    [
      prefillStaffId,
      prefillServiceIds,
      reschedulingAppointmentId,
      prefillStaffName,
      prefillServiceSummary,
      prefillTotalDuration,
    ],
  );

  const [state, dispatch] = useReducer(
    bookingReducer,
    { clientSession, prefill, requireCardOnFile },
    (init) => {
      const next = createInitialState(init.clientSession, init.prefill);
      next.requireCardOnFile = init.requireCardOnFile;
      return next;
    },
  );

  const currentStepIndex = STEPS.indexOf(state.currentStep);

  const handleStepClick = useCallback((stepIndex: number) => {
    const step = STEPS[stepIndex];
    if (step) dispatch({ type: "GO_TO_STEP", step });
  }, []);

  const handleBack = useCallback(() => {
    const previous = STEPS[currentStepIndex - 1];
    if (previous) dispatch({ type: "GO_TO_STEP", step: previous });
  }, [currentStepIndex]);

  const handleNotYou = useCallback(async () => {
    await fetch("/api/booking/clear-session", { method: "POST" });
    dispatch({ type: "CLEAR_CLIENT" });
  }, []);

  useEffect(() => {
    if (
      prefill?.staffId &&
      prefill.serviceIds?.length &&
      state.currentStep === "service" &&
      !state.staffId
    ) {
      dispatch({
        type: "APPLY_PREFILL",
        staffId: prefill.staffId,
        serviceIds: prefill.serviceIds,
        staffName: prefill.staffName,
        serviceSummary: prefill.serviceSummary,
        totalDuration: prefill.totalDuration,
      });
    }
  }, [prefill, state.currentStep, state.staffId]);

  useEffect(() => {
    if (state.needsAddress !== null || state.serviceIds.length === 0) return;
    let cancelled = false;
    servicesNeedAddress(state.serviceIds)
      .then((needsAddress) => {
        if (!cancelled) dispatch({ type: "SET_NEEDS_ADDRESS", needsAddress });
      })
      .catch((err) => {
        rethrowAuth(err);
        if (!cancelled) dispatch({ type: "SET_NEEDS_ADDRESS", needsAddress: false });
      });
    return () => {
      cancelled = true;
    };
  }, [state.needsAddress, state.serviceIds]);

  useEffect(() => {
    let cancelled = false;
    dispatch({
      type: "SET_PAYMENT_INFO",
      hasCardOnFile: false,
      requireCardOnFile,
    });
    if (!clientSession) return;
    getClientPaymentMethod(clientSession.clientId)
      .then((pmResult) => {
        if (cancelled) return;
        dispatch({
          type: "SET_PAYMENT_INFO",
          hasCardOnFile: pmResult.hasCard,
          requireCardOnFile,
        });
      })
      .catch((err) => {
        rethrowAuth(err);
      });
    return () => {
      cancelled = true;
    };
  }, [clientSession, requireCardOnFile]);

  if (state.bookingResult) {
    return (
      <div className="space-y-6">
        {hasSalonLogo ? (
          <h1 className="sr-only">{salonName}</h1>
        ) : (
          <div className="text-center">
            <h1 className="display text-4xl text-[var(--ink)]">{salonName}</h1>
          </div>
        )}
        <SuccessView
          booking={state.bookingResult}
          salonName={salonName}
          salonTimezone={salonTimezone}
          salonSlug={salonSlug}
          clientId={state.clientId}
          onBookAnother={() => dispatch({ type: "RESET_KEEP_CLIENT" })}
        />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {hasSalonLogo ? (
        <h1 className="sr-only">{salonName}</h1>
      ) : (
        <div className="text-center">
          <h1 className="display text-3xl text-[var(--ink)] sm:text-4xl">{salonName}</h1>
        </div>
      )}

      <ProgressBar
        steps={stepLabels}
        currentStep={currentStepIndex}
        completedSteps={new Set(state.completedSteps)}
        onStepClick={handleStepClick}
        stepKeys={STEPS}
      />

      {currentStepIndex > 0 && (
        <button
          type="button"
          onClick={handleBack}
          className="inline-flex min-h-11 items-center gap-1 text-[13px] text-[var(--ink)] underline"
        >
          <span aria-hidden>←</span>
          {t("wizard.back")}
        </button>
      )}

      <div>
        {state.currentStep === "service" && (
          <ServiceStep
            salonId={salonId}
            clientId={state.clientId}
            selectedStaffId={state.staffId}
            selectedServiceIds={state.serviceIds}
            onComplete={async (staffId, staffName, serviceIds, serviceSummary, totalDuration) => {
              let needsAddress = false;
              try {
                needsAddress = await servicesNeedAddress(serviceIds);
              } catch (err) {
                rethrowAuth(err);
              }
              dispatch({
                type: "SET_SERVICE",
                staffId,
                staffName,
                serviceIds,
                serviceSummary,
                totalDuration,
                needsAddress,
              });
            }}
          />
        )}

        {state.currentStep === "time" && state.staffId && (
          <TimeStep
            staffId={state.staffId}
            locationId={state.locationId}
            clientId={state.clientId}
            serviceAddressId={state.serviceAddressId}
            needsAddress={state.needsAddress}
            serviceIds={state.serviceIds}
            salonTimezone={salonTimezone}
            selectedDate={state.selectedDate}
            selectedTime={state.selectedTime}
            waitlistEnabled={waitlistEnabled}
            clientPhone={state.clientPhone ?? clientPhone}
            prefillLocationId={prefillLocationId}
            timeNotice={state.timeNotice}
            onLocation={(locationId, locationName, locationAddress) =>
              dispatch({
                type: "SET_LOCATION",
                locationId,
                locationName,
                locationAddress,
              })
            }
            onAddress={(addressId) => dispatch({ type: "SET_ADDRESS", addressId })}
            onComplete={(
              date,
              time,
              isDoubleBook,
              doubleBookParentAppointmentId,
              assignedStaffId,
              assignedStaffName,
            ) =>
              dispatch({
                type: "SET_TIME",
                date,
                time,
                isDoubleBook,
                doubleBookParentAppointmentId,
                assignedStaffId,
                assignedStaffName,
              })
            }
          />
        )}

        {state.currentStep === "details" && (
          <DetailsStep
            verificationChannel={verificationChannel}
            salonId={salonId}
            clientId={state.clientId}
            clientName={state.clientName}
            onComplete={(clientId, clientName, phone) =>
              dispatch({
                type: "SET_CLIENT",
                clientId,
                clientName,
                clientPhone: phone?.trim() ? phone.trim() : null,
              })
            }
            onContinue={() => dispatch({ type: "ACK_CLIENT" })}
            onNotYou={handleNotYou}
          />
        )}

        {state.currentStep === "confirm" &&
          state.staffId &&
          state.clientId &&
          state.selectedDate &&
          state.selectedTime && (
            <ConfirmPayStep
              salonId={salonId}
              salonSlug={salonSlug}
              salonName={salonName}
              salonTimezone={salonTimezone}
              staffId={state.assignedStaffId ?? state.staffId}
              staffName={
                state.assignedStaffName ?? state.staffName ?? t("bookingWizard.staffFallback")
              }
              anyStaff={state.staffId === "any"}
              serviceIds={state.serviceIds}
              serviceSummary={state.serviceSummary}
              totalDuration={state.totalDuration}
              clientId={state.clientId}
              clientPhone={state.clientPhone ?? clientPhone ?? undefined}
              locationId={state.locationId ?? undefined}
              serviceAddressId={state.serviceAddressId}
              locationName={state.locationName ?? undefined}
              locationAddress={state.locationAddress ?? undefined}
              selectedDate={state.selectedDate}
              selectedTime={state.selectedTime}
              isDoubleBook={state.isDoubleBook}
              doubleBookParentAppointmentId={state.doubleBookParentAppointmentId}
              hasCardOnFile={state.hasCardOnFile}
              requireCardOnFile={state.requireCardOnFile}
              onConfirm={(booking) => {
                trackClientEvent("booking.completed_client", {
                  salonName,
                  serviceCount: state.serviceIds.length,
                });
                dispatch({ type: "SET_BOOKING_RESULT", result: booking });
              }}
              onCardSaved={() => dispatch({ type: "CARD_SAVED" })}
              onSlotMismatch={() => dispatch({ type: "SLOT_NO_LONGER_FITS" })}
              onJustTaken={() => dispatch({ type: "GO_TO_STEP", step: "time" })}
            />
          )}
      </div>
    </div>
  );
}
