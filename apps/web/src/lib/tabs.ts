import { useSearchParams } from "react-router";

/** The current tab from `?tab=`, falling back to the first one. */
export function useTab<T extends string>(tabs: readonly T[]): [T, (tab: T) => void] {
  const [params, setParams] = useSearchParams();
  const current = params.get("tab");
  const tab = (tabs as readonly string[]).includes(current ?? "") ? (current as T) : (tabs[0] as T);
  return [tab, (next) => setParams(next === tabs[0] ? {} : { tab: next }, { replace: true })];
}
