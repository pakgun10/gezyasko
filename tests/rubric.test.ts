import { describe, test, expect } from "bun:test";
import { parseLevels, hasRanges, scaleForLevels, validateLevels, fmtDual, levelForValueInRange } from "../src/lib/scores";
import { resolveRubricScore } from "../src/lib/validate";

// Set level Aspro: Kekompakan & Sinkronisasi Gerakan.
const ASPRO = JSON.stringify([
  { v: 1, label: "Kurang kompak", min: 0, max: 64, def: 50 },
  { v: 2, label: "Cukup kompak", min: 65, max: 77, def: 71 },
  { v: 3, label: "Kompak", min: 78, max: 89, def: 84 },
  { v: 4, label: "Sangat kompak", min: 90, max: 100, def: 95 },
]);

const OLD = JSON.stringify([
  { v: 1, label: "Belum muncul" },
  { v: 2, label: "Mulai muncul" },
  { v: 3, label: "Berkembang sesuai harapan" },
  { v: 4, label: "Membudaya" },
]);

describe("rubrik pola Aspro: level rentang", () => {
  test("parseLevels mempertahankan min/max/def, skala = 100", () => {
    const levels = parseLevels(ASPRO);
    expect(levels[2]).toEqual({ v: 3, label: "Kompak", min: 78, max: 89, def: 84 });
    expect(hasRanges(levels)).toBe(true);
    expect(scaleForLevels(levels)).toBe(100);
    expect(hasRanges(parseLevels(OLD))).toBe(false);
    expect(scaleForLevels(parseLevels(OLD))).toBe(4);
  });
  test("validateLevels menolak rentang sebagian dan def di luar rentang", () => {
    expect(validateLevels(parseLevels(ASPRO))).toBeNull();
    const partial = JSON.stringify([
      { v: 1, label: "A", min: 0, max: 64, def: 50 },
      { v: 2, label: "B" },
    ]);
    expect(validateLevels(parseLevels(partial))).not.toBeNull();
    const badDef = JSON.stringify([
      { v: 1, label: "A", min: 0, max: 64, def: 90 },
      { v: 2, label: "B", min: 65, max: 100, def: 80 },
    ]);
    expect(validateLevels(parseLevels(badDef))).not.toBeNull();
  });
  test("klik Kompak + ketik 85 -> tersimpan posisi 3 dan nilai 85", () => {
    expect(resolveRubricScore(3, 85, ASPRO)).toEqual({ value: 85, level: 3 });
  });
  test("klik Kompak + kosong -> nilai awal 84", () => {
    expect(resolveRubricScore(3, null, ASPRO)).toEqual({ value: 84, level: 3 });
  });
  test("nilai di luar rentang, desimal, dan tanpa level ditolak", () => {
    expect(resolveRubricScore(3, 90, ASPRO)).toEqual({ error: expect.stringContaining("78–89") });
    expect(resolveRubricScore(3, 85.5, ASPRO)).toEqual({ error: expect.stringContaining("bilangan bulat") });
    expect(resolveRubricScore(null, 85, ASPRO)).toEqual({ error: expect.stringContaining("Pilih level") });
    expect(resolveRubricScore(9, 85, ASPRO)).toEqual({ error: expect.stringContaining("tidak ada") });
  });
  test("keduanya kosong = belum diisi; instrumen lama tetap nilai = v", () => {
    expect(resolveRubricScore(null, null, ASPRO)).toBeNull();
    expect(resolveRubricScore(3, null, OLD)).toEqual({ value: 3, level: 3 });
  });
  test("narasi: rata-rata 86 jatuh ke rentang Kompak, format 85 dari 100 tidak berulang", () => {
    expect(levelForValueInRange(parseLevels(ASPRO), 86)?.label).toBe("Kompak");
    expect(fmtDual(85, 100)).toBe("85 dari 100");
  });
});
