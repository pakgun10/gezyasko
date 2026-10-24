import { describe, test, expect, beforeAll } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createApp } from "../src/app";
import { createLoginSession } from "../src/auth";
import type { Hono } from "hono";

let app: Hono;
let state: any;
let adminId: number;
let adminCookie = "";
let adminCsrf = "";
let guru1Id: number;
let guru2Id: number;

function cookieFrom(res: Response): string {
  const raw = res.headers.get("set-cookie") || "";
  return raw.split(";")[0] || "";
}

async function postReset(cookie: string, csrf: string, userId: number, password: string) {
  const body = new URLSearchParams({ user_id: String(userId), password, _csrf: csrf });
  return app.request("/admin/guru/reset", {
    method: "POST",
    headers: { Cookie: cookie, "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });
}

function userRow(id: number): any {
  return state.db.query("SELECT * FROM users WHERE id = ?").get(id);
}

function sessionCount(userId: number): number {
  return (state.db.query("SELECT COUNT(*) c FROM user_sessions WHERE user_id = ?").get(userId) as any).c;
}

beforeAll(async () => {
  const dir = mkdtempSync(join(tmpdir(), "gezyasko-reset-test-"));
  process.env.SEED_ADMIN_PASSWORD = "AdminAwal123";
  const created = await createApp(dir);
  app = created.app;
  state = created.state;
  adminId = Number((state.db.query("SELECT id FROM users WHERE username = 'admin'").get() as any).id);

  const login = await app.request("/login", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ username: "admin", password: "AdminAwal123" }).toString(),
  });
  expect(login.status).toBe(302);
  adminCookie = cookieFrom(login);
  expect(adminCookie).toContain("gezyasko_session=");
  adminCsrf = (state.db.query("SELECT csrf_token FROM user_sessions WHERE user_id = ? ORDER BY id DESC LIMIT 1").get(adminId) as any).csrf_token;

  const hash1 = await Bun.password.hash("Lama12345", { algorithm: "argon2id" });
  const g1: any = state.db.query("INSERT INTO users (username, name, password_hash, role, must_change_password) VALUES ('guru1', 'Guru 1', ?, 'guru', 0)").run(hash1);
  guru1Id = Number(g1.lastInsertRowid);
  await createLoginSession(state.db, guru1Id);

  const hash2 = await Bun.password.hash("Lama22222", { algorithm: "argon2id" });
  const g2: any = state.db.query("INSERT INTO users (username, name, password_hash, role, must_change_password) VALUES ('guru2', 'Guru 2', ?, 'guru', 0)").run(hash2);
  guru2Id = Number(g2.lastInsertRowid);
  await createLoginSession(state.db, guru2Id);
});

describe("reset kata sandi oleh admin", () => {
  test("reset berhasil: sandi baru berlaku, wajib ganti, semua sesi target dicabut, audit tercatat", async () => {
    expect(sessionCount(guru1Id)).toBe(1);
    const res = await postReset(adminCookie, adminCsrf, guru1Id, "Baru12345");
    expect(res.status).toBe(302);
    const row = userRow(guru1Id);
    expect(await Bun.password.verify("Baru12345", row.password_hash)).toBe(true);
    expect(await Bun.password.verify("Lama12345", row.password_hash)).toBe(false);
    expect(row.must_change_password).toBe(1);
    expect(sessionCount(guru1Id)).toBe(0);
    expect(sessionCount(adminId)).toBeGreaterThan(0);
    const log = state.db.query("SELECT * FROM audit_logs WHERE action = 'password.reset' AND entity_id = ?").get(guru1Id) as any;
    expect(log).not.toBeNull();
    expect(log.user_id).toBe(adminId);
    expect(String(log.detail || "")).not.toContain("Baru12345");

    // Target bisa login dengan sandi baru, lalu diarahkan wajib ganti sandi
    const login = await app.request("/login", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ username: "guru1", password: "Baru12345" }).toString(),
    });
    expect(login.status).toBe(302);
    expect(login.headers.get("location") || "").toContain("/ganti-sandi");
  });

  test("reset akun sendiri ditolak dan sandi admin tidak berubah", async () => {
    const before = userRow(adminId);
    const res = await postReset(adminCookie, adminCsrf, adminId, "Coba12345");
    expect(res.status).toBe(302);
    const after = userRow(adminId);
    expect(await Bun.password.verify("AdminAwal123", after.password_hash)).toBe(true);
    expect(after.must_change_password).toBe(0);
    expect(before.password_hash).toBe(after.password_hash);
  });

  test("kata sandi pendek ditolak dan sandi target tidak berubah", async () => {
    const res = await postReset(adminCookie, adminCsrf, guru2Id, "abc");
    expect(res.status).toBe(302);
    const row = userRow(guru2Id);
    expect(await Bun.password.verify("Lama22222", row.password_hash)).toBe(true);
    expect(row.must_change_password).toBe(0);
    expect(sessionCount(guru2Id)).toBe(1);
  });

  test("tanpa login admin ditolak dan sandi target tidak berubah", async () => {
    const res = await postReset("", adminCsrf, guru2Id, "Tanpa12345");
    expect(res.status).toBe(302);
    const row = userRow(guru2Id);
    expect(await Bun.password.verify("Lama22222", row.password_hash)).toBe(true);
  });

  test("CSRF salah ditolak dan sandi target tidak berubah", async () => {
    const res = await postReset(adminCookie, "csrf-salah", guru2Id, "Salah12345");
    expect(res.status).toBe(403);
    const row = userRow(guru2Id);
    expect(await Bun.password.verify("Lama22222", row.password_hash)).toBe(true);
  });
});
