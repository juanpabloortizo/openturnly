import { eq } from "drizzle-orm";
import type { Context } from "hono";
import type { Auth } from "../auth.ts";
import type { Db } from "../db/client.ts";
import { sessions } from "../db/schema.ts";
import { apiError } from "./http.ts";

type NewAccount = { name: string; email: string; password: string };

/**
 * Creates an account through Better Auth and signs the person in.
 * Returns the new user id plus a response that only carries the session cookie:
 * Better Auth also puts the session token in the JSON body, which we do not expose.
 */
export async function createAccountAndSignIn(
  c: Context,
  auth: Auth,
  account: NewAccount,
): Promise<{ userId: string | null; response: Response }> {
  const result = await auth.api.signUpEmail({ body: account, asResponse: true });
  if (!result.ok) return { userId: null, response: result };

  const { user } = (await result.json()) as { user: { id: string } };
  for (const cookie of result.headers.getSetCookie()) {
    c.header("Set-Cookie", cookie, { append: true });
  }
  return { userId: user.id, response: c.json({ ok: true }) };
}

/**
 * Creates an account with a password chosen by whoever gives the access, without signing
 * anyone in. The person signs in later with those details.
 */
export async function createAccount(auth: Auth, account: NewAccount): Promise<string> {
  const context = await auth.$context;
  const user = await context.internalAdapter.createUser(
    { name: account.name, email: account.email, emailVerified: false },
    { method: "admin" },
  );
  await context.internalAdapter.linkAccount({
    userId: user.id,
    providerId: "credential",
    accountId: user.id,
    password: await context.password.hash(account.password),
  });
  return user.id;
}

/** Throws `wrong_password` unless `password` is the person's current one. */
export async function verifyPassword(auth: Auth, userId: string, password: string | undefined) {
  const context = await auth.$context;
  const hash = (await context.internalAdapter.findAccounts(userId)).find(
    (account) => account.providerId === "credential",
  )?.password;
  if (!password || !hash || !(await context.password.verify({ hash, password }))) {
    throw apiError(400, "wrong_password", { currentPassword: "wrong_password" });
  }
}

/** Sets a new password and signs the person out everywhere, so only the new one works. */
export async function resetPassword(auth: Auth, db: Db, userId: string, password: string) {
  const context = await auth.$context;
  await context.internalAdapter.updatePassword(userId, await context.password.hash(password));
  await db.delete(sessions).where(eq(sessions.userId, userId));
}
