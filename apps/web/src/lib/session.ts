import type { AccountUpdateInput, PasswordChangeInput } from "@openturnly/core";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ApiError, api, type User } from "./api.ts";

export function useSetupStatus() {
  return useQuery({
    queryKey: ["setup"],
    queryFn: () => api<{ needsSetup: boolean }>("/api/setup"),
    staleTime: Number.POSITIVE_INFINITY,
  });
}

/** The signed-in user, or null when signed out. */
export function useMe() {
  return useQuery({
    queryKey: ["me"],
    queryFn: async () => {
      try {
        return (await api<{ user: User }>("/api/me")).user;
      } catch (error) {
        if (error instanceof ApiError && error.status === 401) return null;
        throw error;
      }
    },
  });
}

/** The signed-in person's own name, email and password ("Mi cuenta"). */
export function useAccountMutations() {
  const queryClient = useQueryClient();
  return {
    update: useMutation({
      mutationFn: (input: AccountUpdateInput) =>
        api<{ user: User }>("/api/me", { method: "PATCH", body: input }),
      onSuccess: ({ user }) => queryClient.setQueryData(["me"], user),
    }),
    changePassword: useMutation({
      mutationFn: (input: PasswordChangeInput) =>
        api<{ ok: true }>("/api/me/password", { method: "POST", body: input }),
    }),
  };
}

/** Problems with the install that only its owner can fix, e.g. "proxy_not_trusted". */
export function useInstallNotices(enabled: boolean) {
  return useQuery({
    queryKey: ["notices"],
    queryFn: async () => (await api<{ notices: string[] }>("/api/me/notices")).notices,
    enabled,
    refetchInterval: 5 * 60_000,
  });
}

/** The version of this install, shown to the owner so bug reports can name it. */
export function useVersion(enabled: boolean) {
  return useQuery({
    queryKey: ["version"],
    queryFn: async () => (await api<{ version: string }>("/api/meta/version")).version,
    enabled,
    staleTime: Number.POSITIVE_INFINITY,
  });
}

const LOGIN_KEY = "openturnly:login";

/** Remembers which business's sign-in page the person used; null for the main one. */
export function rememberLogin(slug: string | null) {
  try {
    if (slug) localStorage.setItem(LOGIN_KEY, slug);
    else localStorage.removeItem(LOGIN_KEY);
  } catch {
    // Private mode: signing out just lands on the main sign-in page.
  }
}

/** Where to sign in again: the business's own page if that's where the person came from. */
export function loginPath(): string {
  try {
    const slug = localStorage.getItem(LOGIN_KEY);
    return slug ? `/${slug}/login` : "/login";
  } catch {
    return "/login";
  }
}

export function useLogout() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => api("/api/auth/sign-out", { method: "POST", body: {} }),
    onSettled: () => {
      queryClient.clear();
      window.location.assign(loginPath());
    },
  });
}
