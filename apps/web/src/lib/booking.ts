import type { BookingInput } from "@openturnly/core";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ApiError, api, type BookingResult, type PaymentState, type PublicCatalog } from "./api.ts";

export function usePublicCatalog(slug: string) {
  return useQuery({
    queryKey: ["public", slug],
    queryFn: () => api<PublicCatalog>(`/api/public/businesses/${slug}`),
    retry: false,
  });
}

export function useAvailability(
  slug: string,
  params: {
    locationId: string | null;
    serviceId: string;
    resourceId: string | null;
    from: string;
    to: string;
  } | null,
) {
  return useQuery({
    queryKey: ["public", slug, "availability", params],
    enabled: params !== null && params.from <= params.to,
    queryFn: async () => {
      const query = new URLSearchParams({
        locationId: params?.locationId ?? "",
        serviceId: params?.serviceId ?? "",
        resourceId: params?.resourceId ?? "",
        from: params?.from ?? "",
        to: params?.to ?? "",
      });
      // days: free times per date; staff: who is free at each of those times.
      return api<{
        days: Record<string, string[]>;
        staff: Record<string, Record<string, string[]>>;
      }>(`/api/public/businesses/${slug}/availability?${query}`);
    },
  });
}

/** Books with a solved anti-bot proof from `takeProof`, getting a fresh one once if refused. */
export function useBook(slug: string, takeProof: () => Promise<string>) {
  const queryClient = useQueryClient();
  const send = async (input: BookingInput) =>
    api<BookingResult>(`/api/public/businesses/${slug}/bookings`, {
      method: "POST",
      body: { ...input, proof: await takeProof() },
    });
  return useMutation({
    mutationFn: async (input: BookingInput) => {
      try {
        return await send(input);
      } catch (error) {
        // Expired, or the business just switched to harder puzzles: one more try.
        if (error instanceof ApiError && error.code === "challenge_failed") return send(input);
        throw error;
      }
    },
    // Times change after any booking attempt, successful or not.
    onSettled: () => queryClient.invalidateQueries({ queryKey: ["public", slug, "availability"] }),
  });
}

/** A payment the customer is making or just made: asked again until it's decided. */
export function usePaymentState(slug: string, paymentId: string) {
  return useQuery({
    queryKey: ["public", slug, "payment", paymentId],
    queryFn: () => api<PaymentState>(`/api/public/businesses/${slug}/payments/${paymentId}`),
    retry: false,
    refetchInterval: (query) => (query.state.data?.payment.status === "pending" ? 3_000 : false),
  });
}

/** Gives up on a payment, which frees its time. It stays paid if the money already arrived. */
export function useCancelPayment(slug: string, paymentId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () =>
      api<PaymentState>(`/api/public/businesses/${slug}/payments/${paymentId}/cancel`, {
        method: "POST",
      }),
    onSuccess: (state) => {
      queryClient.setQueryData(["public", slug, "payment", paymentId], state);
    },
  });
}

/** Whether a discount code works for a service on the booking page, and how much it takes off. */
export function useGiftCodeCheck(slug: string) {
  return useMutation({
    mutationFn: (input: { code: string; serviceId: string }) =>
      api<{ code: string; discountAmount: number; priceAmount: number }>(
        `/api/public/businesses/${slug}/gift-code`,
        { method: "POST", body: input },
      ),
  });
}
