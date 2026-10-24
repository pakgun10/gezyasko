// Generator narasi otomatis dari data observasi (plan bagian 7).
// Narasi memakai label level apa adanya dan tidak mengarang capaian
// yang tidak ada datanya.

import { labelFor, type Level } from "./scores";

export type NarrativeCriterion = {
  text: string;
  average: number | null;
  levels: Level[];
  descriptor: string | null; // deskriptor level yang paling dekat dengan rata-rata
};

export type NarrativeInput = {
  studentName: string;
  periodName: string | null;
  criteria: NarrativeCriterion[];
  activities: string[];
  notes: string[];
  overall100: number | null;
};

function levelForAverage(levels: Level[], avg: number): Level | null {
  if (!levels.length) return null;
  let best: Level = levels[0]!;
  for (const l of levels) {
    if (Math.abs(l.v - avg) < Math.abs(best.v - avg)) best = l;
  }
  return best;
}

export function generateNarrative(input: NarrativeInput): string {
  const { studentName, periodName, criteria, activities, notes, overall100 } = input;
  const lines: string[] = [];
  const periode = periodName ? ` pada periode ${periodName}` : "";
  if (!criteria.length && !notes.length) {
    return `${studentName} belum memiliki observasi${periode}, sehingga narasi belum bisa dibuat dari data.`;
  }
  let head = `${studentName} telah diobservasi${periode}`;
  if (activities.length) head += ` melalui kegiatan: ${activities.slice(0, 5).join(", ")}.`;
  else head += ".";
  lines.push(head);
  if (overall100 !== null) {
    lines.push(`Skor keseluruhan dari observasi berskor adalah ${Math.round(overall100)} dari 100.`);
  }
  for (const c of criteria) {
    if (c.average === null) continue;
    const lvl = levelForAverage(c.levels, c.average);
    const label = lvl ? lvl.label : String(c.average);
    let sentence = `Pada kriteria "${c.text}", capaian rata-rata berada pada level "${label}" (rata-rata ${c.average.toFixed(2)}).`;
    if (c.descriptor) sentence += ` ${c.descriptor}`;
    lines.push(sentence);
  }
  const cleanNotes = notes.map((n) => n.trim()).filter(Boolean).slice(0, 5);
  if (cleanNotes.length) {
    lines.push(`Catatan guru: ${cleanNotes.map((n) => `"${n}"`).join("; ")}.`);
  }
  lines.push("Narasi ini dibuat otomatis dari data observasi dan dapat diedit guru sebelum dicetak.");
  return lines.join(" ");
}
