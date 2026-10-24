// Auth + RBAC. Sesi login memakai tabel user_sessions yang terpisah
// dari sesi observasi. Cookie hanya menyimpan token acak; yang disimpan
// di database adalah hash SHA-256 token tersebut.

import type { Database } from "bun:sqlite";
import type { Context } from "hono";
import { getCookie, setCookie, deleteCookie } from "hono/cookie";

export type User = {
  id: number;
  username: string;
  name: string;
  role: "admin" | "guru" | "pengamat";
  can_view_all: number;
  must_change_password: number;
  active: number;
};

export type SessionRow = {
  id: number;
  user_id: number;
  token_hash: string;
  csrf_token: string | null;
  expires_at: string;
};

export function sha256(text: string): string {
  return new Bun.CryptoHasher("sha256").update(text).digest("hex");
}

export function newToken(): string {
  return `${crypto.randomUUID()}-${crypto.randomUUID()}`;
}

export function newCsrf(): string {
  return crypto.randomUUID().replace(/-/g, "");
}

export function sessionCookieOpts(): { httpOnly: boolean; path: string; sameSite: "Lax"; maxAge: number; secure: boolean } {
  return {
    httpOnly: true,
    path: "/",
    sameSite: "Lax",
    maxAge: 7 * 24 * 3600,
    secure: process.env.COOKIE_SECURE === "1",
  };
}

export async function createLoginSession(db: Database, userId: number): Promise<{ token: string; csrf: string }> {
  const token = newToken();
  const csrf = newCsrf();
  const expires = new Date(Date.now() + 7 * 24 * 3600 * 1000).toISOString();
  db.query("INSERT INTO user_sessions (user_id, token_hash, csrf_token, expires_at) VALUES (?, ?, ?, ?)").run(userId, sha256(token), csrf, expires);
  return { token, csrf };
}

export function setSessionCookie(c: Context, token: string): void {
  setCookie(c, "gezyasko_session", token, sessionCookieOpts());
}

export function clearSessionCookie(c: Context): void {
  deleteCookie(c, "gezyasko_session", { path: "/" });
}

export function getCurrentUser(db: Database, c: Context): { user: User; csrf: string } | null {
  const token = getCookie(c, "gezyasko_session");
  if (!token) return null;
  const row = db
    .query("SELECT s.*, u.id as uid, u.username, u.name, u.role, u.can_view_all, u.must_change_password, u.active FROM user_sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = ?")
    .get(sha256(token)) as any;
  if (!row) return null;
  if (row.active !== 1) return null;
  if (new Date(row.expires_at).getTime() < Date.now()) return null;
  db.query("UPDATE user_sessions SET last_seen_at = datetime('now') WHERE id = ?").run(row.id);
  return {
    user: {
      id: row.uid,
      username: row.username,
      name: row.name,
      role: row.role,
      can_view_all: row.can_view_all,
      must_change_password: row.must_change_password,
      active: row.active,
    },
    csrf: row.csrf_token || "",
  };
}

export function logoutSession(db: Database, c: Context): void {
  const token = getCookie(c, "gezyasko_session");
  if (token) db.query("DELETE FROM user_sessions WHERE token_hash = ?").run(sha256(token));
  clearSessionCookie(c);
}

// ---------- RBAC (semua cek dilakukan di server, bukan hanya di tombol) ----------

export function isAdmin(u: User): boolean {
  return u.role === "admin";
}

export function isKepsek(u: User): boolean {
  return u.role === "pengamat" && u.can_view_all === 1;
}

export function linkedStudentId(db: Database, userId: number): number | null {
  const row = db.query("SELECT student_id FROM observer_links WHERE user_id = ?").get(userId) as any;
  return row ? Number(row.student_id) : null;
}

/** Guru boleh melihat/mencatat kelas yang diampu; admin dan kepsek boleh semua kelas. */
export function canAccessClass(db: Database, u: User, classId: number): boolean {
  if (isAdmin(u) || isKepsek(u)) return true;
  if (u.role === "guru") {
    const row = db.query("SELECT 1 FROM class_teachers WHERE class_id = ? AND user_id = ?").get(classId, u.id) as any;
    return !!row;
  }
  return false; // pengamat murid/ortu tidak boleh membuka halaman kelas/rekap kelas
}

/** Rekap kelas hanya untuk admin, guru pengampu, dan kepsek. */
export function canViewClassRecap(db: Database, u: User, classId: number): boolean {
  return canAccessClass(db, u, classId);
}

export function canRecordSession(db: Database, u: User, classId: number): boolean {
  if (isAdmin(u)) return true;
  if (u.role === "guru") {
    const row = db.query("SELECT 1 FROM class_teachers WHERE class_id = ? AND user_id = ?").get(classId, u.id) as any;
    return !!row;
  }
  return false;
}

export function canAccessStudent(db: Database, u: User, studentId: number): boolean {
  if (isAdmin(u) || isKepsek(u)) return true;
  if (u.role === "guru") {
    const row = db
      .query("SELECT 1 FROM enrollments e JOIN class_teachers ct ON ct.class_id = e.class_id WHERE e.student_id = ? AND ct.user_id = ?")
      .get(studentId, u.id) as any;
    return !!row;
  }
  if (u.role === "pengamat") {
    return linkedStudentId(db, u.id) === studentId;
  }
  return false;
}

export function canAccessSession(db: Database, u: User, sessionId: number): boolean {
  const s = db.query("SELECT class_id FROM sessions WHERE id = ?").get(sessionId) as any;
  if (!s) return false;
  if (u.role === "pengamat" && !isKepsek(u)) return false; // pengamat tidak mencatat
  return canAccessClass(db, u, Number(s.class_id));
}

export function canAccessObservation(db: Database, u: User, observationId: number): boolean {
  const o = db.query("SELECT o.*, s.class_id FROM observations o JOIN sessions s ON s.id = o.session_id WHERE o.id = ?").get(observationId) as any;
  if (!o) return false;
  if (isAdmin(u) || isKepsek(u)) return true;
  if (u.role === "guru") {
    const row = db.query("SELECT 1 FROM class_teachers WHERE class_id = ? AND user_id = ?").get(o.class_id, u.id) as any;
    return !!row;
  }
  if (u.role === "pengamat") {
    const linked = linkedStudentId(db, u.id);
    if (linked === null) return false;
    if (o.student_id !== null && Number(o.student_id) === linked) return true;
    if (o.group_id !== null) {
      const m = db.query("SELECT 1 FROM group_members WHERE group_id = ? AND student_id = ?").get(o.group_id, linked) as any;
      return !!m;
    }
  }
  return false;
}

export function canAccessEvidence(db: Database, u: User, evidenceId: number): boolean {
  const e = db.query("SELECT observation_id FROM evidence WHERE id = ?").get(evidenceId) as any;
  if (!e) return false;
  return canAccessObservation(db, u, Number(e.observation_id));
}

export function checkCsrf(db: Database, c: Context, body: Record<string, any>): boolean {
  // Untuk form login (belum ada sesi), CSRF dilewati; semua form sesudah login wajib cocok.
  const current = getCurrentUser(db, c);
  if (!current) return true;
  const sent = body["_csrf"];
  return typeof sent === "string" && sent !== "" && sent === current.csrf;
}
