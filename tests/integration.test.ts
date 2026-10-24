import { describe, test, expect, beforeEach } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDb, createSession } from "../src/db";
import { importStudents, importTeachers, importGroups } from "../src/lib/imports";
import { canAccessClass, canAccessStudent, canAccessEvidence, type User } from "../src/auth";
import { generateNarrative } from "../src/lib/narrative";
import type { Database } from "bun:sqlite";

let db: Database;
let dir: string;

function user(id: number, role: "admin" | "guru" | "pengamat", canViewAll = 0): User {
  return { id, username: `u${id}`, name: `User ${id}`, role, can_view_all: canViewAll, must_change_password: 0, active: 1 };
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "gezyasko-test-"));
  db = openDb(join(dir, "test.db"));
  db.query("INSERT INTO periods (id, name, is_active) VALUES (1, '2026/2027 Ganjil', 1)").run();
  db.query("INSERT INTO classes (id, period_id, name, level_label) VALUES (1, 1, '7.1', 'Kelas 7')").run();
  db.query("INSERT INTO users (id, username, name, password_hash, role) VALUES (1, 'admin', 'Admin', 'x', 'admin')").run();
  db.query("INSERT INTO users (id, username, name, password_hash, role) VALUES (2, 'guru1', 'Guru 1', 'x', 'guru')").run();
  db.query("INSERT INTO users (id, username, name, password_hash, role) VALUES (3, 'guru2', 'Guru 2', 'x', 'guru')").run();
  db.query("INSERT INTO users (id, username, name, password_hash, role, can_view_all) VALUES (4, 'kepsek', 'Kepsek', 'x', 'pengamat', 1)").run();
  db.query("INSERT INTO users (id, username, name, password_hash, role) VALUES (5, '111', 'Ortu A', 'x', 'pengamat')").run();
  db.query("INSERT INTO students (id, name, student_no) VALUES (10, 'Ahmad', '111'), (11, 'Siti', '112'), (12, 'Budi', '113')").run();
  db.query("INSERT INTO enrollments (class_id, student_id) VALUES (1, 10), (1, 11), (1, 12)").run();
  db.query("INSERT INTO observer_links (user_id, student_id) VALUES (5, 10)").run();
  db.query("INSERT INTO class_teachers (class_id, user_id, subject_label) VALUES (1, 2, 'Matematika')").run();
});

describe("snapshot instrumen", () => {
  test("edit instrumen setelah sesi dibuat tidak mengubah snapshot", () => {
    const info: any = db.query("INSERT INTO instruments (owner_id, title, kind, levels) VALUES (2, 'Rubrik Uji', 'rubrik', '[{\"v\":1,\"label\":\"A\"},{\"v\":2,\"label\":\"B\"}]')").run();
    const instId = Number(info.lastInsertRowid);
    db.query("INSERT INTO criteria (instrument_id, text, descriptors, weight, input_type, sort) VALUES (?, 'K1', '{}', 1, 'rubrik', 1)").run(instId);
    const sessionId = createSession(db, { class_id: 1, instrument_id: instId, teacher_id: 2, scope: "individu", observed_at: "2026-10-24", activity: "Pidato", note: "" });
    // Edit instrumen asli: ubah teks kriteria dan hapus lalu tambah kriteria baru
    const crit = db.query("SELECT id FROM criteria WHERE instrument_id = ?").get(instId) as any;
    db.query("UPDATE criteria SET text = 'K1 DIUBAH' WHERE id = ?").run(crit.id);
    db.query("INSERT INTO criteria (instrument_id, text, descriptors, weight, input_type, sort) VALUES (?, 'K BARU', '{}', 1, 'rubrik', 2)").run(instId);
    const snap = db.query("SELECT text FROM session_criteria WHERE session_id = ? ORDER BY sort ASC").all(sessionId) as any[];
    expect(snap.map((r) => r.text)).toEqual(["K1"]);
  });
});

describe("UNIQUE observasi", () => {
  test("observasi ganda untuk murid yang sama dalam satu sesi ditolak database", () => {
    const sessionId = createSession(db, { class_id: 1, instrument_id: null, teacher_id: 2, scope: "individu", observed_at: "2026-10-24", activity: "A", note: "" });
    db.query("INSERT INTO observations (session_id, student_id, note) VALUES (?, 10, 'pertama')").run(sessionId);
    expect(() => {
      db.query("INSERT INTO observations (session_id, student_id, note) VALUES (?, 10, 'kedua')").run(sessionId);
    }).toThrow();
    const count = (db.query("SELECT COUNT(*) c FROM observations WHERE session_id = ?").get(sessionId) as any).c;
    expect(count).toBe(1);
  });
  test("observasi kelompok ganda ditolak database", () => {
    db.query("INSERT INTO groups (id, class_id, name) VALUES (1, 1, 'Kelompok 1')").run();
    const sessionId = createSession(db, { class_id: 1, instrument_id: null, teacher_id: 2, scope: "kelompok", observed_at: "2026-10-24", activity: "A", note: "" });
    db.query("INSERT INTO observations (session_id, group_id, note) VALUES (?, 1, 'pertama')").run(sessionId);
    expect(() => {
      db.query("INSERT INTO observations (session_id, group_id, note) VALUES (?, 1, 'kedua')").run(sessionId);
    }).toThrow();
  });
});

describe("impor transaksional", () => {
  test("impor murid dengan NIS duplikat membatalkan seluruh impor", () => {
    const before = (db.query("SELECT COUNT(*) c FROM students").get() as any).c;
    expect(() => {
      importStudents(db, 1, [
        { nis: "200", nama: "Baru 1" },
        { nis: "111", nama: "Duplikat" },
      ]);
    }).toThrow();
    const after = (db.query("SELECT COUNT(*) c FROM students").get() as any).c;
    expect(after).toBe(before);
  });
  test("impor murid valid berhasil", () => {
    const res = importStudents(db, 1, [{ nis: "201", nama: "Baru" }]);
    expect(res.inserted).toBe(1);
    const enr = db.query("SELECT 1 FROM enrollments WHERE class_id = 1 AND student_id = (SELECT id FROM students WHERE student_no = '201')").get() as any;
    expect(!!enr).toBe(true);
  });
  test("impor guru dengan username duplikat dibatalkan", () => {
    expect(() => {
      importTeachers(db, [
        { username: "baru1", nama: "Baru", password_hash: "h1" },
        { username: "guru1", nama: "Duplikat", password_hash: "h2" },
      ]);
    }).toThrow();
    expect(db.query("SELECT id FROM users WHERE username = 'baru1'").get()).toBeNull();
  });
  test("satu murid satu kelompok per kelas ditegakkan di impor kelompok", () => {
    db.query("INSERT INTO groups (id, class_id, name) VALUES (1, 1, 'Kelompok 1')").run();
    db.query("INSERT INTO group_members (group_id, student_id) VALUES (1, 10)").run();
    expect(() => {
      importGroups(db, 1, [{ nama_kelompok: "Kelompok 2", nis: "111" }]);
    }).toThrow();
  });
});

describe("cek hak (RBAC)", () => {
  test("guru pengampu boleh, guru lain tidak boleh membuka kelas", () => {
    expect(canAccessClass(db, user(2, "guru"), 1)).toBe(true);
    expect(canAccessClass(db, user(3, "guru"), 1)).toBe(false);
    expect(canAccessClass(db, user(1, "admin"), 1)).toBe(true);
    expect(canAccessClass(db, user(4, "pengamat", 1), 1)).toBe(true);
    expect(canAccessClass(db, user(5, "pengamat"), 1)).toBe(false);
  });
  test("pengamat murid hanya boleh muridnya sendiri", () => {
    expect(canAccessStudent(db, user(5, "pengamat"), 10)).toBe(true);
    expect(canAccessStudent(db, user(5, "pengamat"), 11)).toBe(false);
    expect(canAccessStudent(db, user(2, "guru"), 11)).toBe(true);
  });
  test("bukti: guru bukan pengampu dan pengamat murid lain ditolak", () => {
    const sessionId = createSession(db, { class_id: 1, instrument_id: null, teacher_id: 2, scope: "individu", observed_at: "2026-10-24", activity: "A", note: "" });
    const obs: any = db.query("INSERT INTO observations (session_id, student_id, note) VALUES (?, 10, 'x')").run(sessionId);
    const obsId = Number(obs.lastInsertRowid);
    const ev: any = db.query("INSERT INTO evidence (observation_id, kind, path, mime, bytes) VALUES (?, 'foto', 'a.jpg', 'image/jpeg', 100)").run(obsId);
    const evId = Number(ev.lastInsertRowid);
    expect(canAccessEvidence(db, user(2, "guru"), evId)).toBe(true);
    expect(canAccessEvidence(db, user(3, "guru"), evId)).toBe(false);
    expect(canAccessEvidence(db, user(5, "pengamat"), evId)).toBe(true);
    // pengamat lain (buat akun baru terikat murid 11)
    db.query("INSERT INTO users (id, username, name, password_hash, role) VALUES (6, '112', 'Ortu B', 'x', 'pengamat')").run();
    db.query("INSERT INTO observer_links (user_id, student_id) VALUES (6, 11)").run();
    expect(canAccessEvidence(db, user(6, "pengamat"), evId)).toBe(false);
  });
});

describe("narasi", () => {
  test("narasi menyebut nama murid dan label level", () => {
    const text = generateNarrative({
      studentName: "Ahmad",
      periodName: "2026/2027 Ganjil",
      criteria: [{ text: "Partisipasi", average: 3, levels: [{ v: 3, label: "Berkembang sesuai harapan" }], descriptor: "Berpartisipasi aktif." }],
      activities: ["Pidato"],
      notes: ["Anak percaya diri."],
      overall100: 75,
    });
    expect(text).toContain("Ahmad");
    expect(text).toContain("Berkembang sesuai harapan");
    expect(text).toContain("Pidato");
  });
});
