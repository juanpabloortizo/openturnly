import type { CustomerAdminInput } from "@openturnly/core";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, type Customer, type CustomerAppointment, type CustomerSummary } from "./api.ts";
import { businessKeys } from "./catalog.ts";

function customerKeys(businessId: string) {
  const { base } = businessKeys(businessId);
  return { base: `${base}/customers`, all: ["businesses", businessId, "customers"] as const };
}

export function useCustomers(businessId: string) {
  const { base, all } = customerKeys(businessId);
  return useQuery({
    queryKey: all,
    queryFn: async () => (await api<{ customers: CustomerSummary[] }>(base)).customers,
  });
}

/** One customer with their appointments, newest first. */
export function useCustomer(businessId: string, customerId: string | null) {
  const { base, all } = customerKeys(businessId);
  return useQuery({
    queryKey: [...all, customerId],
    queryFn: () =>
      api<{ customer: Customer; appointments: CustomerAppointment[] }>(`${base}/${customerId}`),
    enabled: customerId !== null,
  });
}

export function useCustomerMutations(businessId: string) {
  const { base, all } = customerKeys(businessId);
  const { keys } = businessKeys(businessId);
  const queryClient = useQueryClient();
  const onSuccess = () => {
    queryClient.invalidateQueries({ queryKey: all });
    // The agenda shows customer names and disappears their appointments on delete.
    queryClient.invalidateQueries({ queryKey: keys.appointments });
  };
  return {
    save: useMutation({
      mutationFn: ({ id, input }: { id?: string; input: CustomerAdminInput }) =>
        id
          ? api<{ customer: Customer }>(`${base}/${id}`, { method: "PATCH", body: input })
          : api<{ customer: Customer }>(base, { method: "POST", body: input }),
      onSuccess,
    }),
    remove: useMutation({
      mutationFn: (id: string) => api(`${base}/${id}`, { method: "DELETE" }),
      onSuccess,
    }),
    /** Moves `id`'s appointments into `intoId` and deletes `id`. */
    merge: useMutation({
      mutationFn: ({ id, intoId }: { id: string; intoId: string }) =>
        api<{ customer: Customer }>(`${base}/${id}/merge`, { method: "POST", body: { intoId } }),
      onSuccess,
    }),
  };
}
