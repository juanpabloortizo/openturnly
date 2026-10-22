import type { Tour } from "@openturnly/core";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "./api.ts";

const KEY = ["me", "tours"];

/** The guided tours the signed-in person has already seen or skipped. */
export function useSeenTours() {
  return useQuery({
    queryKey: KEY,
    queryFn: async () => (await api<{ seen: Tour[] }>("/api/me/tours")).seen,
  });
}

export function useTourMutations() {
  const queryClient = useQueryClient();
  // Marked right away, so the next tour doesn't wait for the server.
  const finish = useMutation({
    mutationFn: (tour: Tour) => api(`/api/me/tours/${tour}`, { method: "PUT" }),
    onMutate: (tour) =>
      queryClient.setQueryData<Tour[]>(KEY, (seen = []) => [...new Set([...seen, tour])]),
  });
  const replay = useMutation({
    mutationFn: () => api("/api/me/tours", { method: "DELETE" }),
    onSuccess: () => queryClient.setQueryData<Tour[]>(KEY, []),
  });
  return { finish, replay };
}
