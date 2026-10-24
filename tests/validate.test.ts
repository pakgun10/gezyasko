import { describe, test, expect } from "bun:test";
import { validateScore, effectiveLevels } from "../src/lib/validate";

const LEVELS = JSON.stringify([
  { v: 1, label: "Belum muncul" },
  { v: 2, label: "Mulai muncul" },
  { v: 3, label: "Berkembang sesuai harapan" },
  { v: 4, label: "Membudaya" },
]);

describe("validasi nilai per input_type", () => {
  test("rubrik/skala harus sama dengan salah satu v", () => {
    expect(validateScore("rubrik", 3, LEVELS)).toBeNull();
    expect(validateScore("skala", 4, LEVELS)).toBeNull();
    expect(validateScore("rubrik", 5, LEVELS)).not.toBeNull();
    expect(validateScore("rubrik", 2.5, LEVELS)).not.toBeNull();
  });
  test("checklist hanya 0/1, level default bila kosong", () => {
    expect(validateScore("checklist", 0, "[]")).toBeNull();
    expect(validateScore("checklist", 1, "[]")).toBeNull();
    expect(validateScore("checklist", 2, "[]")).not.toBeNull();
    expect(effectiveLevels("checklist", "[]")).toEqual([
      { v: 0, label: "Belum" },
      { v: 1, label: "Ya" },
    ]);
  });
  test("teks tidak boleh punya skor", () => {
    expect(validateScore("teks", 3, LEVELS)).not.toBeNull();
  });
  test("nilai kosong = belum diisi, bukan kesalahan", () => {
    expect(validateScore("rubrik", null, LEVELS)).toBeNull();
    expect(validateScore("rubrik", undefined, LEVELS)).toBeNull();
  });
});
