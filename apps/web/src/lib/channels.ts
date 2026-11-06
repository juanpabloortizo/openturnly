import type {
  EmailConnectionInput,
  EmailTestInput,
  WhatsappConnectionInput,
  WhatsappTestInput,
} from "@openturnly/core";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, type EmailOverview, type WhatsappOverview, type WhatsappTemplate } from "./api.ts";

const keys = { whatsapp: ["channels", "whatsapp"] as const, email: ["channels", "email"] as const };

type WhatsappTemplates = {
  source: "own" | "default" | null;
  templates: WhatsappTemplate[];
  error: string | null;
};

export function useWhatsapp() {
  return useQuery({
    queryKey: keys.whatsapp,
    queryFn: () => api<WhatsappOverview>("/api/channels/whatsapp"),
  });
}

export function useWhatsappTemplates() {
  return useQuery({
    queryKey: [...keys.whatsapp, "templates"],
    queryFn: () => api<WhatsappTemplates>("/api/channels/whatsapp/templates"),
  });
}

export function useWhatsappMutations() {
  const queryClient = useQueryClient();
  const refresh = () => queryClient.invalidateQueries({ queryKey: keys.whatsapp });
  const base = "/api/channels/whatsapp";
  return {
    save: useMutation({
      mutationFn: (body: WhatsappConnectionInput) =>
        api<WhatsappOverview>(base, { method: "PUT", body }),
      onSuccess: refresh,
    }),
    connect: useMutation({
      mutationFn: () => api<WhatsappOverview>(`${base}/connect`, { method: "POST" }),
      onSuccess: refresh,
    }),
    remove: useMutation({
      mutationFn: () => api<WhatsappOverview>(base, { method: "DELETE" }),
      onSuccess: refresh,
    }),
    prepareTemplates: useMutation({
      mutationFn: () =>
        api<{ created: number; error: string | null }>(`${base}/templates`, { method: "POST" }),
      onSuccess: refresh,
    }),
    test: useMutation({
      mutationFn: (body: WhatsappTestInput) =>
        api<{ ok: boolean; error: string | null }>(`${base}/test`, { method: "POST", body }),
    }),
  };
}

export function useEmail() {
  return useQuery({
    queryKey: keys.email,
    queryFn: () => api<EmailOverview>("/api/channels/email"),
  });
}

export function useEmailMutations() {
  const queryClient = useQueryClient();
  const refresh = () => queryClient.invalidateQueries({ queryKey: keys.email });
  const base = "/api/channels/email";
  return {
    save: useMutation({
      mutationFn: (body: EmailConnectionInput) => api<EmailOverview>(base, { method: "PUT", body }),
      onSuccess: refresh,
    }),
    connect: useMutation({
      mutationFn: () => api<EmailOverview>(`${base}/connect`, { method: "POST" }),
      onSuccess: refresh,
    }),
    remove: useMutation({
      mutationFn: () => api<EmailOverview>(base, { method: "DELETE" }),
      onSuccess: refresh,
    }),
    test: useMutation({
      mutationFn: (body: EmailTestInput) =>
        api<{ ok: boolean; error: string | null }>(`${base}/test`, { method: "POST", body }),
    }),
  };
}

type Source = "own" | "default" | null;

/** What a business's flows can send through, whoever set it up. */
export function useBusinessChannels(businessId: string) {
  return useQuery({
    queryKey: ["businesses", businessId, "channels"],
    queryFn: () =>
      api<{ whatsapp: Source; email: Source }>(`/api/businesses/${businessId}/channels`),
  });
}

export function useBusinessWhatsappTemplates(businessId: string) {
  return useQuery({
    queryKey: ["businesses", businessId, "channels", "whatsapp-templates"],
    queryFn: () =>
      api<WhatsappTemplates>(`/api/businesses/${businessId}/channels/whatsapp-templates`),
  });
}
