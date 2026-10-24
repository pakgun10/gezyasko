// Koneksi bun:sqlite, skema, seed templat, dan operasi transaksional.
// Skema mengikuti implementation_plan.md bagian 4, ditambah satu kolom
// csrf_token di user_sessions untuk proteksi CSRF form login.
// Semua pernyataan DDL memakai IF NOT EXISTS agar aman dijalankan ulang.

import { Database } from "bun:sqlite";
import { join } from "node:path";
import { mkdirSync } from "node:fs";

export type Db = Database;

const SCHEMA = `
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;
PRAGMA busy_timeout = 5000;

CREATE TABLE IF NOT EXISTS settings (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  school_name TEXT NOT NULL DEFAULT 'Sekolah Saya',
  school_address TEXT,
  principal_name TEXT
);

CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY,
  username TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('admin', 'guru', 'pengamat')),
  can_view_all INTEGER NOT NULL DEFAULT 0,
  must_change_password INTEGER NOT NULL DEFAULT 0,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS user_sessions (
  id INTEGER PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  csrf_token TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  expires_at TEXT NOT NULL,
  last_seen_at TEXT
);

CREATE TABLE IF NOT EXISTS periods (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  starts_on TEXT, ends_on TEXT,
  is_active INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS classes (
  id INTEGER PRIMARY KEY,
  period_id INTEGER NOT NULL REFERENCES periods(id),
  name TEXT NOT NULL,
  level_label TEXT,
  UNIQUE (period_id, name)
);

CREATE TABLE IF NOT EXISTS students (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  student_no TEXT UNIQUE,
  active INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS enrollments (
  class_id INTEGER NOT NULL REFERENCES classes(id),
  student_id INTEGER NOT NULL REFERENCES students(id),
  PRIMARY KEY (class_id, student_id)
);

CREATE TABLE IF NOT EXISTS observer_links (
  user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  student_id INTEGER NOT NULL UNIQUE REFERENCES students(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS groups (
  id INTEGER PRIMARY KEY,
  class_id INTEGER NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  UNIQUE (class_id, name)
);

CREATE TABLE IF NOT EXISTS group_members (
  group_id INTEGER NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  student_id INTEGER NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  PRIMARY KEY (group_id, student_id)
);

CREATE TABLE IF NOT EXISTS class_teachers (
  id INTEGER PRIMARY KEY,
  class_id INTEGER NOT NULL REFERENCES classes(id),
  user_id INTEGER NOT NULL REFERENCES users(id),
  subject_label TEXT,
  UNIQUE (class_id, user_id, subject_label)
);

CREATE TABLE IF NOT EXISTS frameworks (
  id INTEGER PRIMARY KEY,
  owner_id INTEGER REFERENCES users(id),
  title TEXT NOT NULL,
  description TEXT,
  visibility TEXT NOT NULL DEFAULT 'private' CHECK (visibility IN ('private', 'sekolah')),
  is_template INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS goals (
  id INTEGER PRIMARY KEY,
  framework_id INTEGER NOT NULL REFERENCES frameworks(id) ON DELETE CASCADE,
  parent_id INTEGER REFERENCES goals(id),
  code TEXT,
  text TEXT NOT NULL,
  sort INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS instruments (
  id INTEGER PRIMARY KEY,
  owner_id INTEGER REFERENCES users(id),
  title TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('rubrik', 'checklist', 'skala', 'anekdotal', 'gabungan')),
  levels TEXT NOT NULL DEFAULT '[]',
  visibility TEXT NOT NULL DEFAULT 'private' CHECK (visibility IN ('private', 'sekolah')),
  is_template INTEGER NOT NULL DEFAULT 0,
  forked_from INTEGER REFERENCES instruments(id)
);

CREATE TABLE IF NOT EXISTS criteria (
  id INTEGER PRIMARY KEY,
  instrument_id INTEGER NOT NULL REFERENCES instruments(id) ON DELETE CASCADE,
  goal_id INTEGER REFERENCES goals(id),
  text TEXT NOT NULL,
  descriptors TEXT,
  weight REAL NOT NULL DEFAULT 1,
  input_type TEXT NOT NULL CHECK (input_type IN ('rubrik', 'checklist', 'skala', 'teks')),
  sort INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS sessions (
  id INTEGER PRIMARY KEY,
  class_id INTEGER NOT NULL REFERENCES classes(id),
  instrument_id INTEGER REFERENCES instruments(id),
  teacher_id INTEGER NOT NULL REFERENCES users(id),
  scope TEXT NOT NULL CHECK (scope IN ('individu', 'kelompok')),
  observed_at TEXT NOT NULL,
  activity TEXT,
  note TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS session_criteria (
  id INTEGER PRIMARY KEY,
  session_id INTEGER NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  source_criterion_id INTEGER REFERENCES criteria(id),
  goal_id INTEGER REFERENCES goals(id),
  text TEXT NOT NULL,
  descriptors TEXT,
  weight REAL NOT NULL DEFAULT 1,
  input_type TEXT NOT NULL CHECK (input_type IN ('rubrik', 'checklist', 'skala', 'teks')),
  sort INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS observations (
  id INTEGER PRIMARY KEY,
  session_id INTEGER NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  student_id INTEGER REFERENCES students(id),
  group_id INTEGER REFERENCES groups(id),
  note TEXT,
  client_uuid TEXT UNIQUE,
  created_at TEXT DEFAULT (datetime('now')),
  CHECK (
    (student_id IS NOT NULL AND group_id IS NULL) OR
    (student_id IS NULL AND group_id IS NOT NULL)
  )
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_obs_session_student ON observations(session_id, student_id) WHERE student_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_obs_session_group ON observations(session_id, group_id) WHERE group_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS member_notes (
  id INTEGER PRIMARY KEY,
  observation_id INTEGER NOT NULL REFERENCES observations(id) ON DELETE CASCADE,
  student_id INTEGER NOT NULL REFERENCES students(id),
  note TEXT NOT NULL,
  UNIQUE (observation_id, student_id)
);

CREATE TABLE IF NOT EXISTS scores (
  observation_id INTEGER NOT NULL REFERENCES observations(id) ON DELETE CASCADE,
  snapshot_criterion_id INTEGER NOT NULL REFERENCES session_criteria(id),
  value REAL NOT NULL,
  PRIMARY KEY (observation_id, snapshot_criterion_id)
);

CREATE TABLE IF NOT EXISTS evidence (
  id INTEGER PRIMARY KEY,
  observation_id INTEGER NOT NULL REFERENCES observations(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('foto', 'video_url')),
  path TEXT,
  url TEXT,
  caption TEXT,
  mime TEXT, bytes INTEGER,
  created_at TEXT DEFAULT (datetime('now')),
  CHECK ((kind = 'foto' AND path IS NOT NULL) OR (kind = 'video_url' AND url IS NOT NULL))
);

CREATE TABLE IF NOT EXISTS report_narratives (
  id INTEGER PRIMARY KEY,
  student_id INTEGER NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  period_id INTEGER NOT NULL REFERENCES periods(id) ON DELETE CASCADE,
  narrative TEXT NOT NULL,
  edited_by INTEGER REFERENCES users(id),
  updated_at TEXT DEFAULT (datetime('now')),
  UNIQUE (student_id, period_id)
);

CREATE TABLE IF NOT EXISTS audit_logs (
  id INTEGER PRIMARY KEY,
  user_id INTEGER REFERENCES users(id),
  action TEXT NOT NULL,
  entity TEXT, entity_id INTEGER,
  detail TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_obs_student ON observations(student_id, created_at);
CREATE INDEX IF NOT EXISTS idx_obs_group ON observations(group_id, created_at);
CREATE INDEX IF NOT EXISTS idx_sessions_class ON sessions(class_id, observed_at);
CREATE INDEX IF NOT EXISTS idx_enroll_student ON enrollments(student_id);
CREATE INDEX IF NOT EXISTS idx_group_member_student ON group_members(student_id);
`;

export function openDb(dbPath: string): Database {
  const db = new Database(dbPath, { create: true });
  db.exec("PRAGMA journal_mode = WAL;");
  db.exec("PRAGMA foreign_keys = ON;");
  db.exec("PRAGMA busy_timeout = 5000;");
  db.exec(SCHEMA);
  db.run("INSERT OR IGNORE INTO settings (id, school_name) VALUES (1, 'Sekolah Saya')");
  return db;
}

export function resolveDataDir(): string {
  const dir = process.env.DATA_DIR || join(process.cwd(), "data");
  mkdirSync(dir, { recursive: true });
  mkdirSync(join(dir, "bukti"), { recursive: true });
  return dir;
}

export function dbPathFor(dataDir: string): string {
  return join(dataDir, "gezyasko.db");
}

/** Salin kriteria instrumen ke session_criteria. Dipanggil tepat saat sesi dibuat. */
export function snapshotInstrument(db: Database, sessionId: number, instrumentId: number | null): void {
  if (!instrumentId) return;
  const rows = db.query("SELECT * FROM criteria WHERE instrument_id = ? ORDER BY sort ASC, id ASC").all(instrumentId) as any[];
  const insert = db.query(
    "INSERT INTO session_criteria (session_id, source_criterion_id, goal_id, text, descriptors, weight, input_type, sort) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
  );
  for (const r of rows) {
    insert.run(sessionId, r.id, r.goal_id, r.text, r.descriptors, r.weight, r.input_type, r.sort);
  }
}

/** Buat sesi + snapshot dalam satu transaksi. Mengembalikan id sesi. */
export function createSession(
  db: Database,
  input: { class_id: number; instrument_id: number | null; teacher_id: number; scope: string; observed_at: string; activity: string; note: string },
): number {
  const tx = db.transaction(() => {
    const info: any = db
      .query("INSERT INTO sessions (class_id, instrument_id, teacher_id, scope, observed_at, activity, note) VALUES (?, ?, ?, ?, ?, ?, ?)")
      .run(input.class_id, input.instrument_id, input.teacher_id, input.scope, input.observed_at, input.activity || null, input.note || null);
    const sessionId = Number(info.lastInsertRowid);
    snapshotInstrument(db, sessionId, input.instrument_id);
    return sessionId;
  });
  return tx() as number;
}

export function audit(db: Database, userId: number | null, action: string, entity: string | null, entityId: number | null, detail: unknown): void {
  try {
    db.query("INSERT INTO audit_logs (user_id, action, entity, entity_id, detail) VALUES (?, ?, ?, ?, ?)").run(
      userId, action, entity, entityId, JSON.stringify(detail ?? {}),
    );
  } catch {
    // audit tidak boleh menggagalkan aksi utama
  }
}

type TemplateCriterion = {
  text: string;
  descriptors: Record<string, string>;
  weight: number;
  input_type: string;
  sort: number;
};

function seedTemplateInstrument(
  db: Database,
  ownerId: number,
  title: string,
  kind: string,
  levels: { v: number; label: string }[],
  criteria: TemplateCriterion[],
): void {
  const exists = db.query("SELECT id FROM instruments WHERE title = ? AND is_template = 1").get(title) as any;
  if (exists) return;
  const info: any = db
    .query("INSERT INTO instruments (owner_id, title, kind, levels, visibility, is_template) VALUES (?, ?, ?, ?, 'sekolah', 1)")
    .run(ownerId, title, kind, JSON.stringify(levels));
  const instrumentId = Number(info.lastInsertRowid);
  for (const c of criteria) {
    db.query("INSERT INTO criteria (instrument_id, goal_id, text, descriptors, weight, input_type, sort) VALUES (?, NULL, ?, ?, ?, ?, ?)").run(
      instrumentId, c.text, JSON.stringify(c.descriptors), c.weight, c.input_type, c.sort,
    );
  }
}

/** Seed templat bawaan. Idempotent berdasarkan judul + is_template=1. */
export function seedTemplates(db: Database, ownerId: number): void {
  const levels14 = [
    { v: 1, label: "Belum muncul" },
    { v: 2, label: "Mulai muncul" },
    { v: 3, label: "Berkembang sesuai harapan" },
    { v: 4, label: "Membudaya" },
  ];
  const desc = (a: string, b: string, c: string, d: string) => ({ "1": a, "2": b, "3": c, "4": d });
  seedTemplateInstrument(db, ownerId, "Rubrik Observasi Umum", "rubrik", levels14, [
    { text: "Partisipasi", descriptors: desc("Belum berpartisipasi.", "Mulai berpartisipasi bila diminta.", "Berpartisipasi aktif sesuai harapan.", "Berpartisipasi aktif dan mengajak teman."), weight: 1, input_type: "rubrik", sort: 1 },
    { text: "Kerja sama", descriptors: desc("Belum bekerja sama.", "Mulai bekerja sama dengan bantuan.", "Bekerja sama dengan baik.", "Bekerja sama sangat baik dan membantu anggota lain."), weight: 1, input_type: "rubrik", sort: 2 },
    { text: "Keterampilan", descriptors: desc("Keterampilan belum tampak.", "Keterampilan mulai tampak.", "Keterampilan sesuai harapan.", "Keterampilan membudaya dan konsisten."), weight: 1, input_type: "rubrik", sort: 3 },
  ]);
  seedTemplateInstrument(db, ownerId, "Checklist Keterampilan", "checklist", [
    { v: 0, label: "Belum" },
    { v: 1, label: "Ya" },
  ], [
    { text: "Mengikuti langkah kerja", descriptors: {}, weight: 1, input_type: "checklist", sort: 1 },
    { text: "Menyelesaikan tugas tepat waktu", descriptors: {}, weight: 1, input_type: "checklist", sort: 2 },
    { text: "Merapikan peralatan setelah kegiatan", descriptors: {}, weight: 1, input_type: "checklist", sort: 3 },
  ]);
  seedTemplateInstrument(db, ownerId, "Skala Sikap", "skala", levels14, [
    { text: "Tanggung jawab", descriptors: desc("Belum menunjukkan tanggung jawab.", "Mulai menunjukkan tanggung jawab.", "Menunjukkan tanggung jawab sesuai harapan.", "Sangat bertanggung jawab dan dapat diandalkan."), weight: 1, input_type: "skala", sort: 1 },
    { text: "Kemandirian", descriptors: desc("Sangat bergantung pada bantuan.", "Mulai mandiri dengan bantuan.", "Mandiri sesuai harapan.", "Sangat mandiri dan inisiatif."), weight: 1, input_type: "skala", sort: 2 },
  ]);
  seedTemplateInstrument(db, ownerId, "Catatan Anekdotal", "anekdotal", [], [
    { text: "Catatan perilaku", descriptors: {}, weight: 1, input_type: "teks", sort: 1 },
  ]);
  const fw = db.query("SELECT id FROM frameworks WHERE title = ? AND is_template = 1").get("Kerangka Observasi Umum") as any;
  if (!fw) {
    const info: any = db.query("INSERT INTO frameworks (owner_id, title, description, visibility, is_template) VALUES (?, ?, ?, 'sekolah', 1)").run(
      ownerId, "Kerangka Observasi Umum", "Kerangka contoh yang bisa disalin dan diubah.",
    );
    const fwId = Number(info.lastInsertRowid);
    db.query("INSERT INTO goals (framework_id, parent_id, code, text, sort) VALUES (?, NULL, 'A', 'Sikap dan partisipasi', 1)").run(fwId);
    db.query("INSERT INTO goals (framework_id, parent_id, code, text, sort) VALUES (?, NULL, 'B', 'Keterampilan unjuk kerja', 2)").run(fwId);
  }
}

/** Seed admin pertama. Kata sandi HANYA dari env SEED_ADMIN_PASSWORD atau acak sekali tampil di log. */
export async function seedAdminIfEmpty(db: Database): Promise<{ created: boolean; username: string }> {
  const count = (db.query("SELECT COUNT(*) as c FROM users").get() as any).c as number;
  if (count > 0) return { created: false, username: "admin" };
  const envPw = process.env.SEED_ADMIN_PASSWORD;
  let password = envPw;
  if (!password) {
    password = `ganti-${Math.random().toString(36).slice(2, 10)}-segera`;
    console.log("[gezyasko] Akun admin pertama dibuat. Username: admin. Kata sandi awal (sekali tampil, segera ganti):", password);
  }
  const hash = await Bun.password.hash(password, { algorithm: "argon2id" });
  const info: any = db.query("INSERT INTO users (username, name, password_hash, role, must_change_password) VALUES ('admin', 'Administrator', ?, 'admin', 0)").run(hash);
  seedTemplates(db, Number(info.lastInsertRowid));
  return { created: true, username: "admin" };
}
