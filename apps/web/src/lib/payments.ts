import type { PaymentConnectionInput } from "@openturnly/core";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, type PaymentOverview } from "./api.ts";

const key = (businessId: string) => ["businesses", businessId, "payments"] as const;

export function usePayments(businessId: string) {
  return useQuery({
    queryKey: key(businessId),
    queryFn: () => api<PaymentOverview>(`/api/businesses/${businessId}/payments`),
  });
}

export function usePaymentMutations(businessId: string) {
  const queryClient = useQueryClient();
  const refresh = () => queryClient.invalidateQueries({ queryKey: key(businessId) });
  const base = `/api/businesses/${businessId}/payments`;
  return {
    connect: useMutation({
      mutationFn: (body: PaymentConnectionInput) =>
        api<PaymentOverview>(base, { method: "PUT", body }),
      onSuccess: refresh,
    }),
    disconnect: useMutation({
      mutationFn: () => api<PaymentOverview>(base, { method: "DELETE" }),
      onSuccess: refresh,
    }),
  };
}
