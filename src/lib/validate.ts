// Validasi nilai observasi per input_type (plan bagian 4).
import { parseLevels, type Level } from "./scores";

export type InputType = "rubrik" | "checklist" | "skala" | "teks";

export const CHECKLIST_LEVELS: Level[] = [
  { v: 0, label: "Belum" },
  { v: 1, label: "Ya" },
];

/** Level yang berlaku untuk satu kriteria: checklist memakai default bila levels kosong. */
export function effectiveLevels(inputType: InputType, levelsRaw: string | null | undefined): Level[] {
  if (inputType === "checklist") {
    const parsed = parseLevels(levelsRaw);
    return parsed.length ? parsed : CHECKLIST_LEVELS;
  }
  return parseLevels(levelsRaw);
}

/**
 * Mengembalikan null bila nilai valid, atau pesan kesalahan bila tidak.
 * - teks: tidak boleh punya skor (nilai apa pun ditolak; catatan dipakai sebagai gantinya).
 * - checklist: hanya 0 atau 1.
 * - rubrik/skala: harus sama persis dengan salah satu v di levels.
 * - nilai kosong (null/undefined/"") dianggap "belum diisi", bukan kesalahan;
 *   observasi sebagian tetap boleh disimpan dan ditandai belum lengkap.
 */
export function validateScore(
  inputType: InputType,
  value: number | null | undefined,
  levelsRaw: string | null | undefined,
): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== "number" || !Number.isFinite(value)) return "Nilai harus berupa angka.";
  if (inputType === "teks") return "Kriteria teks tidak boleh memiliki skor; gunakan catatan.";
  if (inputType === "checklist") {
    if (value !== 0 && value !== 1) return "Checklist hanya boleh 0 atau 1.";
    return null;
  }
  const levels = effectiveLevels(inputType, levelsRaw);
  if (!levels.length) return "Instrumen belum memiliki level, sehingga nilai tidak bisa divalidasi.";
  if (!levels.some((l) => l.v === value)) {
    return `Nilai ${value} tidak ada di level instrumen (${levels.map((l) => l.v).join(", ")}).`;
  }
  return null;
}

export function parseScoreInput(raw: string | null | undefined): number | null {
  if (raw === null || raw === undefined || raw === "") return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}
