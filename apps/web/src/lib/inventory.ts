import type { ProductInput, StockMovementInput } from "@openturnly/core";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, type Product, type StockMovement } from "./api.ts";

function inventoryKeys(businessId: string) {
  return {
    base: `/api/businesses/${businessId}`,
    products: ["businesses", businessId, "products"],
    movements: ["businesses", businessId, "stock-movements"],
  } as const;
}

export function useProducts(businessId: string) {
  const { base, products } = inventoryKeys(businessId);
  return useQuery({
    queryKey: products,
    queryFn: async () => (await api<{ products: Product[] }>(`${base}/products`)).products,
  });
}

export function useProductMutations(businessId: string) {
  const { base, products, movements } = inventoryKeys(businessId);
  const queryClient = useQueryClient();
  const onSuccess = () => {
    queryClient.invalidateQueries({ queryKey: products });
    queryClient.invalidateQueries({ queryKey: movements });
  };
  return {
    save: useMutation({
      mutationFn: ({ id, input }: { id?: string; input: ProductInput }) =>
        id
          ? api(`${base}/products/${id}`, { method: "PATCH", body: input })
          : api(`${base}/products`, { method: "POST", body: input }),
      onSuccess,
    }),
    remove: useMutation({
      mutationFn: (id: string) => api(`${base}/products/${id}`, { method: "DELETE" }),
      onSuccess,
    }),
  };
}

export function useStockMovements(
  businessId: string,
  filter: { from: string; to: string; locationId?: string; kind?: string },
) {
  const { base, movements } = inventoryKeys(businessId);
  const query = Object.fromEntries(
    Object.entries(filter).filter((entry): entry is [string, string] => Boolean(entry[1])),
  );
  return useQuery({
    queryKey: [...movements, query],
    queryFn: async () =>
      (
        await api<{ movements: StockMovement[] }>(
          `${base}/stock-movements?${new URLSearchParams(query)}`,
        )
      ).movements,
  });
}

export function useMoveStock(businessId: string) {
  const { base, products, movements } = inventoryKeys(businessId);
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: StockMovementInput) =>
      api<{ balance: number }>(`${base}/stock-movements`, { method: "POST", body: input }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: products });
      queryClient.invalidateQueries({ queryKey: movements });
    },
  });
}
