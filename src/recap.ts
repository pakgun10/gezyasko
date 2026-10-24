// Pengambilan data rekap dari database + perhitungan memakai src/lib/scores.
// Dipakai oleh halaman profil murid, rekap kelas, dan cetak.

import type { Database } from "bun:sqlite";
import {
  observationScore,
  to100,
  parseLevels,
  labelFor,
  criterionAverages,
  goalScore,
  overallScore,
  type ExpandedObservation,
  type GoalNode,
} from "./lib/scores";
import { effectiveLevels } from "./lib/validate";

export type RawObservation = {
  id: number;
  session_id: number;
  student_id: number | null;
  group_id: number | null;
  note: string | null;
  activity: string | null;
  observed_at: string;
  scope: string;
  instrument_title: string | null;
  levels_raw: string | null;
  group_name: string | null;
  class_id: number;
  period_id: number;
  period_name: string | null;
};

export function fetchObservationsForStudent(db: Database, studentId: number): RawObservation[] {
  // Observasi individu milik murid + observasi kelompok yang anggotanya murid ini.
  const rows = db
    .query(
      `SELECT o.id, o.session_id, o.student_id, o.group_id, o.note,
              s.activity, s.observed_at, s.scope, i.title AS instrument_title, i.levels AS levels_raw,
              g.name AS group_name, s.class_id, c.period_id, p.name AS period_name
       FROM observations o
       JOIN sessions s ON s.id = o.session_id
       LEFT JOIN instruments i ON i.id = s.instrument_id
       LEFT JOIN groups g ON g.id = o.group_id
       JOIN classes c ON c.id = s.class_id
       LEFT JOIN periods p ON p.id = c.period_id
       WHERE o.student_id = ?
          OR o.group_id IN (SELECT group_id FROM group_members WHERE student_id = ?)
       ORDER BY s.observed_at ASC, o.id ASC`,
    )
    .all(studentId, studentId) as any[];
  return rows as RawObservation[];
}

export function scoresForObservation(db: Database, observationId: number): { snapshotId: number; value: number; weight: number; text: string; goalId: number | null; inputType: string }[] {
  return db
    .query(
      `SELECT sc.id AS snapshotId, sc.weight, sc.text, sc.goal_id AS goalId, sc.input_type AS inputType, s.value
       FROM scores s JOIN session_criteria sc ON sc.id = s.snapshot_criterion_id
       WHERE s.observation_id = ? ORDER BY sc.sort ASC, sc.id ASC`,
    )
    .all(observationId) as any[];
}

export function criteriaForSession(db: Database, sessionId: number): any[] {
  return db.query("SELECT * FROM session_criteria WHERE session_id = ? ORDER BY sort ASC, id ASC").all(sessionId) as any[];
}

export function expandObservations(db: Database, raw: RawObservation[]): ExpandedObservation[] {
  const out: ExpandedObservation[] = [];
  for (const r of raw) {
    const scored = scoresForObservation(db, r.id);
    const crit = criteriaForSession(db, r.session_id);
    const levels = parseLevels(r.levels_raw);
    const maxLvl = levels.length ? Math.max(...levels.map((l) => l.v)) : 4;
    const score = observationScore(scored);
    const complete = crit.filter((c) => c.input_type !== "teks").every((c) => scored.some((s) => s.snapshotId === c.id));
    out.push({
      observationId: r.id,
      sessionId: r.session_id,
      activity: r.activity,
      observedAt: r.observed_at,
      instrumentTitle: r.instrument_title,
      scope: r.scope,
      groupName: r.group_name,
      isGroup: r.group_id !== null,
      score,
      score100: to100(score, maxLvl),
      maxLevel: maxLvl,
      complete,
      note: r.note,
    });
  }
  return out;
}

export type StudentRecap = {
  observations: ExpandedObservation[];
  overall: number | null;
  overall100: number | null;
  perInstrument: { title: string; average: number | null; average100: number | null; count: number }[];
  perCriterion: ReturnType<typeof criterionAverages>;
  perGoal: { id: number; text: string; score: number | null }[];
  notes: string[];
  activities: string[];
};

export function studentRecap(db: Database, studentId: number, periodId: number | null): StudentRecap {
  let raw = fetchObservationsForStudent(db, studentId);
  if (periodId !== null) raw = raw.filter((r) => r.period_id === periodId);
  const expanded = expandObservations(db, raw);
  // Entri nilai mentah untuk rata-rata kriteria dan tujuan
  const entries: { snapshotId: number; text: string; goalId: number | null; value: number; label: string }[] = [];
  const goalEntries: { goalId: number | null; value: number; weight: number }[] = [];
  const critLevels = new Map<number, { levels: any[]; text: string }>();
  for (const r of raw) {
    const levels = parseLevels(r.levels_raw);
    const scored = scoresForObservation(db, r.id);
    const crit = criteriaForSession(db, r.session_id);
    for (const s of scored) {
      const c = crit.find((x) => x.id === s.snapshotId);
      const eff = effectiveLevels(s.inputType as any, r.levels_raw);
      entries.push({ snapshotId: s.snapshotId, text: s.text, goalId: s.goalId, value: s.value, label: labelFor(eff, s.value) });
      goalEntries.push({ goalId: s.goalId, value: s.value, weight: s.weight });
      if (c) critLevels.set(s.snapshotId, { levels: eff, text: s.text });
    }
    void levels;
  }
  const perCriterion = criterionAverages(entries);
  const overall = overallScore(expanded.map((o) => o.score));
  // overall100: rata-rata score100 (sama dengan overall/max per observasi; dipakai untuk tren/narasi)
  const overall100 = overallScore(expanded.map((o) => o.score100));
  // Per instrumen
  const byInstr = new Map<string, { scores: number[]; maxLvl: number }>();
  for (const o of expanded) {
    if (o.score === null) continue;
    const key = o.instrumentTitle || "Tanpa instrumen";
    const row = byInstr.get(key) || { scores: [], maxLvl: o.maxLevel };
    row.scores.push(o.score);
    byInstr.set(key, row);
  }
  const perInstrument = [...byInstr.entries()].map(([title, v]) => ({
    title,
    average: v.scores.length ? v.scores.reduce((a, b) => a + b, 0) / v.scores.length : null,
    average100: v.scores.length ? to100(v.scores.reduce((a, b) => a + b, 0) / v.scores.length, v.maxLvl) : null,
    count: v.scores.length,
  }));
  // Per tujuan: kumpulkan semua goal dari framework mana pun yang tertaut
  const allGoals = db.query("SELECT id, parent_id, text FROM goals").all() as GoalNode[];
  const goalIdsUsed = new Set(goalEntries.map((e) => e.goalId).filter((x): x is number => x !== null));
  const perGoal: { id: number; text: string; score: number | null }[] = [];
  for (const g of allGoals) {
    if (!goalIdsUsed.has(g.id) && ![...goalIdsUsed].some((used) => {
      // tampilkan juga induk dari tujuan yang dipakai
      const subtree = new Set<number>();
      const stack = [g.id];
      // cek apakah used ada di subtree g
      const children = new Map<number, number[]>();
      for (const gg of allGoals) if (gg.parent_id !== null) children.set(gg.parent_id, [...(children.get(gg.parent_id) || []), gg.id]);
      const seen = new Set([g.id]);
      const st = [g.id];
      while (st.length) {
        const cur = st.pop()!;
        for (const ch of children.get(cur) || []) if (!seen.has(ch)) { seen.add(ch); st.push(ch); }
      }
      void subtree;
      return seen.has(used);
    })) continue;
    perGoal.push({ id: g.id, text: g.text, score: goalScore(allGoals, g.id, goalEntries) });
  }
  const notes = raw.map((r) => r.note).filter((n): n is string => !!n);
  const activities = [...new Set(raw.map((r) => r.activity).filter((a): a is string => !!a))];
  return { observations: expanded, overall, overall100, perInstrument, perCriterion, perGoal, notes, activities };
}

export function classStudents(db: Database, classId: number): any[] {
  return db
    .query("SELECT s.* FROM students s JOIN enrollments e ON e.student_id = s.id WHERE e.class_id = ? ORDER BY s.name ASC")
    .all(classId) as any[];
}

export function classGroups(db: Database, classId: number): any[] {
  return db.query("SELECT * FROM groups WHERE class_id = ? ORDER BY name ASC").all(classId) as any[];
}

export function observedStudentIds(db: Database, classId: number): Set<number> {
  const rows = db
    .query("SELECT DISTINCT o.student_id FROM observations o JOIN sessions s ON s.id = o.session_id WHERE s.class_id = ? AND o.student_id IS NOT NULL")
    .all(classId) as any[];
  const groupRows = db
    .query("SELECT DISTINCT gm.student_id FROM observations o JOIN sessions s ON s.id = o.session_id JOIN group_members gm ON gm.group_id = o.group_id WHERE s.class_id = ?")
    .all(classId) as any[];
  const set = new Set<number>();
  for (const r of rows) set.add(Number(r.student_id));
  for (const r of groupRows) set.add(Number(r.student_id));
  return set;
}

export function observedGroupIds(db: Database, classId: number): Set<number> {
  const rows = db
    .query("SELECT DISTINCT o.group_id FROM observations o JOIN sessions s ON s.id = o.session_id WHERE s.class_id = ? AND o.group_id IS NOT NULL")
    .all(classId) as any[];
  return new Set(rows.map((r: any) => Number(r.group_id)));
}
