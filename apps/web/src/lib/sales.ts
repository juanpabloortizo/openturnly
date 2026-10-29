import type { DepositInput, SaleInput } from "@openturnly/core";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, type Deposit, type Sale } from "./api.ts";

function salesKeys(businessId: string) {
  return {
    base: `/api/businesses/${businessId}`,
    sales: ["businesses", businessId, "sales"],
    deposits: ["businesses", businessId, "deposits"],
    appointments: ["businesses", businessId, "appointments"],
  } as const;
}

/** Sales made between two instants, newest first. */
export function useSales(
  businessId: string,
  range: { from: string; to: string },
  locationId: string | null,
) {
  const { base, sales } = salesKeys(businessId);
  return useQuery({
    queryKey: [...sales, range, locationId],
    queryFn: async () =>
      (
        await api<{ sales: Sale[] }>(
          `${base}/sales?${new URLSearchParams({
            ...range,
            ...(locationId ? { locationId } : {}),
          })}`,
        )
      ).sales,
  });
}

export function useSale(businessId: string, saleId: string | null) {
  const { base, sales } = salesKeys(businessId);
  return useQuery({
    queryKey: [...sales, "one", saleId],
    enabled: saleId !== null,
    queryFn: async () => (await api<{ sale: Sale }>(`${base}/sales/${saleId}`)).sale,
  });
}

/** Records and voids sales; the calendar shows which appointments are paid. */
export function useSaleMutations(businessId: string) {
  const { base, sales, deposits, appointments } = salesKeys(businessId);
  const queryClient = useQueryClient();
  const onSuccess = () => {
    queryClient.invalidateQueries({ queryKey: sales });
    queryClient.invalidateQueries({ queryKey: deposits });
    queryClient.invalidateQueries({ queryKey: appointments });
  };
  return {
    create: useMutation({
      mutationFn: async (input: SaleInput) =>
        (await api<{ sale: Sale }>(`${base}/sales`, { method: "POST", body: input })).sale,
      onSuccess,
    }),
    void: useMutation({
      mutationFn: (id: string) => api(`${base}/sales/${id}/void`, { method: "POST", body: {} }),
      onSuccess,
    }),
  };
}

export function useDeposits(
  businessId: string,
  filter: {
    from?: string;
    to?: string;
    locationId?: string | null;
    appointmentId?: string;
    customerId?: string;
  },
  { enabled = true } = {},
) {
  const { base, deposits } = salesKeys(businessId);
  const query = Object.fromEntries(
    Object.entries(filter).filter((entry): entry is [string, string] => Boolean(entry[1])),
  );
  return useQuery({
    queryKey: [...deposits, query],
    enabled,
    queryFn: async () =>
      (await api<{ deposits: Deposit[] }>(`${base}/deposits?${new URLSearchParams(query)}`))
        .deposits,
  });
}

export function useDepositMutations(businessId: string) {
  const { base, deposits, appointments } = salesKeys(businessId);
  const queryClient = useQueryClient();
  const onSuccess = () => {
    queryClient.invalidateQueries({ queryKey: deposits });
    queryClient.invalidateQueries({ queryKey: appointments });
  };
  return {
    create: useMutation({
      mutationFn: (input: DepositInput) =>
        api<{ deposit: Deposit }>(`${base}/deposits`, { method: "POST", body: input }),
      onSuccess,
    }),
    void: useMutation({
      mutationFn: (id: string) => api(`${base}/deposits/${id}/void`, { method: "POST", body: {} }),
      onSuccess,
    }),
  };
}
