import type {
  ClosureInput,
  ProfessionalInput,
  ServiceInput,
  StaffBookingInput,
  WeeklyHoursInput,
} from "@openturnly/core";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  type Appointment,
  api,
  type Closure,
  type CustomerSummary,
  type HolidaySettings,
  type Professional,
  type Service,
  type WeeklyRange,
} from "./api.ts";

/** Endpoints and query keys for one business. */
export function businessKeys(businessId: string) {
  const base = `/api/businesses/${businessId}`;
  const keys = {
    services: ["businesses", businessId, "services"],
    professionals: ["businesses", businessId, "professionals"],
    hours: ["businesses", businessId, "hours"],
    closures: ["businesses", businessId, "closures"],
    appointments: ["businesses", businessId, "appointments"],
    holidays: ["businesses", businessId, "holidays"],
  } as const;
  return { base, keys };
}

export function useServices(businessId: string) {
  const { base, keys } = businessKeys(businessId);
  return useQuery({
    queryKey: keys.services,
    queryFn: async () => (await api<{ services: Service[] }>(`${base}/services`)).services,
  });
}

export function useServiceMutations(businessId: string) {
  const { base, keys } = businessKeys(businessId);
  const queryClient = useQueryClient();
  const onSuccess = () => {
    queryClient.invalidateQueries({ queryKey: keys.services });
    queryClient.invalidateQueries({ queryKey: keys.professionals });
  };
  return {
    save: useMutation({
      mutationFn: ({ id, input }: { id?: string; input: ServiceInput }) =>
        id
          ? api(`${base}/services/${id}`, { method: "PATCH", body: input })
          : api(`${base}/services`, { method: "POST", body: input }),
      onSuccess,
    }),
    remove: useMutation({
      mutationFn: (id: string) => api(`${base}/services/${id}`, { method: "DELETE" }),
      onSuccess,
    }),
  };
}

export function useProfessionals(businessId: string) {
  const { base, keys } = businessKeys(businessId);
  return useQuery({
    queryKey: keys.professionals,
    queryFn: async () =>
      (await api<{ professionals: Professional[] }>(`${base}/professionals`)).professionals,
  });
}

export function useProfessionalMutations(businessId: string) {
  const { base, keys } = businessKeys(businessId);
  const queryClient = useQueryClient();
  const onSuccess = () => {
    queryClient.invalidateQueries({ queryKey: keys.professionals });
    queryClient.invalidateQueries({ queryKey: keys.hours });
  };
  return {
    /** Saves the professional, then their hours (empty list = business hours). */
    save: useMutation({
      mutationFn: async ({
        id,
        input,
        hours,
      }: {
        id?: string;
        input: ProfessionalInput;
        hours: WeeklyRange[];
      }) => {
        const { professional } = id
          ? await api<{ professional: { id: string } }>(`${base}/professionals/${id}`, {
              method: "PATCH",
              body: input,
            })
          : await api<{ professional: { id: string } }>(`${base}/professionals`, {
              method: "POST",
              body: input,
            });
        const body: WeeklyHoursInput = { resourceId: professional.id, hours };
        await api(`${base}/hours`, { method: "PUT", body });
        return professional;
      },
      onSuccess,
    }),
    remove: useMutation({
      mutationFn: (id: string) => api(`${base}/professionals/${id}`, { method: "DELETE" }),
      onSuccess,
    }),
  };
}

export function useHours(businessId: string) {
  const { base, keys } = businessKeys(businessId);
  return useQuery({
    queryKey: keys.hours,
    queryFn: () =>
      api<{ business: WeeklyRange[]; professionals: Record<string, WeeklyRange[]> }>(
        `${base}/hours`,
      ),
  });
}

export function useSaveHours(businessId: string) {
  const { base, keys } = businessKeys(businessId);
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: WeeklyHoursInput) => api(`${base}/hours`, { method: "PUT", body }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: keys.hours }),
  });
}

export function useClosures(businessId: string) {
  const { base, keys } = businessKeys(businessId);
  const queryClient = useQueryClient();
  const onSuccess = () => queryClient.invalidateQueries({ queryKey: keys.closures });
  return {
    list: useQuery({
      queryKey: keys.closures,
      queryFn: async () => (await api<{ closures: Closure[] }>(`${base}/closures`)).closures,
    }),
    add: useMutation({
      mutationFn: (body: ClosureInput) => api(`${base}/closures`, { method: "POST", body }),
      onSuccess,
    }),
    remove: useMutation({
      mutationFn: (id: string) => api(`${base}/closures/${id}`, { method: "DELETE" }),
      onSuccess,
    }),
  };
}

export function useAppointments(
  businessId: string,
  range: { from: string; to: string } | null,
  { includeCancelled = false } = {},
) {
  const { base, keys } = businessKeys(businessId);
  return useQuery({
    queryKey: [...keys.appointments, range, includeCancelled],
    enabled: range !== null,
    queryFn: async () => {
      const query = new URLSearchParams({
        from: range?.from ?? "",
        to: range?.to ?? "",
        ...(includeCancelled ? { includeCancelled: "true" } : {}),
      });
      return (await api<{ appointments: Appointment[] }>(`${base}/appointments?${query}`))
        .appointments;
    },
  });
}

/** Free times on `date` for a new appointment, with who is free at each. */
export function useNewAppointmentSlots(businessId: string, serviceId: string | null, date: string) {
  const { base, keys } = businessKeys(businessId);
  return useQuery({
    queryKey: [...keys.appointments, "slots", serviceId, date],
    enabled: serviceId !== null,
    queryFn: async () =>
      (
        await api<{ slots: { time: string; resourceIds: string[] }[] }>(
          `${base}/appointments/slots?serviceId=${serviceId}&date=${date}`,
        )
      ).slots,
  });
}

export function useCreateAppointment(businessId: string) {
  const { base, keys } = businessKeys(businessId);
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: StaffBookingInput) =>
      api<{ appointment: Appointment }>(`${base}/appointments`, { method: "POST", body: input }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: keys.appointments });
      queryClient.invalidateQueries({ queryKey: ["businesses", businessId, "customers"] });
    },
  });
}

/** Customers matching a name, phone or email, for picking one in a form. */
export function useCustomerSearch(businessId: string, query: string) {
  const { base } = businessKeys(businessId);
  const q = query.trim();
  return useQuery({
    queryKey: ["businesses", businessId, "customers", "search", q],
    enabled: q.length >= 2,
    queryFn: async () =>
      (await api<{ customers: CustomerSummary[] }>(`${base}/customers?q=${encodeURIComponent(q)}`))
        .customers,
    placeholderData: (previous) => previous,
  });
}

/** Times an appointment could move to on `date` for `serviceId`, with who is free at each. */
export function useAppointmentSlots(
  businessId: string,
  appointmentId: string,
  serviceId: string | null,
  date: string,
) {
  const { base, keys } = businessKeys(businessId);
  return useQuery({
    queryKey: [...keys.appointments, appointmentId, "slots", serviceId, date],
    enabled: serviceId !== null,
    queryFn: async () =>
      (
        await api<{ slots: { time: string; resourceIds: string[] }[] }>(
          `${base}/appointments/${appointmentId}/slots?serviceId=${serviceId}&date=${date}`,
        )
      ).slots,
  });
}

export function useRescheduleAppointment(businessId: string) {
  const { base, keys } = businessKeys(businessId);
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      id,
      ...body
    }: {
      id: string;
      serviceId: string;
      resourceId: string | null;
      date: string;
      time: string;
    }) => api(`${base}/appointments/${id}`, { method: "PATCH", body }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: keys.appointments });
      // Customer histories show the appointment too.
      queryClient.invalidateQueries({ queryKey: ["businesses", businessId, "customers"] });
    },
  });
}

export function useCancelAppointment(businessId: string) {
  const { base, keys } = businessKeys(businessId);
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      api(`${base}/appointments/${id}/cancel`, { method: "POST", body: {} }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: keys.appointments }),
  });
}

export function useHolidays(businessId: string, language: string) {
  const { base, keys } = businessKeys(businessId);
  const queryClient = useQueryClient();
  return {
    list: useQuery({
      queryKey: [...keys.holidays, language],
      queryFn: () => api<HolidaySettings>(`${base}/holidays?lang=${language}`),
    }),
    decide: useMutation({
      mutationFn: ({ date, closed }: { date: string; closed: boolean }) =>
        api(`${base}/holidays/${date}`, { method: "PUT", body: { closed } }),
      onSuccess: () => queryClient.invalidateQueries({ queryKey: keys.holidays }),
    }),
  };
}
