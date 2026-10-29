import type { GiftCardInput } from "@openturnly/core";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, type GiftCard } from "./api.ts";

function giftCardKeys(businessId: string) {
  return {
    base: `/api/businesses/${businessId}/gift-cards`,
    list: ["businesses", businessId, "gift-cards"],
    sales: ["businesses", businessId, "sales"],
  } as const;
}

export function useGiftCards(businessId: string) {
  const { base, list } = giftCardKeys(businessId);
  return useQuery({
    queryKey: list,
    queryFn: async () => (await api<{ giftCards: GiftCard[] }>(base)).giftCards,
  });
}

/** A card by the code typed at the counter, whatever its state. */
export async function lookupGiftCard(businessId: string, code: string) {
  const { base } = giftCardKeys(businessId);
  return (
    await api<{ giftCard: GiftCard }>(`${base}/lookup?code=${encodeURIComponent(code.trim())}`)
  ).giftCard;
}

export function useGiftCardMutations(businessId: string) {
  const { base, list, sales } = giftCardKeys(businessId);
  const queryClient = useQueryClient();
  // Selling a gift card is a sale too.
  const onSuccess = () => {
    queryClient.invalidateQueries({ queryKey: list });
    queryClient.invalidateQueries({ queryKey: sales });
  };
  return {
    create: useMutation({
      mutationFn: (input: GiftCardInput) =>
        api<{ giftCard: GiftCard }>(base, { method: "POST", body: input }),
      onSuccess,
    }),
    update: useMutation({
      mutationFn: ({ id, ...body }: { id: string } & Record<string, unknown>) =>
        api(`${base}/${id}`, { method: "PATCH", body }),
      onSuccess,
    }),
    remove: useMutation({
      mutationFn: (id: string) => api(`${base}/${id}`, { method: "DELETE" }),
      onSuccess,
    }),
  };
}
