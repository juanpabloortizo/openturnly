import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { invitations } from "../src/db/schema.ts";
import { addMember, createBusiness, createTestApp, setUpOwner } from "./helpers.ts";

const tokenFrom = (inviteUrl: string) => inviteUrl.split("/invite/")[1] ?? "";

describe("giving a client access to their business", () => {
  it("invites a new person, who creates their account from the link", async () => {
    const app = await createTestApp();
    const owner = await setUpOwner(app);
    const business = await createBusiness(owner);

    const invite = await owner.post(`/api/businesses/${business.id}/access`, {
      email: "Client@Example.com",
    });
    expect(invite.status).toBe(201);
    expect(invite.body.status).toBe("invited");
    expect(invite.body.inviteUrl).toMatch(/^http:\/\/localhost:3000\/invite\/[\w-]{40,}$/);
    const token = tokenFrom(invite.body.inviteUrl);

    const visitor = app.client();
    const details = await visitor.get(`/api/invitations/${token}`);
    expect(details.body).toEqual({ email: "client@example.com", businessName: business.name });

    const accepted = await visitor.post(`/api/invitations/${token}/accept`, {
      name: "Maxiliano",
      password: "client-password",
    });
    expect(accepted.status).toBe(200);
    expect((await visitor.get("/api/me")).body.user).toMatchObject({
      email: "client@example.com",
      role: "member",
    });

    const access = await owner.get(`/api/businesses/${business.id}/access`);
    expect(access.body.members).toEqual([
      expect.objectContaining({ email: "client@example.com", name: "Maxiliano" }),
    ]);
    expect(access.body.invitations).toEqual([]);

    // The link works only once.
    expect((await app.client().get(`/api/invitations/${token}`)).status).toBe(404);
  });

  it("adds people who already have an account right away", async () => {
    const app = await createTestApp();
    const owner = await setUpOwner(app);
    const first = await createBusiness(owner);
    const second = await createBusiness(owner, { name: "Spa Luna", slug: "spa-luna" });
    const member = await addMember(app, owner, first.id, "client@example.com");

    const res = await owner.post(`/api/businesses/${second.id}/access`, {
      email: "client@example.com",
    });
    expect(res.body.status).toBe("added");
    expect((await member.get("/api/businesses")).body.businesses).toHaveLength(2);
  });

  it("removes access", async () => {
    const app = await createTestApp();
    const owner = await setUpOwner(app);
    const business = await createBusiness(owner);
    const member = await addMember(app, owner, business.id);
    const me = await member.get("/api/me");

    const removed = await owner.delete(`/api/businesses/${business.id}/members/${me.body.user.id}`);
    expect(removed.status).toBe(204);
    expect((await member.get(`/api/businesses/${business.id}`)).status).toBe(404);
  });

  it("invalidates the previous link when inviting the same email again", async () => {
    const app = await createTestApp();
    const owner = await setUpOwner(app);
    const business = await createBusiness(owner);
    const path = `/api/businesses/${business.id}/access`;

    const first = await owner.post(path, { email: "client@example.com" });
    const second = await owner.post(path, { email: "client@example.com" });

    expect(
      (await app.client().get(`/api/invitations/${tokenFrom(first.body.inviteUrl)}`)).status,
    ).toBe(404);
    expect(
      (await app.client().get(`/api/invitations/${tokenFrom(second.body.inviteUrl)}`)).status,
    ).toBe(200);
    expect((await owner.get(path)).body.invitations).toHaveLength(1);
  });

  it("rejects expired links", async () => {
    const app = await createTestApp();
    const owner = await setUpOwner(app);
    const business = await createBusiness(owner);
    const invite = await owner.post(`/api/businesses/${business.id}/access`, {
      email: "late@example.com",
    });
    await app.db
      .update(invitations)
      .set({ expiresAt: new Date(Date.now() - 1000) })
      .where(eq(invitations.id, invite.body.invitation.id));

    const res = await app
      .client()
      .post(`/api/invitations/${tokenFrom(invite.body.inviteUrl)}/accept`, {
        name: "Late",
        password: "late-password",
      });
    expect(res.status).toBe(404);
  });
});
