import { automationSchema, automationTestSchema } from "@openturnly/core";
import { and, desc, eq } from "drizzle-orm";
import { Hono } from "hono";
import { type Automation, automationDeliveries, automations } from "../db/schema.ts";
import { newAutomationSecret } from "../lib/automations.ts";
import { apiError, type BusinessEnv, type Deps, parseBody, validateWith } from "../lib/http.ts";

/** Settings → Automations: outgoing webhooks of the business (admins only). */
export function automationRoutes({ db, automations: engine }: Deps) {
  const findAutomation = async (businessId: string, automationId: string) => {
    const [automation] = await db
      .select()
      .from(automations)
      .where(and(eq(automations.businessId, businessId), eq(automations.id, automationId)));
    if (!automation) throw apiError(404, "automation_not_found");
    return automation;
  };

  const lastDelivery = async (automation: Automation) => {
    const [last] = await db
      .select({
        status: automationDeliveries.status,
        responseStatus: automationDeliveries.responseStatus,
        error: automationDeliveries.error,
        createdAt: automationDeliveries.createdAt,
      })
      .from(automationDeliveries)
      .where(eq(automationDeliveries.automationId, automation.id))
      .orderBy(desc(automationDeliveries.createdAt))
      .limit(1);
    return last ?? null;
  };

  return (
    new Hono<BusinessEnv>()
      .get("/", async (c) => {
        const list = await db
          .select()
          .from(automations)
          .where(eq(automations.businessId, c.get("business").id))
          .orderBy(automations.createdAt);
        const withLast = await Promise.all(
          list.map(async (automation) => ({
            ...automation,
            lastDelivery: await lastDelivery(automation),
          })),
        );
        return c.json({ automations: withLast });
      })

      .post("/", async (c) => {
        const input = await parseBody(c, automationSchema);
        const [automation] = await db
          .insert(automations)
          .values({ ...input, businessId: c.get("business").id, secret: newAutomationSecret() })
          .returning();
        return c.json({ automation }, 201);
      })

      /** Edits send only what changes; the result is checked as a whole. */
      .patch("/:automationId", async (c) => {
        const current = await findAutomation(c.get("business").id, c.req.param("automationId"));
        const body = (await c.req.json().catch(() => null)) as Record<string, unknown> | null;
        if (!body || typeof body !== "object") throw apiError(400, "invalid_json");
        const { name, trigger, offsetMin, actions, active } = current;
        const input = validateWith(automationSchema, {
          ...{ name, trigger, offsetMin, actions, active },
          ...body,
        });
        const [automation] = await db
          .update(automations)
          .set({ ...input, updatedAt: new Date() })
          .where(eq(automations.id, current.id))
          .returning();
        return c.json({ automation });
      })

      .delete("/:automationId", async (c) => {
        const automation = await findAutomation(c.get("business").id, c.req.param("automationId"));
        await db.delete(automations).where(eq(automations.id, automation.id));
        return c.body(null, 204);
      })

      /**
       * Runs the flow as it is in the editor (saved or not) and says how each step
       * answered. Saved automations sign it with their secret and keep it in their history.
       */
      .post("/test", async (c) => {
        const business = c.get("business");
        const input = await parseBody(c, automationTestSchema);
        const saved = input.automationId
          ? await findAutomation(business.id, input.automationId)
          : null;
        try {
          const results = await engine.test(
            business,
            { ...input.automation, id: saved?.id, secret: saved?.secret },
            { appointmentId: input.appointmentId, actionId: input.actionId },
          );
          return c.json({ results });
        } catch (error) {
          if (error instanceof Error && error.message === "appointment_not_found") {
            throw apiError(404, "appointment_not_found");
          }
          throw error;
        }
      })

      /** A new signing secret; receivers must be updated with it. */
      .post("/:automationId/secret", async (c) => {
        const current = await findAutomation(c.get("business").id, c.req.param("automationId"));
        const [automation] = await db
          .update(automations)
          .set({ secret: newAutomationSecret(), updatedAt: new Date() })
          .where(eq(automations.id, current.id))
          .returning();
        return c.json({ automation });
      })

      /** The latest sends: when, what, and how the receiver answered. */
      .get("/:automationId/deliveries", async (c) => {
        const automation = await findAutomation(c.get("business").id, c.req.param("automationId"));
        const deliveries = await db
          .select()
          .from(automationDeliveries)
          .where(eq(automationDeliveries.automationId, automation.id))
          .orderBy(desc(automationDeliveries.createdAt))
          .limit(30);
        return c.json({ deliveries });
      })
  );
}
