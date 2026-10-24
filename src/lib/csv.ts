// Parser CSV + validasi baris (tanpa akses database).
// Impor transaksional ada di src/lib/imports.ts: bila ada satu baris
// tidak valid, seluruh impor dibatalkan.

/** Parser CSV sederhana yang menangani kutip ganda dan koma di dalam kutip. */
export function parseCSV(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  const pushField = () => {
    row.push(field);
    field = "";
  };
  const pushRow = () => {
    pushField();
    rows.push(row);
    row = [];
  };
  const s = text.replace(/^\uFEFF/, "");
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (inQuotes) {
      if (ch === '"') {
        if (s[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ",") {
      pushField();
    } else if (ch === "\r") {
      // abaikan, \n yang menutup baris
    } else if (ch === "\n") {
      pushRow();
    } else {
      field += ch;
    }
  }
  if (field !== "" || row.length > 0) pushRow();
  // Buang baris kosong di akhir
  while (rows.length && rows[rows.length - 1]!.every((c) => c.trim() === "")) rows.pop();
  return rows;
}

export type CsvTable = { headers: string[]; rows: Record<string, string>[]; errors: string[] };

/** Ubah teks CSV menjadi tabel ber-header. Header dicocokkan persis (case-insensitive, trim). */
export function tableFromCSV(text: string, expectedHeaders: string[]): CsvTable {
  const raw = parseCSV(text);
  const errors: string[] = [];
  if (!raw.length) return { headers: [], rows: [], errors: ["Berkas CSV kosong."] };
  const headers = raw[0]!.map((h) => h.trim().toLowerCase());
  for (const h of expectedHeaders) {
    if (!headers.includes(h)) errors.push(`Kolom wajib "${h}" tidak ditemukan. Header yang ada: ${raw[0]!.join(", ")}.`);
  }
  const rows: Record<string, string>[] = [];
  for (let i = 1; i < raw.length; i++) {
    const line = raw[i]!;
    if (line.every((c) => c.trim() === "")) continue;
    if (line.length !== headers.length) {
      errors.push(`Baris ${i + 1}: jumlah kolom (${line.length}) tidak sama dengan header (${headers.length}).`);
      continue;
    }
    const obj: Record<string, string> = {};
    headers.forEach((h, idx) => {
      obj[h] = (line[idx] || "").trim();
    });
    rows.push(obj);
  }
  if (!rows.length && !errors.length) errors.push("Tidak ada baris data di CSV.");
  return { headers, rows, errors };
}

export type StudentRow = { nis: string; nama: string };
export type TeacherRow = { username: string; nama: string; password_awal: string };
export type GroupRow = { nama_kelompok: string; nis: string };

export function validateStudentRows(rows: Record<string, string>[]): { data: StudentRow[]; errors: string[] } {
  const errors: string[] = [];
  const seen = new Set<string>();
  const data: StudentRow[] = [];
  rows.forEach((r, i) => {
    const line = i + 2;
    const nis = r["nis"] || "";
    const nama = r["nama"] || "";
    if (!nama) errors.push(`Baris ${line}: nama kosong.`);
    if (!nis) errors.push(`Baris ${line}: NIS kosong.`);
    if (nis && seen.has(nis)) errors.push(`Baris ${line}: NIS duplikat di dalam berkas: ${nis}.`);
    if (nis) seen.add(nis);
    data.push({ nis, nama });
  });
  return { data, errors };
}

export function validateTeacherRows(rows: Record<string, string>[]): { data: TeacherRow[]; errors: string[] } {
  const errors: string[] = [];
  const seen = new Set<string>();
  const data: TeacherRow[] = [];
  rows.forEach((r, i) => {
    const line = i + 2;
    const username = r["username"] || "";
    const nama = r["nama"] || "";
    const password_awal = r["password_awal"] || "";
    if (!username) errors.push(`Baris ${line}: username kosong.`);
    if (!nama) errors.push(`Baris ${line}: nama kosong.`);
    if (username && seen.has(username)) errors.push(`Baris ${line}: username duplikat di dalam berkas: ${username}.`);
    if (username) seen.add(username);
    data.push({ username, nama, password_awal });
  });
  return { data, errors };
}

export function validateGroupRows(rows: Record<string, string>[]): { data: GroupRow[]; errors: string[] } {
  const errors: string[] = [];
  const data: GroupRow[] = [];
  rows.forEach((r, i) => {
    const line = i + 2;
    const nama_kelompok = r["nama_kelompok"] || "";
    const nis = r["nis"] || "";
    if (!nama_kelompok) errors.push(`Baris ${line}: nama_kelompok kosong.`);
    if (!nis) errors.push(`Baris ${line}: NIS kosong.`);
    data.push({ nama_kelompok, nis });
  });
  return { data, errors };
}
