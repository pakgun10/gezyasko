import { describe, test, expect } from "bun:test";
import { parseCSV, tableFromCSV, validateStudentRows, validateTeacherRows } from "../src/lib/csv";

describe("parser CSV", () => {
  test("koma di dalam kutip tidak memecah kolom", () => {
    expect(parseCSV('nis,nama\n123,"Fauzi, Ahmad"\n')).toEqual([
      ["nis", "nama"],
      ["123", "Fauzi, Ahmad"],
    ]);
  });
  test("header wajib yang hilang dilaporkan", () => {
    const t = tableFromCSV("nis\n123\n", ["nis", "nama"]);
    expect(t.errors.length).toBeGreaterThan(0);
  });
  test("NIS duplikat di dalam berkas ditolak di validasi", () => {
    const { errors } = validateStudentRows([
      { nis: "123", nama: "A" },
      { nis: "123", nama: "B" },
    ]);
    expect(errors.length).toBeGreaterThan(0);
  });
  test("username duplikat guru ditolak di validasi", () => {
    const { errors } = validateTeacherRows([
      { username: "budi", nama: "Budi", password_awal: "x" },
      { username: "budi", nama: "Budi 2", password_awal: "y" },
    ]);
    expect(errors.length).toBeGreaterThan(0);
  });
  test("baris kosong di akhir diabaikan", () => {
    const rows = parseCSV("nis,nama\n123,A\n\n");
    expect(rows.length).toBe(2);
  });
});
