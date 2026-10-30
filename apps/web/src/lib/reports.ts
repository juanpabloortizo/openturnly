import { useQuery } from "@tanstack/react-query";
import { api } from "./api.ts";

export type Figures = {
  bookings: number;
  /** Booked time over open time, 0–1; null without opening hours. */
  occupancy: number | null;
  newCustomers: number;
  billed: number;
};

export type SummaryReport = {
  period: { from: string; to: string };
  previous: { from: string; to: string };
  current: Figures;
  before: Figures;
  origin: Partial<Record<"online" | "admin" | "agent", number>>;
  topServices: { name: string; quantity: number; amount: number }[];
  byProfessional: { name: string; bookings: number }[];
  today: {
    id: string;
    code: string;
    time: string;
    service: string;
    professional: string | null;
    location: string | null;
    customer: string;
    paid: boolean;
  }[];
};

export type TipsReport = {
  tips: {
    id: string;
    amount: number;
    resourceId: string | null;
    resourceName: string;
    sale: { id: string; number: number };
    createdAt: string;
    locationName: string | null;
    customer: string | null;
  }[];
  totals: { name: string; amount: number; count: number }[];
};

export type CommissionsReport = {
  professionals: {
    id: string;
    name: string;
    serviceRate: number;
    productRate: number;
    servicesCount: number;
    services: number;
    serviceCommission: number;
    productsCount: number;
    products: number;
    productCommission: number;
    tips: number;
    total: number;
  }[];
};

/** One of the business's reports over a period of whole days, at one location or all. */
export function useReport<T>(
  businessId: string,
  report: "summary" | "tips" | "commissions",
  filter: { from: string; to: string; locationId?: string; resourceId?: string },
) {
  const query = Object.fromEntries(
    Object.entries(filter).filter((entry): entry is [string, string] => Boolean(entry[1])),
  );
  return useQuery({
    queryKey: ["businesses", businessId, "reports", report, query],
    queryFn: () =>
      api<T>(`/api/businesses/${businessId}/reports/${report}?${new URLSearchParams(query)}`),
  });
}
