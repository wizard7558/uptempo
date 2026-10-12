"use client";

import { useState, useEffect, useCallback } from "react";
import { fetchMultiServiceDuration } from "@/actions/services";
import type { ServiceDurationInfo } from "@/lib/services/duration";

interface Client {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
}

interface BookingFormState {
  selectedClient: Client | null;
  selectedServiceIds: string[];
  startTime: Date | null;
  staffId: string | null;
  locationId: string | null;
  isSubmitting: boolean;
  durationInfo: {
    services: ServiceDurationInfo[];
    totalMinutes: number;
  } | null;
  isLoadingDuration: boolean;
}

export function useBookingForm(initialStaffId?: string | null, initialStartTime?: Date | null) {
  const [state, setState] = useState<BookingFormState>({
    selectedClient: null,
    selectedServiceIds: [],
    startTime: initialStartTime ?? null,
    staffId: initialStaffId ?? null,
    locationId: null,
    isSubmitting: false,
    durationInfo: null,
    isLoadingDuration: false,
  });

  const setClient = useCallback((client: Client | null) => {
    setState((prev) => ({ ...prev, selectedClient: client }));
  }, []);

  const addService = useCallback((serviceId: string) => {
    setState((prev) => ({
      ...prev,
      selectedServiceIds: prev.selectedServiceIds.includes(serviceId)
        ? prev.selectedServiceIds
        : [...prev.selectedServiceIds, serviceId],
    }));
  }, []);

  const removeService = useCallback((serviceId: string) => {
    setState((prev) => ({
      ...prev,
      selectedServiceIds: prev.selectedServiceIds.filter(
        (id) => id !== serviceId,
      ),
    }));
  }, []);

  const toggleService = useCallback((serviceId: string) => {
    setState((prev) => ({
      ...prev,
      selectedServiceIds: prev.selectedServiceIds.includes(serviceId)
        ? prev.selectedServiceIds.filter((id) => id !== serviceId)
        : [...prev.selectedServiceIds, serviceId],
    }));
  }, []);

  const setStartTime = useCallback((time: Date | null) => {
    setState((prev) => ({ ...prev, startTime: time }));
  }, []);

  const setStaffId = useCallback((id: string | null) => {
    setState((prev) => ({ ...prev, staffId: id, locationId: null }));
  }, []);

  const setLocationId = useCallback((id: string | null) => {
    setState((prev) => ({ ...prev, locationId: id }));
  }, []);

  const setSubmitting = useCallback((isSubmitting: boolean) => {
    setState((prev) => ({ ...prev, isSubmitting }));
  }, []);

  const reset = useCallback(() => {
    setState({
      selectedClient: null,
      selectedServiceIds: [],
      startTime: null,
      staffId: null,
      locationId: null,
      isSubmitting: false,
      durationInfo: null,
      isLoadingDuration: false,
    });
  }, []);

  // Fetch duration info when services, client, or stylist change.
  // Stylist is included so per-stylist price/duration overrides apply.
  useEffect(() => {
    if (state.selectedServiceIds.length === 0) {
      setState((prev) => ({ ...prev, durationInfo: null }));
      return;
    }

    if (!state.selectedClient) {
      setState((prev) => ({ ...prev, durationInfo: null }));
      return;
    }

    let cancelled = false;
    setState((prev) => ({ ...prev, isLoadingDuration: true }));

    fetchMultiServiceDuration(
      state.selectedServiceIds,
      state.selectedClient.id,
      state.staffId,
    )
      .then((info) => {
        if (!cancelled) {
          setState((prev) => ({
            ...prev,
            durationInfo: info,
            isLoadingDuration: false,
          }));
        }
      })
      .catch(() => {
        if (!cancelled) {
          setState((prev) => ({ ...prev, isLoadingDuration: false }));
        }
      });

    return () => {
      cancelled = true;
    };
  }, [state.selectedServiceIds, state.selectedClient, state.staffId]);

  return {
    ...state,
    setClient,
    addService,
    removeService,
    toggleService,
    setStartTime,
    setStaffId,
    setLocationId,
    setSubmitting,
    reset,
  };
}
