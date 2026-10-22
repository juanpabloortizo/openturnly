import type { BookingInput } from "@openturnly/core";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ApiError, api, type BookedAppointment, type PublicCatalog } from "./api.ts";

export function usePublicCatalog(slug: string) {
  return useQuery({
    queryKey: ["public", slug],
    queryFn: () => api<PublicCatalog>(`/api/public/businesses/${slug}`),
    retry: false,
  });
}

export function useAvailability(
  slug: string,
  params: { serviceId: string; resourceId: string | null; from: string; to: string } | null,
) {
  return useQuery({
    queryKey: ["public", slug, "availability", params],
    enabled: params !== null && params.from <= params.to,
    queryFn: async () => {
      const query = new URLSearchParams({
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
    (
      await api<{ appointment: BookedAppointment }>(`/api/public/businesses/${slug}/bookings`, {
        method: "POST",
        body: { ...input, proof: await takeProof() },
      })
    ).appointment;
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
