import type {
  ProductAttributeInput,
  ProductImportInput,
  ProductInput,
  StockMovementInput,
} from "@openturnly/core";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { TFunction } from "i18next";
import { api, type Product, type ProductAttribute, type StockMovement } from "./api.ts";

/** "400 ml", "1,5 l", "12 unidades": how much a product holds, or null if it doesn't say. */
export function contentText(
  t: TFunction,
  language: string,
  product: Pick<Product, "content" | "unit">,
) {
  if (product.content === null || product.unit === null) return null;
  // No thousands separators: "10.000 ml" would read back as 10 in a spreadsheet.
  const amount = new Intl.NumberFormat(language, {
    maximumFractionDigits: 2,
    useGrouping: false,
  }).format(product.content);
  return product.unit === "unit"
    ? t("inventory.units", { count: product.content, amount })
    : `${amount} ${product.unit}`;
}

function inventoryKeys(businessId: string) {
  return {
    base: `/api/businesses/${businessId}`,
    products: ["businesses", businessId, "products"],
    movements: ["businesses", businessId, "stock-movements"],
    attributes: ["businesses", businessId, "product-attributes"],
  } as const;
}

export function useProducts(businessId: string) {
  const { base, products } = inventoryKeys(businessId);
  return useQuery({
    queryKey: products,
    queryFn: async () => (await api<{ products: Product[] }>(`${base}/products`)).products,
  });
}

/** How many products are at or under their stock alarm somewhere, for the menu. */
export function useLowStockCount(businessId: string, enabled = true) {
  const { base, products } = inventoryKeys(businessId);
  return useQuery({
    queryKey: [...products, "low-stock"],
    queryFn: async () => (await api<{ count: number }>(`${base}/products/low-stock`)).count,
    enabled,
  });
}

export function useProductMutations(businessId: string) {
  const { base, products, movements, attributes } = inventoryKeys(businessId);
  const queryClient = useQueryClient();
  const onSuccess = () => {
    queryClient.invalidateQueries({ queryKey: products });
    queryClient.invalidateQueries({ queryKey: movements });
    // Lists show how many products use each entry.
    queryClient.invalidateQueries({ queryKey: attributes });
  };
  return {
    save: useMutation({
      mutationFn: ({ id, input }: { id?: string; input: ProductInput }) =>
        id
          ? api<{ product: Product }>(`${base}/products/${id}`, { method: "PATCH", body: input })
          : api<{ product: Product }>(`${base}/products`, { method: "POST", body: input }),
      onSuccess,
    }),
    remove: useMutation({
      mutationFn: (id: string) => api(`${base}/products/${id}`, { method: "DELETE" }),
      onSuccess,
    }),
  };
}

/** The business's categories, brands and formats. */
export function useProductAttributes(businessId: string) {
  const { base, attributes } = inventoryKeys(businessId);
  return useQuery({
    queryKey: attributes,
    queryFn: async () =>
      (await api<{ attributes: ProductAttribute[] }>(`${base}/product-attributes`)).attributes,
  });
}

export function useAttributeMutations(businessId: string) {
  const { base, attributes } = inventoryKeys(businessId);
  const queryClient = useQueryClient();
  const onSuccess = () => queryClient.invalidateQueries({ queryKey: attributes });
  return {
    save: useMutation({
      mutationFn: async ({ id, input }: { id?: string; input: ProductAttributeInput }) =>
        (
          await api<{ attribute: ProductAttribute }>(
            id ? `${base}/product-attributes/${id}` : `${base}/product-attributes`,
            { method: id ? "PATCH" : "POST", body: input },
          )
        ).attribute,
      onSuccess,
    }),
    remove: useMutation({
      mutationFn: (id: string) => api(`${base}/product-attributes/${id}`, { method: "DELETE" }),
      onSuccess,
    }),
  };
}

export type ProductImportResult = {
  applied: boolean;
  counts: { created: number; updated: number; unchanged: number; errors: number };
  newLists: { category: number; brand: number; format: number };
  stockChanges: number;
  results: { row: number; status: "error"; error: string; field?: string }[];
};

/** A bulk upload: a preview first, then (with `apply`) the upload itself. */
export function useImportProducts(businessId: string) {
  const { base, products, movements, attributes } = inventoryKeys(businessId);
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: ProductImportInput) =>
      api<ProductImportResult>(`${base}/products/import`, { method: "POST", body: input }),
    onSuccess: (result) => {
      if (!result.applied) return;
      queryClient.invalidateQueries({ queryKey: products });
      queryClient.invalidateQueries({ queryKey: movements });
      queryClient.invalidateQueries({ queryKey: attributes });
    },
  });
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
