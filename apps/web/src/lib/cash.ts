import type { CashMovementInput, CashMovementKind, PaymentMethod } from "@openturnly/core";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "./api.ts";

export type CashReport = {
  flows: {
    sales: number;
    deposits: number;
    internal: number;
    giftCards: number;
    otherIncome: number;
    expenses: number;
    result: number;
  };
  byMethod: Record<PaymentMethod, number>;
  /** Paid sales, with the money taken in each (not deposits or gift card balances). */
  sales: {
    id: string;
    number: number;
    createdAt: string;
    locationName: string | null;
    customer: string | null;
    flow: "sales" | "internal" | "giftCards";
    methods: PaymentMethod[];
    amount: number;
  }[];
  deposits: {
    id: string;
    amount: number;
    method: PaymentMethod;
    note: string | null;
    createdAt: string;
    locationName: string | null;
    customer: string;
  }[];
  movements: {
    id: string;
    kind: CashMovementKind;
    amount: number;
    method: PaymentMethod;
    category: string | null;
    description: string | null;
    transferId: string | null;
    createdAt: string;
    locationName: string;
    createdByName: string | null;
  }[];
  /** Cash that should be in the drawer now. */
  cashInDrawer: number;
};

function cashKeys(businessId: string) {
  return {
    base: `/api/businesses/${businessId}/cash`,
    report: ["businesses", businessId, "cash"],
  } as const;
}

export function useCashReport(
  businessId: string,
  range: { from: string; to: string },
  locationId: string | null,
) {
  const { base, report } = cashKeys(businessId);
  return useQuery({
    queryKey: [...report, range, locationId],
    queryFn: () =>
      api<CashReport>(
        `${base}?${new URLSearchParams({ ...range, ...(locationId ? { locationId } : {}) })}`,
      ),
  });
}

export function useCashMutations(businessId: string) {
  const { base, report } = cashKeys(businessId);
  const queryClient = useQueryClient();
  const onSuccess = () => queryClient.invalidateQueries({ queryKey: report });
  return {
    create: useMutation({
      mutationFn: (input: CashMovementInput) =>
        api<{ cashInDrawer: number }>(`${base}/movements`, { method: "POST", body: input }),
      onSuccess,
    }),
    remove: useMutation({
      mutationFn: (id: string) => api(`${base}/movements/${id}`, { method: "DELETE" }),
      onSuccess,
    }),
  };
}
