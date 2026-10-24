import { describe, test, expect } from "bun:test";
import {
  observationScore,
  to100,
  fmtDual,
  goalScore,
  overallScore,
  trendPoints,
  subtreeIds,
  type GoalNode,
} from "../src/lib/scores";

describe("rumus skor (plan bagian 6)", () => {
  test("rata-rata berbobot observasi", () => {
    expect(observationScore([{ value: 4, weight: 1 }, { value: 2, weight: 1 }])).toBe(3);
    expect(observationScore([{ value: 4, weight: 2 }, { value: 2, weight: 1 }])).toBeCloseTo(10 / 3, 10);
  });
  test("observasi tanpa kriteria berskor menghasilkan null", () => {
    expect(observationScore([])).toBeNull();
  });
  test("skor 0-100 dan format ganda (contoh plan: 3,25 dari 4 = 81)", () => {
    expect(to100(3.25, 4)).toBeCloseTo(81.25, 10);
    expect(fmtDual(3.25, 4)).toBe("3.25 dari 4 (81 dari 100)");
  });
  test("checklist: nilai 0/1, max 1 -> 0 atau 100", () => {
    expect(to100(observationScore([{ value: 1, weight: 1 }, { value: 0, weight: 1 }]), 1)).toBe(50);
  });
  test("skor keseluruhan = rata-rata skor observasi", () => {
    expect(overallScore([3, 4, null])).toBe(3.5);
    expect(overallScore([null])).toBeNull();
  });
  test("rollup tujuan: anak digulung ke induk", () => {
    const goals: GoalNode[] = [
      { id: 1, parent_id: null, text: "Induk" },
      { id: 2, parent_id: 1, text: "Anak" },
      { id: 3, parent_id: null, text: "Lain" },
    ];
    expect(subtreeIds(goals, 1).has(2)).toBe(true);
    expect(subtreeIds(goals, 1).has(3)).toBe(false);
    const entries = [
      { goalId: 2, value: 4, weight: 1 },
      { goalId: 3, value: 1, weight: 1 },
    ];
    expect(goalScore(goals, 1, entries)).toBe(4);
    expect(goalScore(goals, 3, entries)).toBe(1);
  });
  test("tren diurutkan berdasarkan tanggal dan hanya yang berskor", () => {
    const pts = trendPoints([
      { observationId: 2, sessionId: 1, activity: "B", observedAt: "2026-10-20", instrumentTitle: null, scope: "individu", groupName: null, isGroup: false, score: 4, score100: 100, maxLevel: 4, complete: true, note: null },
      { observationId: 1, sessionId: 1, activity: "A", observedAt: "2026-10-10", instrumentTitle: null, scope: "individu", groupName: null, isGroup: false, score: 2, score100: 50, maxLevel: 4, complete: true, note: null },
      { observationId: 3, sessionId: 1, activity: "C", observedAt: "2026-10-25", instrumentTitle: null, scope: "individu", groupName: null, isGroup: false, score: null, score100: null, maxLevel: 4, complete: false, note: null },
    ] as any);
    expect(pts.map((p) => p.date)).toEqual(["2026-10-10", "2026-10-20"]);
    expect(pts[0].score100).toBe(50);
  });
});
