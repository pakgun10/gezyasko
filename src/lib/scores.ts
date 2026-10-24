// Rumus skor GezyAsko — SATU-SATUNYA tempat logika skor berada.
// Route TIDAK boleh menduplikasi rumus ini; route hanya mengambil data
// dari database lalu memanggil fungsi di sini.
// Sesuai implementation_plan.md bagian 6.

export type Level = { v: number; label: string };

export function parseLevels(raw: string | null | undefined): Level[] {
  if (!raw) return [];
  try {
    const arr = JSON.parse(raw);
    if (!Array.isArray(arr)) return [];
    return arr
      .filter((x) => x && typeof x.v === "number" && typeof x.label === "string")
      .map((x) => ({ v: x.v, label: x.label }));
  } catch {
    return [];
  }
}

export function labelFor(levels: Level[], value: number): string {
  const found = levels.find((l) => l.v === value);
  return found ? found.label : String(value);
}

export function maxLevel(levels: Level[], fallback = 4): number {
  if (!levels.length) return fallback;
  return Math.max(...levels.map((l) => l.v));
}

export type ScoredItem = { value: number; weight: number };

/** Skor satu observasi = sum(value*weight)/sum(weight), hanya kriteria berskor yang terisi. */
export function observationScore(items: ScoredItem[]): number | null {
  const list = items.filter((i) => Number.isFinite(i.value) && Number.isFinite(i.weight) && i.weight > 0);
  if (!list.length) return null;
  const num = list.reduce((s, i) => s + i.value * i.weight, 0);
  const den = list.reduce((s, i) => s + i.weight, 0);
  if (den === 0) return null;
  return num / den;
}

/** Skor 0-100 = skor / max_level * 100. */
export function to100(score: number | null, maxLvl: number): number | null {
  if (score === null || !maxLvl) return null;
  return (score / maxLvl) * 100;
}

export function fmt(n: number | null, digits = 2): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return "—";
  const s = n.toFixed(digits).replace(/\.?0+$/, "");
  // toFixed lalu buang nol berlebih, tapi pertahankan minimal satu desimal bila perlu
  return s === "" ? "0" : s;
}

/** Format ganda yang selalu dipakai di rekap: "3,25 dari 4 (81 dari 100)". */
export function fmtDual(score: number | null, maxLvl: number): string {
  if (score === null) return "—";
  const p = to100(score, maxLvl);
  return `${fmt(score)} dari ${fmt(maxLvl, 0)} (${p === null ? "—" : Math.round(p)} dari 100)`;
}

export type CriterionAverage = {
  snapshotId: number;
  text: string;
  goalId: number | null;
  count: number;
  average: number | null;
  distribution: Record<string, number>; // label -> jumlah
};

/** Rata-rata per kriteria dari daftar nilai mentah. */
export function criterionAverages(
  entries: { snapshotId: number; text: string; goalId: number | null; value: number; label: string }[],
): CriterionAverage[] {
  const map = new Map<number, CriterionAverage & { sum: number }>();
  for (const e of entries) {
    let row = map.get(e.snapshotId);
    if (!row) {
      row = { snapshotId: e.snapshotId, text: e.text, goalId: e.goalId, count: 0, average: null, distribution: {}, sum: 0 };
      map.set(e.snapshotId, row);
    }
    row.count += 1;
    row.sum += e.value;
    row.distribution[e.label] = (row.distribution[e.label] || 0) + 1;
  }
  return [...map.values()].map((r) => ({
    snapshotId: r.snapshotId,
    text: r.text,
    goalId: r.goalId,
    count: r.count,
    average: r.count ? r.sum / r.count : null,
    distribution: r.distribution,
  }));
}

export type GoalNode = { id: number; parent_id: number | null; text: string };

/** Kumpulkan id tujuan dalam subtree (tujuan itu sendiri + semua anaknya). */
export function subtreeIds(goals: GoalNode[], rootId: number): Set<number> {
  const children = new Map<number, number[]>();
  for (const g of goals) {
    if (g.parent_id !== null) {
      const arr = children.get(g.parent_id) || [];
      arr.push(g.id);
      children.set(g.parent_id, arr);
    }
  }
  const out = new Set<number>([rootId]);
  const stack = [rootId];
  while (stack.length) {
    const cur = stack.pop()!;
    for (const ch of children.get(cur) || []) {
      if (!out.has(ch)) {
        out.add(ch);
        stack.push(ch);
      }
    }
  }
  return out;
}

/**
 * Skor per tujuan: rata-rata berbobot semua kriteria yang tertaut ke
 * tujuan itu, termasuk kriteria pada tujuan anak (digulung ke induk).
 * entries: satu baris per nilai kriteria pada satu observasi murid.
 */
export function goalScore(
  goals: GoalNode[],
  goalId: number,
  entries: { goalId: number | null; value: number; weight: number }[],
): number | null {
  const allowed = subtreeIds(goals, goalId);
  const list = entries.filter((e) => e.goalId !== null && allowed.has(e.goalId!));
  return observationScore(list.map((e) => ({ value: e.value, weight: e.weight })));
}

/** Skor keseluruhan murid per periode = rata-rata skor observasi. */
export function overallScore(observationScores: (number | null)[]): number | null {
  const list = observationScores.filter((s): s is number => s !== null);
  if (!list.length) return null;
  return list.reduce((a, b) => a + b, 0) / list.length;
}

export type ExpandedObservation = {
  observationId: number;
  sessionId: number;
  activity: string | null;
  observedAt: string;
  instrumentTitle: string | null;
  scope: string;
  groupName: string | null;
  isGroup: boolean;
  score: number | null;
  score100: number | null;
  maxLevel: number;
  complete: boolean; // semua kriteria berskor terisi
  note: string | null;
};

export type TrendPoint = { date: string; score100: number; activity: string | null };

/** Titik tren dari observasi yang punya skor, diurutkan berdasarkan observed_at. */
export function trendPoints(obs: ExpandedObservation[]): TrendPoint[] {
  return obs
    .filter((o) => o.score100 !== null)
    .sort((a, b) => (a.observedAt < b.observedAt ? -1 : a.observedAt > b.observedAt ? 1 : 0))
    .map((o) => ({ date: o.observedAt, score100: o.score100!, activity: o.activity }));
}

/** SVG tren inline: sumbu-x tanggal, sumbu-y 0-100. */
export function trendSvg(points: TrendPoint[]): string {
  const W = 620, H = 220, PL = 44, PR = 12, PT = 14, PB = 30;
  if (!points.length) {
    return `<div class="muted">Belum ada observasi berskor untuk grafik tren.</div>`;
  }
  const xs = points.map((_, i) => (points.length === 1 ? PL + (W - PL - PR) / 2 : PL + (i / (points.length - 1)) * (W - PL - PR)));
  const ys = points.map((p) => PT + (1 - p.score100 / 100) * (H - PT - PB));
  const poly = xs.map((x, i) => `${x.toFixed(1)},${ys[i]!.toFixed(1)}`).join(" ");
  const dots = xs.map((x, i) => `<circle cx="${x.toFixed(1)}" cy="${ys[i]!.toFixed(1)}" r="5" fill="#1d4ed8"><title>${escapeXml(points[i]!.date)} — ${points[i]!.score100.toFixed(0)} (${points[i]!.activity || "Observasi"})</title></circle>`).join("");
  const labels = xs.map((x, i) => `<text x="${x.toFixed(1)}" y="${H - 8}" text-anchor="middle" font-size="11" fill="#475569">${escapeXml(shortDate(points[i]!.date))}</text>`).join("");
  return `<svg viewBox="0 0 ${W} ${H}" class="trend" role="img" aria-label="Grafik tren skor">
    <line x1="${PL}" y1="${PT}" x2="${PL}" y2="${H - PB}" stroke="#cbd5e1"/>
    <line x1="${PL}" y1="${H - PB}" x2="${W - PR}" y2="${H - PB}" stroke="#cbd5e1"/>
    <text x="6" y="${PT + 4}" font-size="11" fill="#475569">100</text>
    <text x="6" y="${H - PB}" font-size="11" fill="#475569">0</text>
    <polyline points="${poly}" fill="none" stroke="#1d4ed8" stroke-width="2.5"/>
    ${dots}${labels}
  </svg>`;
}

function escapeXml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function shortDate(iso: string): string {
  // "2026-10-24" -> "24/10"
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  return m ? `${m[3]}/${m[2]}` : iso.slice(0, 10);
}
