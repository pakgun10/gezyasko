// Validasi nilai observasi per input_type (plan bagian 4).
import { parseLevels, hasRanges, type Level } from "./scores";

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

export type RubricScore = { value: number; level: number };

/**
 * Selesaikan skor rubrik pola Aspro dari dua datum yang dikirim formulir:
 * posisi level yang diklik + bilangan bulat yang diketik.
 * - Keduanya kosong -> null (belum diisi, bukan kesalahan).
 * - Level wajib diklik bila ada nilai; level harus ada di levels.
 * - Bila level memakai rentang: nilai kosong -> def; nilai wajib
 *   bilangan bulat di dalam min..max.
 * - Bila level tanpa rentang (instrumen lama): nilai kosong -> v.
 * Mengembalikan { value, level } atau { error }.
 */
export function resolveRubricScore(
  levelV: number | null | undefined,
  value: number | null | undefined,
  levelsRaw: string | null | undefined,
): RubricScore | { error: string } | null {
  if ((levelV === null || levelV === undefined) && (value === null || value === undefined)) return null;
  if (levelV === null || levelV === undefined) return { error: "Pilih level dulu sebelum mengisi nilai." };
  const levels = parseLevels(levelsRaw);
  const level = levels.find((l) => l.v === levelV);
  if (!level) return { error: `Level ${levelV} tidak ada di instrumen.` };
  if (!hasRanges(levels)) {
    return { value: value ?? levelV, level: levelV };
  }
  if (typeof level.min !== "number" || typeof level.max !== "number") {
    return { error: `Level "${level.label}" belum punya rentang min–max.` };
  }
  let v = value;
  if (v === null || v === undefined) {
    if (typeof level.def !== "number") return { error: `Isi nilai untuk level "${level.label}".` };
    v = level.def;
  }
  if (!Number.isInteger(v)) return { error: `Nilai untuk level "${level.label}" harus bilangan bulat.` };
  if (v < level.min || v > level.max) {
    return { error: `Nilai untuk level "${level.label}" harus dalam rentang ${level.min}–${level.max}.` };
  }
  return { value: v, level: levelV };
}
