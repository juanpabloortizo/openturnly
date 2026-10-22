import type { TFunction } from "i18next";
import type { z } from "zod";
import { ApiError } from "./api.ts";

export type FieldErrors = Record<string, string>;

/**
 * Validates with the same Zod schemas the server uses, producing the same error
 * codes, so messages are identical whether the check happens here or there.
 */
export function validate<T extends z.ZodType>(
  schema: T,
  values: unknown,
): { data: z.output<T>; errors: null } | { data: null; errors: FieldErrors } {
  const result = schema.safeParse(values);
  if (result.success) return { data: result.data, errors: null };
  const errors: FieldErrors = {};
  for (const issue of result.error.issues) {
    const key = issue.path.join(".") || "_";
    errors[key] ??= issue.code === "custom" ? issue.message : issue.code;
  }
  return { data: null, errors };
}

/** Message for a field error code, preferring a field-specific text ("password_too_small"). */
export function fieldMessage(t: TFunction, field: string, code: string | undefined) {
  if (!code) return undefined;
  const keys = [`errors.${field}_${code}`, `errors.${code}`, "errors.invalid_value"];
  return t(keys as unknown as "errors.invalid_value");
}

export function errorMessage(t: TFunction, error: unknown) {
  const code = error instanceof ApiError ? error.code : "unknown_error";
  return t([`errors.${code}`, "errors.unknown_error"] as unknown as "errors.unknown_error");
}

export function apiFieldErrors(error: unknown): FieldErrors {
  return error instanceof ApiError ? error.fields : {};
}
