// Impor transaksional (plan bagian 8). Fungsi-fungsi ini melempar Error
// bila ada baris tidak valid; route menangkapnya, membatalkan transaksi,
// dan menampilkan daftar kesalahan. Tidak ada impor setengah jalan.

import type { Database } from "bun:sqlite";
import type { StudentRow, GroupRow } from "./csv";

function tx<T>(db: Database, fn: () => T): T {
  const run = db.transaction(fn);
  return run() as T;
}

export function importStudents(db: Database, classId: number, rows: StudentRow[]): { inserted: number } {
  return tx(db, () => {
    const cls = db.query("SELECT id FROM classes WHERE id = ?").get(classId) as any;
    if (!cls) throw new Error("Kelas tujuan tidak ditemukan.");
    for (const r of rows) {
      if (!r.nama) throw new Error(`Nama kosong (NIS ${r.nis || "-"}).`);
      if (!r.nis) throw new Error(`NIS kosong (nama ${r.nama || "-"}).`);
      const dup = db.query("SELECT id FROM students WHERE student_no = ?").get(r.nis) as any;
      if (dup) throw new Error(`NIS duplikat dengan data yang sudah ada: ${r.nis}.`);
    }
    let inserted = 0;
    for (const r of rows) {
      const info: any = db.query("INSERT INTO students (name, student_no) VALUES (?, ?)").run(r.nama, r.nis);
      db.query("INSERT INTO enrollments (class_id, student_id) VALUES (?, ?)").run(classId, Number(info.lastInsertRowid));
      inserted++;
    }
    return { inserted };
  });
}

export type TeacherRowWithHash = { username: string; nama: string; password_hash: string };

/** Impor guru dengan hash yang sudah dibuat di luar transaksi (argon2id bersifat async). */
export function importTeachers(db: Database, rows: TeacherRowWithHash[]): { inserted: number } {
  return tx(db, () => {
    for (const r of rows) {
      if (!r.username || !r.nama || !r.password_hash) throw new Error(`Username/nama/hash kosong (baris ${r.username || "-"}).`);
      const dup = db.query("SELECT id FROM users WHERE username = ?").get(r.username) as any;
      if (dup) throw new Error(`Username duplikat dengan data yang sudah ada: ${r.username}.`);
    }
    let inserted = 0;
    for (const r of rows) {
      db.query("INSERT INTO users (username, name, password_hash, role, must_change_password) VALUES (?, ?, ?, 'guru', 1)").run(
        r.username, r.nama, r.password_hash,
      );
      inserted++;
    }
    return { inserted };
  });
}

// Alias lama untuk kompatibilitas pengujian: menerima TeacherRow + hashFn sudah tidak dipakai.
// (Dihapus dari API publik; route memakai importTeachers dengan hash yang sudah dibuat.)

export function importGroups(db: Database, classId: number, rows: GroupRow[]): { groups: number; members: number } {
  return tx(db, () => {
    const cls = db.query("SELECT id FROM classes WHERE id = ?").get(classId) as any;
    if (!cls) throw new Error("Kelas tujuan tidak ditemukan.");
    // Validasi penuh dulu
    const groupNames = new Map<string, number>();
    for (const r of rows) {
      const student = db.query("SELECT id FROM students WHERE student_no = ?").get(r.nis) as any;
      if (!student) throw new Error(`NIS tidak ditemukan: ${r.nis}.`);
      const enrolled = db.query("SELECT 1 FROM enrollments WHERE class_id = ? AND student_id = ?").get(classId, student.id) as any;
      if (!enrolled) throw new Error(`NIS ${r.nis} bukan murid kelas ini.`);
      const already = db.query(
        "SELECT g.name FROM group_members gm JOIN groups g ON g.id = gm.group_id WHERE g.class_id = ? AND gm.student_id = ?",
      ).get(classId, student.id) as any;
      if (already) throw new Error(`NIS ${r.nis} sudah berada di kelompok "${already.name}" pada kelas ini (satu murid satu kelompok per kelas).`);
      groupNames.set(r.nama_kelompok, (groupNames.get(r.nama_kelompok) || 0) + 1);
    }
    let members = 0;
    for (const [name] of groupNames) {
      const existing = db.query("SELECT id FROM groups WHERE class_id = ? AND name = ?").get(classId, name) as any;
      if (!existing) db.query("INSERT INTO groups (class_id, name) VALUES (?, ?)").run(classId, name);
    }
    for (const r of rows) {
      const student = db.query("SELECT id FROM students WHERE student_no = ?").get(r.nis) as any;
      const group = db.query("SELECT id FROM groups WHERE class_id = ? AND name = ?").get(classId, r.nama_kelompok) as any;
      db.query("INSERT OR IGNORE INTO group_members (group_id, student_id) VALUES (?, ?)").run(group.id, student.id);
      members++;
    }
    return { groups: groupNames.size, members };
  });
}
