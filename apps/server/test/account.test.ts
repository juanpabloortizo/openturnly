import { describe, expect, it } from "vitest";
import { addMember, createBusiness, createTestApp, OWNER, setUpOwner } from "./helpers.ts";

describe("my account", () => {
  it("changes the name, and the email only with the current password", async () => {
    const app = await createTestApp();
    const owner = await setUpOwner(app);

    const renamed = await owner.patch("/api/me", { name: "  ana  maría ", email: OWNER.email });
    expect(renamed.status).toBe(200);
    expect(renamed.body.user).toMatchObject({ name: "Ana María", email: OWNER.email });
    expect((await owner.get("/api/me")).body.user.name).toBe("Ana María");

    const noPassword = await owner.patch("/api/me", { name: "Ana", email: "ana@example.com" });
    expect(noPassword.status).toBe(400);
    expect(noPassword.body.error.fields).toEqual({ currentPassword: "wrong_password" });
    const wrong = await owner.patch("/api/me", {
      name: "Ana",
      email: "ana@example.com",
      currentPassword: "not-my-password",
    });
    expect(wrong.body.error.fields).toEqual({ currentPassword: "wrong_password" });

    // Someone else already signs in with that email.
    const business = await createBusiness(owner);
    await addMember(app, owner, business.id, "staff@example.com");
    const taken = await owner.patch("/api/me", {
      name: "Ana",
      email: "staff@example.com",
      currentPassword: OWNER.password,
    });
    expect(taken.status).toBe(409);
    expect(taken.body.error.fields).toEqual({ email: "user_already_exists" });

    const moved = await owner.patch("/api/me", {
      name: "Ana",
      email: " Ana@Example.com ",
      currentPassword: OWNER.password,
    });
    expect(moved.body.user.email).toBe("ana@example.com");
    const signIn = await app
      .client()
      .post("/api/auth/sign-in/email", { email: "ana@example.com", password: OWNER.password });
    expect(signIn.status).toBe(200);
  });

  it("changes the password and signs out the other devices, not this one", async () => {
    const app = await createTestApp();
    const owner = await setUpOwner(app);
    const laptop = app.client();
    await laptop.post("/api/auth/sign-in/email", { email: OWNER.email, password: OWNER.password });
    expect((await laptop.get("/api/me")).status).toBe(200);

    const wrong = await owner.post("/api/me/password", {
      currentPassword: "not-my-password",
      newPassword: "a-new-strong-password",
    });
    expect(wrong.body.error.fields).toEqual({ currentPassword: "wrong_password" });
    const short = await owner.post("/api/me/password", {
      currentPassword: OWNER.password,
      newPassword: "short",
    });
    expect(short.status).toBe(400);

    const changed = await owner.post("/api/me/password", {
      currentPassword: OWNER.password,
      newPassword: "a-new-strong-password",
    });
    expect(changed.status).toBe(200);
    expect((await owner.get("/api/me")).status).toBe(200);
    expect((await laptop.get("/api/me")).status).toBe(401);

    const old = await app
      .client()
      .post("/api/auth/sign-in/email", { email: OWNER.email, password: OWNER.password });
    expect(old.status).toBe(401);
    const fresh = await app
      .client()
      .post("/api/auth/sign-in/email", { email: OWNER.email, password: "a-new-strong-password" });
    expect(fresh.status).toBe(200);
  });

  it("remembers the guided tours each person has seen, until they ask to see them again", async () => {
    const app = await createTestApp();
    const owner = await setUpOwner(app);
    const business = await createBusiness(owner);
    const admin = await addMember(app, owner, business.id, "admin@example.com");

    expect((await owner.get("/api/me/tours")).body.seen).toEqual([]);
    expect((await owner.put("/api/me/tours/welcome", {})).status).toBe(200);
    // Seeing it twice (two tabs) is fine.
    expect((await owner.put("/api/me/tours/welcome", {})).status).toBe(200);
    await owner.put("/api/me/tours/agenda", {});
    expect((await owner.get("/api/me/tours")).body.seen.sort()).toEqual(["agenda", "welcome"]);
    expect((await owner.put("/api/me/tours/nothing", {})).status).toBe(404);

    // Each person has their own.
    expect((await admin.get("/api/me/tours")).body.seen).toEqual([]);

    expect((await owner.delete("/api/me/tours")).status).toBe(204);
    expect((await owner.get("/api/me/tours")).body.seen).toEqual([]);
    expect((await app.client().get("/api/me/tours")).status).toBe(401);
  });

  it("stops guessing the current password after five wrong ones", async () => {
    const app = await createTestApp();
    const owner = await setUpOwner(app);
    const business = await createBusiness(owner);
    const staff = await addMember(app, owner, business.id, "staff@example.com");
    const change = (client: typeof owner, currentPassword: string) =>
      client.post("/api/me/password", { currentPassword, newPassword: "a-new-strong-password" });

    for (let attempt = 0; attempt < 5; attempt++) {
      expect((await change(owner, `wrong-${attempt}`)).status).toBe(400);
    }
    // Now even the right password waits, for the email too.
    const locked = await change(owner, OWNER.password);
    expect(locked.status).toBe(429);
    expect(locked.body.error.code).toBe("too_many_attempts");
    const email = await owner.patch("/api/me", {
      name: "Owner",
      email: "new@example.com",
      currentPassword: OWNER.password,
    });
    expect(email.status).toBe(429);

    // Each person has their own count, and a right password clears it.
    for (let attempt = 0; attempt < 4; attempt++) await change(staff, `wrong-${attempt}`);
    expect((await change(staff, "client-password")).status).toBe(200);
    for (let attempt = 0; attempt < 4; attempt++) {
      expect((await change(staff, `wrong-again-${attempt}`)).status).toBe(400);
    }
  });
});
