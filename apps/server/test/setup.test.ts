import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { createTestApp, OWNER, setUpOwner } from "./helpers.ts";

describe("first-run setup", () => {
  it("is required until the owner account exists", async () => {
    const app = await createTestApp();
    const visitor = app.client();
    expect((await visitor.get("/api/setup")).body).toEqual({ needsSetup: true });

    await setUpOwner(app);
    expect((await visitor.get("/api/setup")).body).toEqual({ needsSetup: false });
  });

  it("creates the owner and signs them in without exposing the session token", async () => {
    const app = await createTestApp();
    const owner = app.client();

    const res = await owner.post("/api/setup", OWNER);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });

    const me = await owner.get("/api/me");
    expect(me.body.user).toMatchObject({ email: OWNER.email, role: "owner" });
  });

  it("tells signed-in people which version is installed, and nobody else", async () => {
    const app = await createTestApp();
    const owner = await setUpOwner(app);
    const { version } = JSON.parse(
      readFileSync(new URL("../../../package.json", import.meta.url), "utf8"),
    );
    expect((await owner.get("/api/meta/version")).body).toEqual({ version });
    expect((await app.client().get("/api/meta/version")).status).toBe(401);
  });

  it("cannot be run twice", async () => {
    const app = await createTestApp();
    await setUpOwner(app);
    const res = await app.client().post("/api/setup", { ...OWNER, email: "intruder@example.com" });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe("already_set_up");
  });

  it("validates the input", async () => {
    const res = await (await createTestApp())
      .client()
      .post("/api/setup", { name: "", email: "nope", password: "short" });
    expect(res.status).toBe(400);
    expect(Object.keys(res.body.error.fields).sort()).toEqual(["email", "name", "password"]);
  });
});

describe("authentication", () => {
  it("blocks the public sign-up endpoint", async () => {
    const app = await createTestApp();
    const res = await app.client().post("/api/auth/sign-up/email", {
      name: "X",
      email: "x@example.com",
      password: "password1",
    });
    expect(res.status).toBe(403);
  });

  it("signs in and out with email and password", async () => {
    const app = await createTestApp();
    await setUpOwner(app);
    const browser = app.client();

    const wrong = await browser.post("/api/auth/sign-in/email", {
      email: OWNER.email,
      password: "wrong-password",
    });
    expect(wrong.status).toBe(401);

    const ok = await browser.post("/api/auth/sign-in/email", {
      email: OWNER.email,
      password: OWNER.password,
    });
    expect(ok.status).toBe(200);
    expect((await browser.get("/api/me")).status).toBe(200);

    await browser.post("/api/auth/sign-out");
    expect((await browser.get("/api/me")).status).toBe(401);
  });
});
