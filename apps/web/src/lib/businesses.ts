import type {
  ApiKeyCreateInput,
  AutomationInput,
  AutomationTestInput,
  BusinessCreateInput,
  BusinessUpdateInput,
  MemberCreateInput,
  MemberUpdateInput,
} from "@openturnly/core";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ApiError,
  type ApiKey,
  type Automation,
  type AutomationDelivery,
  type AutomationStepResult,
  api,
  type Business,
  type Member,
  type PendingInvitation,
} from "./api.ts";

const keys = {
  all: ["businesses"] as const,
  one: (id: string) => ["businesses", id] as const,
  access: (id: string) => ["businesses", id, "access"] as const,
};

export function useBusinesses() {
  return useQuery({
    queryKey: keys.all,
    queryFn: async () => (await api<{ businesses: Business[] }>("/api/businesses")).businesses,
  });
}

export function useBusiness(id: string) {
  return useQuery({
    queryKey: keys.one(id),
    queryFn: async () => (await api<{ business: Business }>(`/api/businesses/${id}`)).business,
  });
}

export function useCreateBusiness() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: BusinessCreateInput) =>
      (await api<{ business: Business }>("/api/businesses", { method: "POST", body: input }))
        .business,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: keys.all }),
  });
}

export function useUpdateBusiness(id: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: BusinessUpdateInput) =>
      (await api<{ business: Business }>(`/api/businesses/${id}`, { method: "PATCH", body: input }))
        .business,
    onSuccess: (business) => {
      queryClient.setQueryData(keys.one(id), business);
      queryClient.invalidateQueries({ queryKey: keys.all, exact: true });
      // Country and the holidays switch change which days are closed.
      queryClient.invalidateQueries({ queryKey: [...keys.one(id), "holidays"] });
    },
  });
}

export function useDeleteBusiness(id: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => api(`/api/businesses/${id}`, { method: "DELETE" }),
    onSuccess: () => {
      queryClient.removeQueries({ queryKey: keys.one(id) });
      queryClient.invalidateQueries({ queryKey: keys.all, exact: true });
    },
  });
}

/** Whether the booking page is getting an unusual wave of bookings (possible bots). */
export type Protection = {
  active: boolean;
  lastHour: number;
  threshold: number;
  until: string | null;
};

export function useProtection(id: string, enabled: boolean) {
  return useQuery({
    queryKey: [...keys.one(id), "protection"],
    queryFn: async () =>
      (await api<{ protection: Protection }>(`/api/businesses/${id}/protection`)).protection,
    enabled,
    refetchInterval: 60_000,
  });
}

export function useApiKeys(id: string) {
  return useQuery({
    queryKey: [...keys.one(id), "api-keys"],
    queryFn: async () => (await api<{ keys: ApiKey[] }>(`/api/businesses/${id}/api-keys`)).keys,
  });
}

export function useApiKeyMutations(id: string) {
  const queryClient = useQueryClient();
  const refresh = () => queryClient.invalidateQueries({ queryKey: [...keys.one(id), "api-keys"] });
  return {
    /** Resolves with the new key; its token is never readable again. */
    create: useMutation({
      mutationFn: (input: ApiKeyCreateInput) =>
        api<{ key: ApiKey; token: string }>(`/api/businesses/${id}/api-keys`, {
          method: "POST",
          body: input,
        }),
      onSuccess: refresh,
    }),
    revoke: useMutation({
      mutationFn: (keyId: string) =>
        api(`/api/businesses/${id}/api-keys/${keyId}`, { method: "DELETE" }),
      onSuccess: refresh,
    }),
  };
}

const automationKey = (id: string) => [...keys.one(id), "automations"] as const;

export function useAutomations(id: string) {
  return useQuery({
    queryKey: automationKey(id),
    queryFn: async () =>
      (await api<{ automations: Automation[] }>(`/api/businesses/${id}/automations`)).automations,
  });
}

export function useAutomationDeliveries(id: string, automationId: string) {
  return useQuery({
    queryKey: [...automationKey(id), automationId, "deliveries"],
    queryFn: async () =>
      (
        await api<{ deliveries: AutomationDelivery[] }>(
          `/api/businesses/${id}/automations/${automationId}/deliveries`,
        )
      ).deliveries,
    refetchInterval: 15_000,
  });
}

export function useAutomationMutations(id: string) {
  const queryClient = useQueryClient();
  const refresh = () => queryClient.invalidateQueries({ queryKey: automationKey(id) });
  const base = `/api/businesses/${id}/automations`;
  return {
    save: useMutation({
      mutationFn: ({ automationId, ...input }: AutomationInput & { automationId?: string }) =>
        api<{ automation: Automation }>(automationId ? `${base}/${automationId}` : base, {
          method: automationId ? "PATCH" : "POST",
          body: input,
        }),
      onSuccess: refresh,
    }),
    setActive: useMutation({
      mutationFn: ({ automationId, active }: { automationId: string; active: boolean }) =>
        api(`${base}/${automationId}`, { method: "PATCH", body: { active } }),
      onSuccess: refresh,
    }),
    remove: useMutation({
      mutationFn: (automationId: string) => api(`${base}/${automationId}`, { method: "DELETE" }),
      onSuccess: (_, automationId) => {
        // Its history is gone with it: don't ask for it again.
        queryClient.removeQueries({ queryKey: [...automationKey(id), automationId] });
        return refresh();
      },
    }),
    /** Runs the flow as it is in the editor, saved or not. */
    test: useMutation({
      mutationFn: async (input: AutomationTestInput) =>
        (
          await api<{ results: AutomationStepResult[] }>(`${base}/test`, {
            method: "POST",
            body: input,
          })
        ).results,
      onSuccess: refresh,
    }),
    rotateSecret: useMutation({
      mutationFn: (automationId: string) =>
        api<{ automation: Automation }>(`${base}/${automationId}/secret`, {
          method: "POST",
          body: {},
        }),
      onSuccess: refresh,
    }),
  };
}

export function useAccess(id: string) {
  return useQuery({
    queryKey: keys.access(id),
    queryFn: () =>
      api<{ members: Member[]; invitations: PendingInvitation[] }>(`/api/businesses/${id}/access`),
  });
}

export function useAccessMutations(id: string) {
  const queryClient = useQueryClient();
  const onSuccess = () => queryClient.invalidateQueries({ queryKey: keys.access(id) });
  const base = `/api/businesses/${id}/members`;
  return {
    create: useMutation({
      mutationFn: (input: MemberCreateInput) =>
        api<{ userId: string; created: boolean }>(base, { method: "POST", body: input }),
      onSuccess,
    }),
    update: useMutation({
      mutationFn: ({ userId, ...input }: MemberUpdateInput & { userId: string }) =>
        api(`${base}/${userId}`, { method: "PATCH", body: input }),
      onSuccess,
    }),
    resetPassword: useMutation({
      mutationFn: ({ userId, password }: { userId: string; password: string }) =>
        api(`${base}/${userId}/password`, { method: "PUT", body: { password } }),
    }),
    removeMember: useMutation({
      mutationFn: (userId: string) => api(`${base}/${userId}`, { method: "DELETE" }),
      onSuccess,
    }),
    revokeInvitation: useMutation({
      mutationFn: (invitationId: string) =>
        api(`/api/businesses/${id}/invitations/${invitationId}`, { method: "DELETE" }),
      onSuccess,
    }),
  };
}

export type BusinessImages = { logoUrl: string | null; coverUrl: string | null };

/** Logo and cover photo. Uploads send the (already shrunk) image bytes as the body. */
export function useBusinessImages(id: string) {
  const queryClient = useQueryClient();
  const key = [...keys.one(id), "images"];
  const onSuccess = (images: BusinessImages) => {
    queryClient.setQueryData(key, images);
    // The business switcher and the businesses list show the logo too.
    queryClient.invalidateQueries({ queryKey: keys.all, exact: true });
    queryClient.invalidateQueries({ queryKey: keys.one(id), exact: true });
  };
  return {
    list: useQuery({
      queryKey: key,
      queryFn: () => api<BusinessImages>(`/api/businesses/${id}/images`),
    }),
    upload: useMutation({
      mutationFn: async ({ kind, image }: { kind: "logo" | "cover"; image: Blob }) => {
        const res = await fetch(`/api/businesses/${id}/images/${kind}`, {
          method: "PUT",
          headers: { "content-type": image.type },
          body: image,
          credentials: "same-origin",
        });
        const data = await res.json().catch(() => null);
        if (!res.ok) throw new ApiError(res.status, data?.error?.code ?? "unknown_error");
        return data as BusinessImages;
      },
      onSuccess,
    }),
    remove: useMutation({
      mutationFn: (kind: "logo" | "cover") =>
        api<BusinessImages>(`/api/businesses/${id}/images/${kind}`, { method: "DELETE" }),
      onSuccess,
    }),
  };
}
