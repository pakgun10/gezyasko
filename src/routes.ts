// Semua route MVP Fase 0-4. Setiap route memeriksa peran di server.
// File ini sengaja dibagi secara logis: auth/dasbor/kelas/sesi/catat
// di bagian atas, instrumen/kerangka/profil/rekap/cetak di tengah,
// admin/backup di akhir.

import type { Database } from "bun:sqlite";
import { Hono, type Context } from "hono";
import { join, basename } from "node:path";
import {
  getCurrentUser,
  createLoginSession,
  setSessionCookie,
  logoutSession,
  isAdmin,
  isKepsek,
  linkedStudentId,
  canAccessClass,
  canViewClassRecap,
  canRecordSession,
  canAccessStudent,
  canAccessSession,
  canAccessObservation,
  canAccessEvidence,
  checkCsrf,
  type User,
} from "./auth";
import { esc, layout, field, input, select, csrfInput, table, backLink } from "./views";
import { createSession, snapshotInstrument, audit, seedTemplates } from "./db";
import { parseLevels, fmt, fmtDual, trendSvg, trendPoints } from "./lib/scores";
import { validateScore, parseScoreInput, effectiveLevels } from "./lib/validate";
import { parseCSV, tableFromCSV, validateStudentRows, validateTeacherRows, validateGroupRows } from "./lib/csv";
import { importStudents, importTeachers, importGroups } from "./lib/imports";
import { generateNarrative } from "./lib/narrative";
import { validatePhoto, validateVideoUrl, MAX_CAPTION } from "./lib/evidence";
import { fetchObservationsForStudent, scoresForObservation, criteriaForSession, expandObservations, studentRecap, classStudents, classGroups, observedStudentIds, observedGroupIds } from "./recap";

export type AppState = { db: Database; dataDir: string; publicDir: string };

type Ctx = Context;

function dbOf(s: AppState): Database {
  return s.db;
}

function schoolName(db: Database): string {
  const row = db.query("SELECT school_name FROM settings WHERE id = 1").get() as any;
  return row ? row.school_name : "Sekolah Saya";
}

function msgOf(c: Ctx): string | null {
  return c.req.query("msg") || null;
}

function redirectMsg(c: Ctx, path: string, msg: string) {
  const sep = path.includes("?") ? "&" : "?";
  return c.redirect(`${path}${sep}msg=${encodeURIComponent(msg)}`);
}

async function formOf(c: Ctx): Promise<Record<string, any>> {
  try {
    return (await c.req.parseBody({ all: true })) as Record<string, any>;
  } catch {
    return {};
  }
}

function str(body: Record<string, any>, key: string): string {
  const v = body[key];
  if (typeof v === "string") return v.trim();
  if (Array.isArray(v) && typeof v[0] === "string") return v[0].trim();
  return "";
}

function strRaw(body: Record<string, any>, key: string): string {
  const v = body[key];
  if (typeof v === "string") return v;
  if (Array.isArray(v) && typeof v[0] === "string") return v[0];
  return "";
}

function filesOf(body: Record<string, any>, key: string): File[] {
  const v = body[key];
  if (!v) return [];
  const arr = Array.isArray(v) ? v : [v];
  return arr.filter((f) => f && typeof f === "object" && typeof (f as File).arrayBuffer === "function" && (f as File).size > 0) as File[];
}

function requireUser(s: AppState, c: Ctx): { user: User; csrf: string } | Response {
  const cur = getCurrentUser(s.db, c);
  if (!cur) return c.redirect("/login");
  if (cur.user.must_change_password === 1 && !c.req.path.startsWith("/ganti-sandi") && c.req.path !== "/logout") {
    return c.redirect("/ganti-sandi?msg=" + encodeURIComponent("Silakan ganti kata sandi awal Anda terlebih dahulu."));
  }
  return cur;
}

function page(s: AppState, c: Ctx, user: User, title: string, body: string, print = false) {
  return c.html(layout({ title, user, schoolName: schoolName(s.db), body, msg: msgOf(c), print }));
}

function errPage(s: AppState, c: Ctx, user: User | null, title: string, message: string, back = "/") {
  const body = `<div class="flash error">${esc(message)}</div>${backLink(back)}`;
  return c.html(layout({ title, user, schoolName: schoolName(s.db), body, msg: null }), 403 as any);
}

function visibleInstruments(db: Database, u: User): any[] {
  if (isAdmin(u)) return db.query("SELECT * FROM instruments ORDER BY is_template DESC, title ASC").all() as any[];
  return db
    .query("SELECT * FROM instruments WHERE owner_id = ? OR visibility = 'sekolah' OR is_template = 1 ORDER BY is_template DESC, title ASC")
    .all(u.id) as any[];
}

function visibleFrameworks(db: Database, u: User): any[] {
  if (isAdmin(u)) return db.query("SELECT * FROM frameworks ORDER BY is_template DESC, title ASC").all() as any[];
  return db
    .query("SELECT * FROM frameworks WHERE owner_id = ? OR visibility = 'sekolah' OR is_template = 1 ORDER BY is_template DESC, title ASC")
    .all(u.id) as any[];
}

function activePeriod(db: Database): any | null {
  return db.query("SELECT * FROM periods WHERE is_active = 1 ORDER BY id DESC LIMIT 1").get() as any;
}

export function buildRoutes(app: Hono, s: AppState): void {
  const db = () => s.db;

  app.get("/api/kesehatan", (c) => c.json({ ok: true, app: "GezyAsko" }));

  // ---------- Auth ----------
  app.get("/login", (c) => {
    const cur = getCurrentUser(db(), c);
    if (cur && cur.user.must_change_password !== 1) return c.redirect("/");
    const body = `<form method="post" action="/login" class="card">
      ${field("Username", input("username", "", "required autofocus"))}
      ${field("Kata sandi", `<input type="password" name="password" required>`)}
      <button class="btn" type="submit">Masuk</button>
      <p class="muted">Guru/admin memakai username. Murid/orang tua memakai NIS sebagai username, tetap dengan kata sandi.</p>
    </form>`;
    return c.html(layout({ title: "Masuk", user: null, schoolName: schoolName(db()), body, msg: msgOf(c) }));
  });

  app.post("/login", async (c) => {
    const body = await formOf(c);
    const username = str(body, "username");
    const password = strRaw(body, "password");
    const user = db().query("SELECT * FROM users WHERE username = ?").get(username) as any;
    if (!user || user.active !== 1) return redirectMsg(c, "/login", "Username atau kata sandi salah.");
    const ok = await Bun.password.verify(password, user.password_hash);
    if (!ok) return redirectMsg(c, "/login", "Username atau kata sandi salah.");
    const sess = await createLoginSession(db(), Number(user.id));
    setSessionCookie(c, sess.token);
    audit(db(), Number(user.id), "login", "users", Number(user.id), {});
    if (user.must_change_password === 1) return c.redirect("/ganti-sandi");
    return c.redirect("/");
  });

  app.post("/logout", (c) => {
    logoutSession(db(), c);
    return c.redirect("/login");
  });

  app.get("/ganti-sandi", (c) => {
    const cur = getCurrentUser(db(), c);
    if (!cur) return c.redirect("/login");
    const body = `<form method="post" action="/ganti-sandi" class="card">
      ${csrfInput(cur.csrf)}
      ${field("Kata sandi lama", `<input type="password" name="current" required>`)}
      ${field("Kata sandi baru (min. 6 karakter)", `<input type="password" name="baru" required>`)}
      ${field("Ulangi kata sandi baru", `<input type="password" name="ulang" required>`)}
      <button class="btn" type="submit">Ganti kata sandi</button>
    </form>`;
    return page(s, c, cur.user, "Ganti Kata Sandi", body);
  });

  app.post("/ganti-sandi", async (c) => {
    const cur = getCurrentUser(db(), c);
    if (!cur) return c.redirect("/login");
    const body = await formOf(c);
    if (!checkCsrf(db(), c, body)) return errPage(s, c, cur.user, "Gagal", "Token keamanan tidak valid.", "/");
    const current = strRaw(body, "current");
    const baru = strRaw(body, "baru");
    const ulang = strRaw(body, "ulang");
    const row = db().query("SELECT password_hash FROM users WHERE id = ?").get(cur.user.id) as any;
    if (!(await Bun.password.verify(current, row.password_hash))) return redirectMsg(c, "/ganti-sandi", "Kata sandi lama salah.");
    if (baru.length < 6) return redirectMsg(c, "/ganti-sandi", "Kata sandi baru minimal 6 karakter.");
    if (baru !== ulang) return redirectMsg(c, "/ganti-sandi", "Ulangi kata sandi tidak sama.");
    const hash = await Bun.password.hash(baru, { algorithm: "argon2id" });
    db().query("UPDATE users SET password_hash = ?, must_change_password = 0 WHERE id = ?").run(hash, cur.user.id);
    // Cabut sesi lain milik pengguna ini
    const token = c.req.header("cookie") || "";
    void token;
    db().query("DELETE FROM user_sessions WHERE user_id = ? AND csrf_token != ?").run(cur.user.id, cur.csrf);
    audit(db(), cur.user.id, "password.change", "users", cur.user.id, {});
    return redirectMsg(c, "/", "Kata sandi berhasil diganti.");
  });

  // ---------- Dasbor ----------
  app.get("/", (c) => {
    const cur = requireUser(s, c);
    if (cur instanceof Response) return cur;
    const u = cur.user;
    let body = "";
    if (isAdmin(u)) {
      const counts = {
        guru: (db().query("SELECT COUNT(*) c FROM users WHERE role='guru'").get() as any).c,
        murid: (db().query("SELECT COUNT(*) c FROM students").get() as any).c,
        kelas: (db().query("SELECT COUNT(*) c FROM classes").get() as any).c,
        sesi: (db().query("SELECT COUNT(*) c FROM sessions").get() as any).c,
      };
      const classes = db().query("SELECT cl.*, p.name AS period_name FROM classes cl LEFT JOIN periods p ON p.id = cl.period_id ORDER BY cl.id DESC").all() as any[];
      body = `<div class="cards">
        <div class="stat"><b>${counts.guru}</b><span>Guru</span></div>
        <div class="stat"><b>${counts.murid}</b><span>Murid</span></div>
        <div class="stat"><b>${counts.kelas}</b><span>Kelas</span></div>
        <div class="stat"><b>${counts.sesi}</b><span>Sesi observasi</span></div></div>
        <p><a class="btn" href="/admin">Buka Admin</a> <a class="btn secondary" href="/instrumen">Instrumen</a></p>
        <h2>Daftar kelas</h2>
        <ul>${classes.map((cl) => `<li><a href="/kelas/${cl.id}">${esc(cl.name)}</a> ${cl.level_label ? `(${esc(cl.level_label)})` : ""} — ${esc(cl.period_name || "")}</li>`).join("") || "<li>Belum ada kelas.</li>"}</ul>`;
    } else if (u.role === "guru") {
      const classes = db()
        .query("SELECT cl.*, p.name AS period_name FROM classes cl JOIN class_teachers ct ON ct.class_id = cl.id LEFT JOIN periods p ON p.id = cl.period_id WHERE ct.user_id = ? GROUP BY cl.id ORDER BY cl.id DESC")
        .all(u.id) as any[];
      const sessions = db()
        .query("SELECT s.*, cl.name AS class_name FROM sessions s JOIN classes cl ON cl.id = s.class_id WHERE s.teacher_id = ? OR s.class_id IN (SELECT class_id FROM class_teachers WHERE user_id = ?) ORDER BY s.observed_at DESC LIMIT 10")
        .all(u.id, u.id) as any[];
      body = `<h2>Kelas saya</h2><ul>${classes.map((cl) => {
        const total = classStudents(db(), cl.id).length;
        const obs = observedStudentIds(db(), cl.id).size;
        return `<li><a href="/kelas/${cl.id}">${esc(cl.name)}</a> — ${obs}/${total} murid sudah diamati (termasuk lewat kelompok) · <a href="/rekap/kelas/${cl.id}">Rekap</a></li>`;
      }).join("") || "<li>Belum ada kelas yang diampu. Minta admin menugaskan Anda ke kelas.</li>"}</ul>
        <h2>Sesi terakhir</h2><ul>${sessions.map((ss) => `<li><a href="/catat/${ss.id}">${esc(ss.activity || "Observasi")}</a> — ${esc(ss.class_name)} — ${esc(ss.observed_at)} (${esc(ss.scope)})</li>`).join("") || "<li>Belum ada sesi.</li>"}</ul>
        <p><a class="btn" href="/instrumen">Instrumen</a></p>`;
    } else if (isKepsek(u)) {
      const classes = db().query("SELECT cl.*, p.name AS period_name FROM classes cl LEFT JOIN periods p ON p.id = cl.period_id ORDER BY cl.id DESC").all() as any[];
      body = `<p>Anda masuk sebagai pengamat (kepala sekolah): hanya membaca rekap.</p>
        <h2>Rekap kelas</h2><ul>${classes.map((cl) => `<li><a href="/rekap/kelas/${cl.id}">${esc(cl.name)}</a> — ${esc(cl.period_name || "")}</li>`).join("") || "<li>Belum ada kelas.</li>"}</ul>`;
    } else {
      const sid = linkedStudentId(db(), u.id);
      if (!sid) {
        body = `<p>Akun pengamat ini belum terikat ke murid mana pun. Hubungi admin.</p>`;
      } else {
        const st = db().query("SELECT * FROM students WHERE id = ?").get(sid) as any;
        body = `<p>Laporan untuk <b>${esc(st.name)}</b> (NIS ${esc(st.student_no || "-")}).</p>
          <p><a class="btn" href="/murid/${sid}">Profil perkembangan</a> <a class="btn secondary" href="/rekap/murid/${sid}/cetak">Laporan cetak</a></p>`;
      }
    }
    return page(s, c, u, "Dasbor", body);
  });

  // ---------- Kelas ----------
  app.get("/kelas/:id", (c) => {
    const cur = requireUser(s, c);
    if (cur instanceof Response) return cur;
    const id = Number(c.req.param("id"));
    const cl = db().query("SELECT cl.*, p.name AS period_name FROM classes cl LEFT JOIN periods p ON p.id = cl.period_id WHERE cl.id = ?").get(id) as any;
    if (!cl) return errPage(s, c, cur.user, "Tidak ditemukan", "Kelas tidak ditemukan.", "/");
    if (!canAccessClass(db(), cur.user, id)) return errPage(s, c, cur.user, "Tidak diizinkan", "Anda tidak berhak membuka kelas ini.", "/");
    const students = classStudents(db(), id);
    const groups = classGroups(db(), id);
    const observed = observedStudentIds(db(), id);
    const observedGroups = observedGroupIds(db(), id);
    const sessions = db().query("SELECT s.*, i.title AS instrument_title FROM sessions s LEFT JOIN instruments i ON i.id = s.instrument_id WHERE s.class_id = ? ORDER BY s.observed_at DESC").all(id) as any[];
    const teachers = db().query("SELECT u.name, ct.subject_label FROM class_teachers ct JOIN users u ON u.id = ct.user_id WHERE ct.class_id = ?").all(id) as any[];
    const canRecord = canRecordSession(db(), cur.user, id);
    const body = `<p>Periode: ${esc(cl.period_name || "-")} · Tingkat: ${esc(cl.level_label || "-")}</p>
      <p>Guru pengampu: ${teachers.map((t) => `${esc(t.name)}${t.subject_label ? ` (${esc(t.subject_label)})` : ""}`).join(", ") || "-"}</p>
      ${canRecord ? `<p><a class="btn" href="/sesi/baru?kelas=${id}">+ Buat sesi observasi</a></p>` : ""}
      <h2>Sesi</h2><ul>${sessions.map((ss) => `<li><a href="/catat/${ss.id}">${esc(ss.activity || "Observasi")}</a> — ${esc(ss.observed_at)} (${esc(ss.scope)}) — ${esc(ss.instrument_title || "Tanpa instrumen")}</li>`).join("") || "<li>Belum ada sesi.</li>"}</ul>
      <h2>Murid (${students.length})</h2>
      ${table(["Nama", "NIS", "Status"], students.map((st) => [`<a href="/murid/${st.id}">${esc(st.name)}</a>`, esc(st.student_no || "-"), observed.has(Number(st.id)) ? "Sudah diamati" : "Belum diamati"]))}
      <h2>Kelompok (${groups.length})</h2>
      ${table(["Kelompok", "Anggota", "Status"], groups.map((g) => {
        const members = db().query("SELECT s.name FROM group_members gm JOIN students s ON s.id = gm.student_id WHERE gm.group_id = ? ORDER BY s.name ASC").all(g.id) as any[];
        return [esc(g.name), esc(members.map((m: any) => m.name).join(", ")), observedGroups.has(Number(g.id)) ? "Sudah diamati" : "Belum diamati"];
      }))}`;
    return page(s, c, cur.user, `Kelas ${cl.name}`, body);
  });

  // ---------- Sesi baru ----------
  app.get("/sesi/baru", (c) => {
    const cur = requireUser(s, c);
    if (cur instanceof Response) return cur;
    const kelasId = Number(c.req.query("kelas") || 0);
    if (kelasId && !canRecordSession(db(), cur.user, kelasId)) return errPage(s, c, cur.user, "Tidak diizinkan", "Anda tidak berhak membuat sesi untuk kelas ini.", "/");
    const classes = isAdmin(cur.user)
      ? (db().query("SELECT * FROM classes ORDER BY id DESC").all() as any[])
      : (db().query("SELECT cl.* FROM classes cl JOIN class_teachers ct ON ct.class_id = cl.id WHERE ct.user_id = ? GROUP BY cl.id").all(cur.user.id) as any[]);
    const instruments = visibleInstruments(db(), cur.user);
    const today = new Date().toISOString().slice(0, 10);
    const body = `<form method="post" action="/sesi/baru" class="card">
      ${csrfInput(cur.csrf)}
      ${field("Kelas", select("class_id", classes.map((cl) => ({ value: String(cl.id), label: cl.name, selected: cl.id === kelasId })), "required"))}
      ${field("Scope", select("scope", [{ value: "individu", label: "Individu" }, { value: "kelompok", label: "Kelompok" }]))}
      ${field("Instrumen (kosongkan untuk anekdotal tanpa instrumen)", select("instrument_id", [{ value: "", label: "— Tanpa instrumen —" }, ...instruments.map((i) => ({ value: String(i.id), label: `${i.title} (${i.kind})` }))]))}
      ${field("Aktivitas (nama asesmen, bebas)", input("activity", "", "placeholder='Mis. Pidato, Praktikum'"))}
      ${field("Tanggal observasi", `<input type="date" name="observed_at" value="${today}" required>`)}
      ${field("Catatan sesi (opsional)", `<textarea name="note" rows="3"></textarea>`)}
      <button class="btn" type="submit">Buat sesi & buka catat cepat</button>
    </form>${backLink(kelasId ? `/kelas/${kelasId}` : "/")}`;
    return page(s, c, cur.user, "Buat Sesi Observasi", body);
  });

  app.post("/sesi/baru", async (c) => {
    const cur = requireUser(s, c);
    if (cur instanceof Response) return cur;
    const body = await formOf(c);
    if (!checkCsrf(db(), c, body)) return errPage(s, c, cur.user, "Gagal", "Token keamanan tidak valid.", "/");
    const classId = Number(str(body, "class_id"));
    const instrumentId = str(body, "instrument_id") ? Number(str(body, "instrument_id")) : null;
    const scope = str(body, "scope") === "kelompok" ? "kelompok" : "individu";
    const observedAt = str(body, "observed_at");
    if (!classId || !observedAt) return redirectMsg(c, "/sesi/baru", "Kelas dan tanggal observasi wajib diisi.");
    if (!canRecordSession(db(), cur.user, classId)) return errPage(s, c, cur.user, "Tidak diizinkan", "Anda tidak berhak membuat sesi untuk kelas ini.", "/");
    if (instrumentId) {
      const inst = db().query("SELECT id FROM instruments WHERE id = ?").get(instrumentId) as any;
      if (!inst) return redirectMsg(c, "/sesi/baru", "Instrumen tidak ditemukan.");
    }
    const sessionId = createSession(db(), {
      class_id: classId,
      instrument_id: instrumentId,
      teacher_id: cur.user.id,
      scope,
      observed_at: observedAt,
      activity: str(body, "activity"),
      note: str(body, "note"),
    });
    return c.redirect(`/catat/${sessionId}`);
  });

  app.get("/sesi/:id", (c) => c.redirect(`/catat/${c.req.param("id")}`));

  // ---------- Catat cepat ----------
  function catatFormHtml(
    s: AppState,
    session: any,
    criteria: any[],
    levelsRaw: string | null,
    targetKind: string,
    targetId: number,
    targetName: string,
    existing: any | null,
    existingScores: Map<number, number>,
    existingMemberNotes: Map<number, string>,
    existingEvidence: any[],
    members: any[],
    csrf: string,
  ): string {
    const critHtml = criteria
      .map((cr) => {
        if (cr.input_type === "teks") {
          return `<div class="crit"><b>${esc(cr.text)}</b><p class="muted">Kriteria teks: tidak ada skor, gunakan catatan di bawah.</p></div>`;
        }
        const levels = effectiveLevels(cr.input_type as any, levelsRaw);
        const current = existingScores.get(Number(cr.id));
        const buttons = levels
          .map(
            (lv) =>
              `<label class="levelbtn"><input type="radio" name="score_${cr.id}" value="${lv.v}" ${current === lv.v ? "checked" : ""}><span>${esc(lv.label)} (${lv.v})</span></label>`,
          )
          .join("");
        return `<div class="crit"><b>${esc(cr.text)}</b> <span class="muted">(bobot ${cr.weight})</span><div class="levels">${buttons}<label class="levelbtn"><input type="radio" name="score_${cr.id}" value="" ${current === undefined ? "checked" : ""}><span>Belum diisi</span></label></div></div>`;
      })
      .join("");
    const memberHtml =
      targetKind === "kelompok"
        ? `<h3>Catatan individu per anggota (opsional)</h3>${members
            .map(
              (m) =>
                `<label class="field"><span>${esc(m.name)}</span><input name="member_note_${m.id}" value="${esc(existingMemberNotes.get(Number(m.id)) || "")}"></label>`,
            )
            .join("")}`
        : "";
    const evidenceHtml = existingEvidence.length
      ? `<h3>Bukti tersimpan</h3><ul>${existingEvidence
          .map((e) =>
            e.kind === "foto"
              ? `<li>Foto: <a href="/bukti/${e.id}" target="_blank">${esc(e.caption || "Lihat foto")}</a> <form method="post" action="/bukti/${e.id}/hapus" class="inline">${csrfInput(csrf)}<input type="hidden" name="back" value="/catat/${session.id}"><button class="linkbtn" type="submit">Hapus</button></form></li>`
              : `<li>Video: <a href="${esc(e.url)}" target="_blank" rel="noopener">${esc(e.url)}</a></li>`,
          )
          .join("")}</ul>`
      : "";
    return `<form method="post" action="/catat/${session.id}" enctype="multipart/form-data" class="card catatform" data-compress>
      ${csrfInput(csrf)}
      <input type="hidden" name="target_kind" value="${esc(targetKind)}">
      <input type="hidden" name="target_id" value="${targetId}">
      ${existing ? `<input type="hidden" name="observation_id" value="${existing.id}">` : ""}
      <h2>${targetKind === "kelompok" ? "Kelompok" : "Murid"}: ${esc(targetName)} ${existing ? "(sudah diamati — bisa diubah)" : ""}</h2>
      ${critHtml || "<p class=\"muted\">Sesi anekdotal tanpa kriteria skor: isi catatan saja.</p>"}
      ${field("Catatan (opsional, satu kalimat)", `<textarea name="note" rows="3">${esc(existing?.note || "")}</textarea>`)}
      ${memberHtml}
      <div class="field"><span>Foto bukti (maks. 5 per observasi, maks. 5 MB per berkas, JPG/PNG/WebP)</span><input type="file" name="foto" accept="image/jpeg,image/png,image/webp" multiple></div>
      ${field("Caption foto (maks. 200 karakter)", input("caption", existingEvidence.find((e) => e.kind === "foto")?.caption || ""))}
      ${field("URL video (https, opsional — bukan unggah berkas)", input("video_url", existingEvidence.find((e) => e.kind === "video_url")?.url || "", "placeholder='https://...'"))}
      <button class="btn" type="submit">Simpan & kembali ke grid</button>
    </form>${evidenceHtml}`;
  }

  app.get("/catat/:sessionId", (c) => {
    const cur = requireUser(s, c);
    if (cur instanceof Response) return cur;
    const sessionId = Number(c.req.param("sessionId"));
    const session = db().query("SELECT s.*, cl.name AS class_name, i.title AS instrument_title, i.levels AS levels_raw FROM sessions s JOIN classes cl ON cl.id = s.class_id LEFT JOIN instruments i ON i.id = s.instrument_id WHERE s.id = ?").get(sessionId) as any;
    if (!session) return errPage(s, c, cur.user, "Tidak ditemukan", "Sesi tidak ditemukan.", "/");
    if (!canAccessSession(db(), cur.user, sessionId)) return errPage(s, c, cur.user, "Tidak diizinkan", "Anda tidak berhak membuka sesi ini.", "/");
    const canRecord = canRecordSession(db(), cur.user, Number(session.class_id));
    const criteria = criteriaForSession(db(), sessionId);
    const targetKind = c.req.query("target_kind") || "";
    const targetId = Number(c.req.query("target_id") || 0);
    let formHtml = "";
    if (canRecord && targetKind && targetId) {
      let targetName = "";
      let members: any[] = [];
      let existing: any = null;
      if (targetKind === "individu") {
        const st = db().query("SELECT * FROM students WHERE id = ?").get(targetId) as any;
        if (st) {
          targetName = st.name;
          existing = db().query("SELECT * FROM observations WHERE session_id = ? AND student_id = ?").get(sessionId, targetId) as any;
        }
      } else if (targetKind === "kelompok") {
        const g = db().query("SELECT * FROM groups WHERE id = ?").get(targetId) as any;
        if (g) {
          targetName = g.name;
          members = db().query("SELECT s.* FROM group_members gm JOIN students s ON s.id = gm.student_id WHERE gm.group_id = ? ORDER BY s.name ASC").all(targetId) as any[];
          existing = db().query("SELECT * FROM observations WHERE session_id = ? AND group_id = ?").get(sessionId, targetId) as any;
        }
      }
      if (targetName) {
        const existingScores = new Map<number, number>();
        const existingMemberNotes = new Map<number, string>();
        let existingEvidence: any[] = [];
        if (existing) {
          for (const sc of scoresForObservation(db(), existing.id)) existingScores.set(sc.snapshotId, sc.value);
          for (const mn of db().query("SELECT * FROM member_notes WHERE observation_id = ?").all(existing.id) as any[]) existingMemberNotes.set(Number(mn.student_id), mn.note);
          existingEvidence = db().query("SELECT * FROM evidence WHERE observation_id = ? ORDER BY id ASC").all(existing.id) as any[];
        }
        formHtml = catatFormHtml(s, session, criteria, session.levels_raw, targetKind, targetId, targetName, existing, existingScores, existingMemberNotes, existingEvidence, members, cur.csrf);
      }
    }
    let gridHtml = "";
    if (session.scope === "individu") {
      const students = classStudents(db(), Number(session.class_id));
      gridHtml = `<div class="grid">${students
        .map((st) => {
          const obs = db().query("SELECT id FROM observations WHERE session_id = ? AND student_id = ?").get(sessionId, st.id) as any;
          const active = targetKind === "individu" && targetId === Number(st.id);
          return `<a class="griditem ${obs ? "done" : "todo"} ${active ? "active" : ""}" href="/catat/${sessionId}?target_kind=individu&target_id=${st.id}"><b>${esc(st.name)}</b><span>${obs ? "✓ Sudah diamati" : "Belum diamati"}</span></a>`;
        })
        .join("")}</div>`;
    } else {
      const groups = classGroups(db(), Number(session.class_id));
      gridHtml = `<div class="grid">${groups
        .map((g) => {
          const obs = db().query("SELECT id FROM observations WHERE session_id = ? AND group_id = ?").get(sessionId, g.id) as any;
          const members = db().query("SELECT s.name FROM group_members gm JOIN students s ON s.id = gm.student_id WHERE gm.group_id = ? ORDER BY s.name ASC").all(g.id) as any[];
          const active = targetKind === "kelompok" && targetId === Number(g.id);
          return `<a class="griditem ${obs ? "done" : "todo"} ${active ? "active" : ""}" href="/catat/${sessionId}?target_kind=kelompok&target_id=${g.id}"><b>${esc(g.name)}</b><span>${esc(members.map((m: any) => m.name).join(", "))}</span><span>${obs ? "✓ Sudah diamati" : "Belum diamati"}</span></a>`;
        })
        .join("") || "<p>Belum ada kelompok di kelas ini. Minta admin membentuk kelompok dulu.</p>"}</div>`;
    }
    const body = `<p>Kelas: <a href="/kelas/${session.class_id}">${esc(session.class_name)}</a> · Aktivitas: ${esc(session.activity || "-")} · Tanggal: ${esc(session.observed_at)} · Scope: ${esc(session.scope)} · Instrumen: ${esc(session.instrument_title || "Tanpa instrumen")}</p>
      ${!canRecord ? `<p class="muted">Anda hanya bisa melihat sesi ini (pengamat).</p>` : ""}
      <h2>Pilih ${session.scope === "individu" ? "murid" : "kelompok"}</h2>${gridHtml}
      ${formHtml}
      <p class="muted">Target: sekitar 10 detik per murid/kelompok — ketuk nama, ketuk level, simpan.</p>`;
    return page(s, c, cur.user, `Catat Cepat — ${session.activity || "Observasi"}`, body);
  });

  app.post("/catat/:sessionId", async (c) => {
    const cur = requireUser(s, c);
    if (cur instanceof Response) return cur;
    const sessionId = Number(c.req.param("sessionId"));
    const session = db().query("SELECT s.*, i.levels AS levels_raw FROM sessions s LEFT JOIN instruments i ON i.id = s.instrument_id WHERE s.id = ?").get(sessionId) as any;
    if (!session) return errPage(s, c, cur.user, "Tidak ditemukan", "Sesi tidak ditemukan.", "/");
    if (!canRecordSession(db(), cur.user, Number(session.class_id))) return errPage(s, c, cur.user, "Tidak diizinkan", "Anda tidak berhak mencatat pada sesi ini.", "/");
    const body = await formOf(c);
    if (!checkCsrf(db(), c, body)) return errPage(s, c, cur.user, "Gagal", "Token keamanan tidak valid.", `/catat/${sessionId}`);
    const targetKind = str(body, "target_kind");
    const targetId = Number(str(body, "target_id"));
    const observationIdRaw = str(body, "observation_id");
    const note = str(body, "note");
    const criteria = criteriaForSession(db(), sessionId);
    // Validasi skor
    const scoreValues = new Map<number, number>();
    for (const cr of criteria) {
      if (cr.input_type === "teks") continue;
      const raw = str(body, `score_${cr.id}`);
      const val = parseScoreInput(raw === "" ? null : raw);
      if (val !== null) {
        const err = validateScore(cr.input_type as any, val, session.levels_raw);
        if (err) return errPage(s, c, cur.user, "Nilai tidak valid", `${cr.text}: ${err}`, `/catat/${sessionId}`);
        scoreValues.set(Number(cr.id), val);
      }
    }
    // Validasi target
    if (targetKind === "individu") {
      const enr = db().query("SELECT 1 FROM enrollments WHERE class_id = ? AND student_id = ?").get(session.class_id, targetId) as any;
      if (!enr) return errPage(s, c, cur.user, "Gagal", "Murid bukan anggota kelas ini.", `/catat/${sessionId}`);
    } else if (targetKind === "kelompok") {
      const g = db().query("SELECT id FROM groups WHERE id = ? AND class_id = ?").get(targetId, session.class_id) as any;
      if (!g) return errPage(s, c, cur.user, "Gagal", "Kelompok bukan kelompok kelas ini.", `/catat/${sessionId}`);
    } else {
      return errPage(s, c, cur.user, "Gagal", "Target observasi tidak valid.", `/catat/${sessionId}`);
    }
    const videoUrl = str(body, "video_url");
    const videoErr = validateVideoUrl(videoUrl);
    if (videoErr) return errPage(s, c, cur.user, "URL tidak valid", videoErr, `/catat/${sessionId}`);
    const caption = str(body, "caption");
    if (caption.length > MAX_CAPTION) return errPage(s, c, cur.user, "Gagal", `Caption maksimal ${MAX_CAPTION} karakter.`, `/catat/${sessionId}`);
    const photos = filesOf(body, "foto");
    // Hitung bukti foto yang sudah ada bila mengedit observasi
    let existingPhotoCount = 0;
    let existingObs: any = null;
    if (observationIdRaw) existingObs = db().query("SELECT * FROM observations WHERE id = ? AND session_id = ?").get(Number(observationIdRaw), sessionId) as any;
    if (existingObs) existingPhotoCount = (db().query("SELECT COUNT(*) c FROM evidence WHERE observation_id = ? AND kind = 'foto'").get(existingObs.id) as any).c;
    for (const f of photos) {
      const perr = validatePhoto(f.type, f.size, existingPhotoCount);
      if (perr) return errPage(s, c, cur.user, "Foto tidak valid", perr, `/catat/${sessionId}`);
      existingPhotoCount++;
    }
    // Simpan observasi + skor + catatan anggota dalam satu transaksi
    let obsId: number;
    const isUpdate = !!existingObs;
    const tx = db().transaction(() => {
      if (existingObs) {
        db().query("UPDATE observations SET note = ? WHERE id = ?").run(note || null, existingObs.id);
        obsId = existingObs.id;
        db().query("DELETE FROM scores WHERE observation_id = ?").run(obsId);
        db().query("DELETE FROM member_notes WHERE observation_id = ?").run(obsId);
      } else {
        const info: any =
          targetKind === "individu"
            ? db().query("INSERT INTO observations (session_id, student_id, group_id, note) VALUES (?, ?, NULL, ?)").run(sessionId, targetId, note || null)
            : db().query("INSERT INTO observations (session_id, student_id, group_id, note) VALUES (?, NULL, ?, ?)").run(sessionId, targetId, note || null);
        obsId = Number(info.lastInsertRowid);
      }
      for (const [snapId, val] of scoreValues) {
        db().query("INSERT INTO scores (observation_id, snapshot_criterion_id, value) VALUES (?, ?, ?)").run(obsId, snapId, val);
      }
      if (targetKind === "kelompok") {
        const members = db().query("SELECT student_id FROM group_members WHERE group_id = ?").all(targetId) as any[];
        for (const m of members) {
          const mn = str(body, `member_note_${m.student_id}`);
          if (mn) db().query("INSERT INTO member_notes (observation_id, student_id, note) VALUES (?, ?, ?)").run(obsId, m.student_id, mn);
        }
      }
      return obsId;
    });
    try {
      obsId = tx() as number;
    } catch (e: any) {
      // UNIQUE observasi ganda: pakai observasi yang sudah ada
      const dup =
        targetKind === "individu"
          ? (db().query("SELECT id FROM observations WHERE session_id = ? AND student_id = ?").get(sessionId, targetId) as any)
          : (db().query("SELECT id FROM observations WHERE session_id = ? AND group_id = ?").get(sessionId, targetId) as any);
      if (!dup) return errPage(s, c, cur.user, "Gagal menyimpan", String(e?.message || e), `/catat/${sessionId}`);
      return redirectMsg(c, `/catat/${sessionId}?target_kind=${targetKind}&target_id=${targetId}`, "Observasi ini sudah ada; buka lagi untuk mengubahnya.");
    }
    audit(db(), cur.user.id, isUpdate ? "score.update" : "score.create", "observations", obsId, { session_id: sessionId, scores: [...scoreValues.entries()] });
    // Bukti video (tautan)
    if (videoUrl) {
      const dupV = db().query("SELECT id FROM evidence WHERE observation_id = ? AND kind = 'video_url' AND url = ?").get(obsId, videoUrl) as any;
      if (!dupV) db().query("INSERT INTO evidence (observation_id, kind, url, caption) VALUES (?, 'video_url', ?, ?)").run(obsId, videoUrl, caption || null);
    }
    // Bukti foto
    for (const f of photos) {
      const buf = Buffer.from(await f.arrayBuffer());
      const fname = `${crypto.randomUUID()}.${f.type === "image/png" ? "png" : f.type === "image/webp" ? "webp" : "jpg"}`;
      await Bun.write(join(s.dataDir, "bukti", fname), buf);
      db().query("INSERT INTO evidence (observation_id, kind, path, caption, mime, bytes) VALUES (?, 'foto', ?, ?, ?, ?)").run(obsId, fname, caption || null, f.type, f.size);
    }
    return redirectMsg(c, `/catat/${sessionId}?target_kind=${targetKind}&target_id=${targetId}`, "Observasi tersimpan.");
  });

  // ---------- Instrumen ----------
  app.get("/instrumen", (c) => {
    const cur = requireUser(s, c);
    if (cur instanceof Response) return cur;
    if (cur.user.role === "pengamat") return errPage(s, c, cur.user, "Tidak diizinkan", "Pengamat tidak mengelola instrumen.", "/");
    const list = visibleInstruments(db(), cur.user);
    const body = `<p><a class="btn" href="/instrumen/baru">+ Buat instrumen</a></p>
      ${table(["Judul", "Jenis", "Templat?", "Aksi"], list.map((i) => [
        esc(i.title),
        esc(i.kind),
        i.is_template ? "Ya" : "Tidak",
        `<a href="/instrumen/${i.id}/edit">Edit</a> · <form method="post" action="/instrumen/${i.id}/salin" class="inline">${csrfInput(cur.csrf)}<button class="linkbtn" type="submit">Salin</button></form>`,
      ]))}`;
    return page(s, c, cur.user, "Instrumen", body);
  });

  app.get("/instrumen/baru", (c) => {
    const cur = requireUser(s, c);
    if (cur instanceof Response) return cur;
    if (cur.user.role === "pengamat") return errPage(s, c, cur.user, "Tidak diizinkan", "Pengamat tidak mengelola instrumen.", "/");
    const body = `<form method="post" action="/instrumen/baru" class="card">
      ${csrfInput(cur.csrf)}
      ${field("Judul instrumen (bebas)", input("title", "", "required"))}
      ${field("Jenis", select("kind", ["rubrik", "checklist", "skala", "anekdotal", "gabungan"].map((k) => ({ value: k, label: k }))))}
      ${field("Level (JSON, mis. [{\"v\":1,\"label\":\"Belum muncul\"},{\"v\":2,\"label\":\"Mulai muncul\"}])", `<textarea name="levels" rows="4">[{"v":1,"label":"Belum muncul"},{"v":2,"label":"Mulai muncul"},{"v":3,"label":"Berkembang sesuai harapan"},{"v":4,"label":"Membudaya"}]</textarea>`)}
      ${field("Visibilitas", select("visibility", [{ value: "private", label: "Pribadi" }, { value: "sekolah", label: "Sekolah (semua guru)" }]))}
      <button class="btn" type="submit">Simpan & kelola kriteria</button>
    </form>`;
    return page(s, c, cur.user, "Buat Instrumen", body);
  });

  app.post("/instrumen/baru", async (c) => {
    const cur = requireUser(s, c);
    if (cur instanceof Response) return cur;
    if (cur.user.role === "pengamat") return errPage(s, c, cur.user, "Tidak diizinkan", "Pengamat tidak mengelola instrumen.", "/");
    const body = await formOf(c);
    if (!checkCsrf(db(), c, body)) return errPage(s, c, cur.user, "Gagal", "Token keamanan tidak valid.", "/instrumen");
    const title = str(body, "title");
    const kind = str(body, "kind");
    if (!title || !["rubrik", "checklist", "skala", "anekdotal", "gabungan"].includes(kind)) return redirectMsg(c, "/instrumen/baru", "Judul dan jenis wajib valid.");
    let levels = "[]";
    try {
      const parsed = JSON.parse(strRaw(body, "levels") || "[]");
      if (!Array.isArray(parsed)) throw new Error("bukan array");
      levels = JSON.stringify(parsed);
    } catch {
      return redirectMsg(c, "/instrumen/baru", "Level harus berupa JSON array yang valid.");
    }
    const info: any = db().query("INSERT INTO instruments (owner_id, title, kind, levels, visibility) VALUES (?, ?, ?, ?, ?)").run(cur.user.id, title, kind, levels, str(body, "visibility") || "private");
    return c.redirect(`/instrumen/${Number(info.lastInsertRowid)}/edit`);
  });

  app.get("/instrumen/:id/edit", (c) => {
    const cur = requireUser(s, c);
    if (cur instanceof Response) return cur;
    const id = Number(c.req.param("id"));
    const inst = db().query("SELECT * FROM instruments WHERE id = ?").get(id) as any;
    if (!inst) return errPage(s, c, cur.user, "Tidak ditemukan", "Instrumen tidak ditemukan.", "/instrumen");
    if (!isAdmin(cur.user) && Number(inst.owner_id) !== cur.user.id) return errPage(s, c, cur.user, "Tidak diizinkan", "Anda hanya boleh mengedit instrumen sendiri (admin boleh semua).", "/instrumen");
    const criteria = db().query("SELECT * FROM criteria WHERE instrument_id = ? ORDER BY sort ASC, id ASC").all(id) as any[];
    const frameworks = visibleFrameworks(db(), cur.user);
    const goals = db().query("SELECT g.*, f.title AS fw_title FROM goals g JOIN frameworks f ON f.id = g.framework_id ORDER BY f.title, g.sort").all() as any[];
    const body = `<form method="post" action="/instrumen/${id}/edit" class="card">
      ${csrfInput(cur.csrf)}
      ${field("Judul", input("title", inst.title, "required"))}
      ${field("Jenis", select("kind", ["rubrik", "checklist", "skala", "anekdotal", "gabungan"].map((k) => ({ value: k, label: k, selected: k === inst.kind }))))}
      ${field("Level (JSON)", `<textarea name="levels" rows="4">${esc(inst.levels)}</textarea>`)}
      ${field("Visibilitas", select("visibility", [{ value: "private", label: "Pribadi", selected: inst.visibility === "private" }, { value: "sekolah", label: "Sekolah", selected: inst.visibility === "sekolah" }]))}
      ${isAdmin(cur.user) ? field("Templat bawaan (hanya admin)", select("is_template", [{ value: "0", label: "Bukan templat", selected: inst.is_template !== 1 }, { value: "1", label: "Templat bawaan", selected: inst.is_template === 1 }])) : ""}
      <button class="btn" type="submit">Simpan instrumen</button>
    </form>
    <form method="post" action="/instrumen/${id}/hapus" class="card" onsubmit="return confirm('Hapus instrumen ini? Instrumen yang sudah dipakai sesi tidak bisa dihapus.')">
      ${csrfInput(cur.csrf)}<button class="btn danger" type="submit">Hapus instrumen</button>
    </form>
    <h2>Kriteria</h2>
    ${table(["Teks", "Tipe input", "Bobot", "Tujuan", "Aksi"], criteria.map((cr) => [
      esc(cr.text),
      esc(cr.input_type),
      String(cr.weight),
      cr.goal_id ? esc((goals.find((g: any) => g.id === Number(cr.goal_id))?.text) || "") : "-",
      `<form method="post" action="/instrumen/${id}/kriteria/${cr.id}/hapus" class="inline">${csrfInput(cur.csrf)}<button class="linkbtn" type="submit">Hapus</button></form>`,
    ])) || "<p>Belum ada kriteria.</p>"}
    <h3>Tambah kriteria</h3>
    <form method="post" action="/instrumen/${id}/kriteria" class="card">
      ${csrfInput(cur.csrf)}
      ${field("Teks kriteria", input("text", "", "required"))}
      ${field("Tipe input", select("input_type", ["rubrik", "checklist", "skala", "teks"].map((k) => ({ value: k, label: k }))))}
      ${field("Bobot", `<input type="number" step="0.1" name="weight" value="1">`)}
      ${field("Deskriptor per level (JSON, mis. {\"1\":\"...\",\"2\":\"...\"})", `<textarea name="descriptors" rows="3">{}</textarea>`)}
      ${field("Tautan tujuan (opsional)", select("goal_id", [{ value: "", label: "— Tanpa tautan —" }, ...goals.map((g: any) => ({ value: String(g.id), label: `${g.fw_title} — ${g.text}` }))]))}
      <button class="btn" type="submit">Tambah kriteria</button>
    </form>
    <p class="muted">Mengubah instrumen di sini TIDAK mengubah sesi yang sudah dibuat, karena sesi memakai snapshot kriteria saat sesi dibuat.</p>
    ${backLink("/instrumen")}`;
    void frameworks;
    return page(s, c, cur.user, `Edit Instrumen — ${inst.title}`, body);
  });

  app.post("/instrumen/:id/edit", async (c) => {
    const cur = requireUser(s, c);
    if (cur instanceof Response) return cur;
    const id = Number(c.req.param("id"));
    const inst = db().query("SELECT * FROM instruments WHERE id = ?").get(id) as any;
    if (!inst) return errPage(s, c, cur.user, "Tidak ditemukan", "Instrumen tidak ditemukan.", "/instrumen");
    if (!isAdmin(cur.user) && Number(inst.owner_id) !== cur.user.id) return errPage(s, c, cur.user, "Tidak diizinkan", "Anda hanya boleh mengedit instrumen sendiri.", "/instrumen");
    const body = await formOf(c);
    if (!checkCsrf(db(), c, body)) return errPage(s, c, cur.user, "Gagal", "Token keamanan tidak valid.", "/instrumen");
    let levels = inst.levels;
    try {
      const parsed = JSON.parse(strRaw(body, "levels") || "[]");
      if (!Array.isArray(parsed)) throw new Error("bukan array");
      levels = JSON.stringify(parsed);
    } catch {
      return redirectMsg(c, `/instrumen/${id}/edit`, "Level harus berupa JSON array yang valid.");
    }
    const isTemplate = isAdmin(cur.user) ? (str(body, "is_template") === "1" ? 1 : 0) : inst.is_template;
    db().query("UPDATE instruments SET title = ?, kind = ?, levels = ?, visibility = ?, is_template = ? WHERE id = ?").run(str(body, "title"), str(body, "kind"), levels, str(body, "visibility") || "private", isTemplate, id);
    return redirectMsg(c, `/instrumen/${id}/edit`, "Instrumen tersimpan.");
  });

  app.post("/instrumen/:id/kriteria", async (c) => {
    const cur = requireUser(s, c);
    if (cur instanceof Response) return cur;
    const id = Number(c.req.param("id"));
    const inst = db().query("SELECT * FROM instruments WHERE id = ?").get(id) as any;
    if (!inst) return errPage(s, c, cur.user, "Tidak ditemukan", "Instrumen tidak ditemukan.", "/instrumen");
    if (!isAdmin(cur.user) && Number(inst.owner_id) !== cur.user.id) return errPage(s, c, cur.user, "Tidak diizinkan", "Anda hanya boleh mengedit instrumen sendiri.", "/instrumen");
    const body = await formOf(c);
    if (!checkCsrf(db(), c, body)) return errPage(s, c, cur.user, "Gagal", "Token keamanan tidak valid.", "/instrumen");
    const inputType = str(body, "input_type");
    if (!["rubrik", "checklist", "skala", "teks"].includes(inputType)) return redirectMsg(c, `/instrumen/${id}/edit`, "Tipe input tidak valid.");
    if (inst.kind !== "gabungan" && inputType !== inst.kind && inputType !== "teks") {
      return redirectMsg(c, `/instrumen/${id}/edit`, "Untuk instrumen bukan gabungan, tipe kriteria harus sama dengan jenis instrumen (atau teks untuk catatan).");
    }
    let descriptors = "{}";
    try {
      const parsed = JSON.parse(strRaw(body, "descriptors") || "{}");
      descriptors = JSON.stringify(parsed);
    } catch {
      return redirectMsg(c, `/instrumen/${id}/edit`, "Deskriptor harus berupa JSON objek yang valid.");
    }
    const maxSort = (db().query("SELECT COALESCE(MAX(sort),0) m FROM criteria WHERE instrument_id = ?").get(id) as any).m;
    db().query("INSERT INTO criteria (instrument_id, goal_id, text, descriptors, weight, input_type, sort) VALUES (?, ?, ?, ?, ?, ?, ?)").run(
      id, str(body, "goal_id") ? Number(str(body, "goal_id")) : null, str(body, "text"), descriptors, Number(str(body, "weight") || "1"), inputType, Number(maxSort) + 1,
    );
    return redirectMsg(c, `/instrumen/${id}/edit`, "Kriteria ditambahkan.");
  });

  app.post("/instrumen/:id/kriteria/:cid/hapus", async (c) => {
    const cur = requireUser(s, c);
    if (cur instanceof Response) return cur;
    const id = Number(c.req.param("id"));
    const cid = Number(c.req.param("cid"));
    const inst = db().query("SELECT * FROM instruments WHERE id = ?").get(id) as any;
    if (!inst || (!isAdmin(cur.user) && Number(inst.owner_id) !== cur.user.id)) return errPage(s, c, cur.user, "Tidak diizinkan", "Anda tidak berhak menghapus kriteria ini.", "/instrumen");
    const body = await formOf(c);
    if (!checkCsrf(db(), c, body)) return errPage(s, c, cur.user, "Gagal", "Token keamanan tidak valid.", "/instrumen");
    db().query("DELETE FROM criteria WHERE id = ? AND instrument_id = ?").run(cid, id);
    return redirectMsg(c, `/instrumen/${id}/edit`, "Kriteria dihapus (snapshot sesi lama tidak berubah).");
  });

  app.post("/instrumen/:id/salin", async (c) => {
    const cur = requireUser(s, c);
    if (cur instanceof Response) return cur;
    if (cur.user.role === "pengamat") return errPage(s, c, cur.user, "Tidak diizinkan", "Pengamat tidak menyalin instrumen.", "/instrumen");
    const id = Number(c.req.param("id"));
    const inst = db().query("SELECT * FROM instruments WHERE id = ?").get(id) as any;
    if (!inst) return errPage(s, c, cur.user, "Tidak ditemukan", "Instrumen tidak ditemukan.", "/instrumen");
    const body = await formOf(c);
    if (!checkCsrf(db(), c, body)) return errPage(s, c, cur.user, "Gagal", "Token keamanan tidak valid.", "/instrumen");
    const tx = db().transaction(() => {
      const info: any = db().query("INSERT INTO instruments (owner_id, title, kind, levels, visibility, is_template, forked_from) VALUES (?, ?, ?, ?, 'private', 0, ?)").run(
        cur.user.id, `${inst.title} (salinan)`, inst.kind, inst.levels, id,
      );
      const newId = Number(info.lastInsertRowid);
      const crit = db().query("SELECT * FROM criteria WHERE instrument_id = ? ORDER BY sort ASC").all(id) as any[];
      for (const cr of crit) {
        db().query("INSERT INTO criteria (instrument_id, goal_id, text, descriptors, weight, input_type, sort) VALUES (?, ?, ?, ?, ?, ?, ?)").run(
          newId, cr.goal_id, cr.text, cr.descriptors, cr.weight, cr.input_type, cr.sort,
        );
      }
      return newId;
    });
    const newId = tx() as number;
    return c.redirect(`/instrumen/${newId}/edit`);
  });

  app.post("/instrumen/:id/hapus", async (c) => {
    const cur = requireUser(s, c);
    if (cur instanceof Response) return cur;
    const id = Number(c.req.param("id"));
    const inst = db().query("SELECT * FROM instruments WHERE id = ?").get(id) as any;
    if (!inst) return errPage(s, c, cur.user, "Tidak ditemukan", "Instrumen tidak ditemukan.", "/instrumen");
    if (!isAdmin(cur.user) && Number(inst.owner_id) !== cur.user.id) return errPage(s, c, cur.user, "Tidak diizinkan", "Anda hanya boleh menghapus instrumen sendiri.", "/instrumen");
    const body = await formOf(c);
    if (!checkCsrf(db(), c, body)) return errPage(s, c, cur.user, "Gagal", "Token keamanan tidak valid.", "/instrumen");
    const used = db().query("SELECT COUNT(*) c FROM sessions WHERE instrument_id = ?").get(id) as any;
    if (used.c > 0) return redirectMsg(c, `/instrumen/${id}/edit`, "Instrumen sudah dipakai sesi dan tidak bisa dihapus (riwayat dilindungi).");
    db().query("DELETE FROM instruments WHERE id = ?").run(id);
    return redirectMsg(c, "/instrumen", "Instrumen dihapus.");
  });

  // ---------- Kerangka ----------
  app.get("/kerangka", (c) => {
    const cur = requireUser(s, c);
    if (cur instanceof Response) return cur;
    if (cur.user.role === "pengamat") return errPage(s, c, cur.user, "Tidak diizinkan", "Pengamat tidak mengelola kerangka.", "/");
    const list = visibleFrameworks(db(), cur.user);
    const body = `<form method="post" action="/kerangka/baru" class="card">
      ${csrfInput(cur.csrf)}
      ${field("Judul kerangka (bebas)", input("title", "", "required"))}
      ${field("Deskripsi", `<textarea name="description" rows="2"></textarea>`)}
      ${field("Visibilitas", select("visibility", [{ value: "private", label: "Pribadi" }, { value: "sekolah", label: "Sekolah" }]))}
      <button class="btn" type="submit">Buat kerangka</button>
    </form>
    ${table(["Judul", "Templat?", "Aksi"], list.map((f) => [esc(f.title), f.is_template ? "Ya" : "Tidak", `<a href="/kerangka/${f.id}">Kelola tujuan</a>`]))}`;
    return page(s, c, cur.user, "Kerangka Acuan", body);
  });

  app.post("/kerangka/baru", async (c) => {
    const cur = requireUser(s, c);
    if (cur instanceof Response) return cur;
    if (cur.user.role === "pengamat") return errPage(s, c, cur.user, "Tidak diizinkan", "Pengamat tidak mengelola kerangka.", "/");
    const body = await formOf(c);
    if (!checkCsrf(db(), c, body)) return errPage(s, c, cur.user, "Gagal", "Token keamanan tidak valid.", "/kerangka");
    const info: any = db().query("INSERT INTO frameworks (owner_id, title, description, visibility) VALUES (?, ?, ?, ?)").run(cur.user.id, str(body, "title"), str(body, "description") || null, str(body, "visibility") || "private");
    return c.redirect(`/kerangka/${Number(info.lastInsertRowid)}`);
  });

  app.get("/kerangka/:id", (c) => {
    const cur = requireUser(s, c);
    if (cur instanceof Response) return cur;
    const id = Number(c.req.param("id"));
    const fw = db().query("SELECT * FROM frameworks WHERE id = ?").get(id) as any;
    if (!fw) return errPage(s, c, cur.user, "Tidak ditemukan", "Kerangka tidak ditemukan.", "/kerangka");
    if (!isAdmin(cur.user) && Number(fw.owner_id) !== cur.user.id && fw.visibility !== "sekolah" && fw.is_template !== 1) return errPage(s, c, cur.user, "Tidak diizinkan", "Anda tidak berhak membuka kerangka ini.", "/kerangka");
    const goals = db().query("SELECT * FROM goals WHERE framework_id = ? ORDER BY sort ASC, id ASC").all(id) as any[];
    const body = `<p>${esc(fw.description || "")}</p>
      <h2>Tujuan</h2>
      ${table(["Kode", "Teks", "Induk"], goals.map((g) => [esc(g.code || "-"), esc(g.text), g.parent_id ? esc((goals.find((x: any) => x.id === Number(g.parent_id))?.text) || "") : "-"]))}
      <h3>Tambah tujuan</h3>
      <form method="post" action="/kerangka/${id}/tujuan" class="card">
        ${csrfInput(cur.csrf)}
        ${field("Kode (opsional)", input("code", ""))}
        ${field("Teks tujuan", input("text", "", "required"))}
        ${field("Induk (opsional, untuk tujuan bersarang)", select("parent_id", [{ value: "", label: "— Tanpa induk —" }, ...goals.map((g: any) => ({ value: String(g.id), label: g.text }))]))}
        <button class="btn" type="submit">Tambah tujuan</button>
      </form>${backLink("/kerangka")}`;
    return page(s, c, cur.user, `Kerangka — ${fw.title}`, body);
  });

  app.post("/kerangka/:id/tujuan", async (c) => {
    const cur = requireUser(s, c);
    if (cur instanceof Response) return cur;
    const id = Number(c.req.param("id"));
    const fw = db().query("SELECT * FROM frameworks WHERE id = ?").get(id) as any;
    if (!fw || (!isAdmin(cur.user) && Number(fw.owner_id) !== cur.user.id)) return errPage(s, c, cur.user, "Tidak diizinkan", "Anda hanya boleh menambah tujuan pada kerangka sendiri (admin boleh semua).", "/kerangka");
    const body = await formOf(c);
    if (!checkCsrf(db(), c, body)) return errPage(s, c, cur.user, "Gagal", "Token keamanan tidak valid.", "/kerangka");
    const maxSort = (db().query("SELECT COALESCE(MAX(sort),0) m FROM goals WHERE framework_id = ?").get(id) as any).m;
    db().query("INSERT INTO goals (framework_id, parent_id, code, text, sort) VALUES (?, ?, ?, ?, ?)").run(id, str(body, "parent_id") ? Number(str(body, "parent_id")) : null, str(body, "code") || null, str(body, "text"), Number(maxSort) + 1);
    return redirectMsg(c, `/kerangka/${id}`, "Tujuan ditambahkan.");
  });

  // ---------- Profil murid ----------
  app.get("/murid/:id", (c) => {
    const cur = requireUser(s, c);
    if (cur instanceof Response) return cur;
    const id = Number(c.req.param("id"));
    const st = db().query("SELECT * FROM students WHERE id = ?").get(id) as any;
    if (!st) return errPage(s, c, cur.user, "Tidak ditemukan", "Murid tidak ditemukan.", "/");
    if (!canAccessStudent(db(), cur.user, id)) return errPage(s, c, cur.user, "Tidak diizinkan", "Anda tidak berhak membuka profil murid ini.", "/");
    const period = activePeriod(db());
    const recap = studentRecap(db(), id, period ? Number(period.id) : null);
    const enroll = db().query("SELECT cl.name, p.name AS period_name FROM enrollments e JOIN classes cl ON cl.id = e.class_id LEFT JOIN periods p ON p.id = cl.period_id WHERE e.student_id = ?").all(id) as any[];
    const groups = db().query("SELECT g.name, cl.name AS class_name FROM group_members gm JOIN groups g ON g.id = gm.group_id JOIN classes cl ON cl.id = g.class_id WHERE gm.student_id = ?").all(id) as any[];
    const points = trendPoints(recap.observations);
    const body = `<p>NIS: ${esc(st.student_no || "-")} · Kelas: ${enroll.map((e: any) => `${esc(e.name)} (${esc(e.period_name || "")})`).join(", ") || "-"} · Kelompok: ${groups.map((g: any) => `${esc(g.name)} (${esc(g.class_name)})`).join(", ") || "-"}</p>
      <div class="cards"><div class="stat"><b>${recap.overall === null ? "—" : fmt(recap.overall)}</b><span>Skor keseluruhan${period ? ` (${esc(period.name)})` : ""}</span></div>
      <div class="stat"><b>${recap.overall100 === null ? "—" : Math.round(recap.overall100)}</b><span>Dari 100</span></div>
      <div class="stat"><b>${recap.observations.length}</b><span>Observasi</span></div></div>
      <p class="muted">Skor keseluruhan selalu ditampilkan bersama rincian per instrumen di bawah, sesuai rencana.</p>
      <h2>Tren</h2>${trendSvg(points)}
      <h2>Per instrumen</h2>
      ${table(["Instrumen", "Rata-rata", "Dari 100", "Jumlah"], recap.perInstrument.map((r) => [esc(r.title), r.average === null ? "—" : fmt(r.average), r.average100 === null ? "—" : String(Math.round(r.average100)), String(r.count)]))}
      <h2>Per kriteria</h2>
      ${table(["Kriteria", "Rata-rata", "Jumlah", "Distribusi"], recap.perCriterion.map((r) => [esc(r.text), r.average === null ? "—" : fmt(r.average), String(r.count), esc(Object.entries(r.distribution).map(([k, v]) => `${k}: ${v}`).join(", "))]))}
      <h2>Per tujuan</h2>
      ${table(["Tujuan", "Skor"], recap.perGoal.map((g) => [esc(g.text), g.score === null ? "—" : fmt(g.score)]))}
      <h2>Riwayat observasi</h2>
      ${table(["Tanggal", "Aktivitas", "Instrumen", "Skor", "Catatan"], recap.observations.map((o) => [
        esc(o.observedAt),
        esc(o.activity || "-") + (o.isGroup ? ` <span class="badge">Kelompok: ${esc(o.groupName || "")}</span>` : ""),
        esc(o.instrumentTitle || "Tanpa instrumen"),
        o.score === null ? "—" : fmtDual(o.score, o.maxLevel) + (o.complete ? "" : " (belum lengkap)"),
        esc(o.note || "-"),
      ]))}
      <p><a class="btn" href="/rekap/murid/${id}/cetak">Laporan cetak & narasi</a></p>`;
    return page(s, c, cur.user, `Profil — ${st.name}`, body);
  });

  // ---------- Rekap kelas ----------
  app.get("/rekap/kelas/:id", (c) => {
    const cur = requireUser(s, c);
    if (cur instanceof Response) return cur;
    const id = Number(c.req.param("id"));
    const cl = db().query("SELECT cl.*, p.name AS period_name FROM classes cl LEFT JOIN periods p ON p.id = cl.period_id WHERE cl.id = ?").get(id) as any;
    if (!cl) return errPage(s, c, cur.user, "Tidak ditemukan", "Kelas tidak ditemukan.", "/");
    if (!canViewClassRecap(db(), cur.user, id)) return errPage(s, c, cur.user, "Tidak diizinkan", "Anda tidak berhak membuka rekap kelas ini.", "/");
    const students = classStudents(db(), id);
    const observed = observedStudentIds(db(), id);
    const period = activePeriod(db());
    const rows = students.map((st) => {
      const recap = studentRecap(db(), Number(st.id), period ? Number(period.id) : Number(cl.period_id));
      return { st, recap };
    });
    const ranked = [...rows].filter((r) => r.recap.overall100 !== null).sort((a, b) => (b.recap.overall100! - a.recap.overall100!));
    const rankMap = new Map<number, number>();
    ranked.forEach((r, i) => rankMap.set(Number(r.st.id), i + 1));
    const notObserved = students.filter((st) => !observed.has(Number(st.id)));
    const body = `<p>Periode: ${esc(cl.period_name || "-")} · Murid: ${students.length} · Sudah diamati: ${observed.size} · Belum diamati: ${notObserved.length}</p>
      <h2>Rekap per murid (peringkat hanya di rekap kelas)</h2>
      ${table(["Peringkat", "Murid", "NIS", "Skor", "Dari 100", "Observasi"], rows.map((r) => [
        r.recap.overall100 === null ? "—" : String(rankMap.get(Number(r.st.id)) || "—"),
        `<a href="/murid/${r.st.id}">${esc(r.st.name)}</a>`,
        esc(r.st.student_no || "-"),
        r.recap.overall === null ? "—" : fmt(r.recap.overall),
        r.recap.overall100 === null ? "—" : String(Math.round(r.recap.overall100)),
        String(r.recap.observations.length),
      ]))}
      <h2>Belum diamati</h2><ul>${notObserved.map((st) => `<li>${esc(st.name)} (${esc(st.student_no || "-")})</li>`).join("") || "<li>Semua murid sudah diamati.</li>"}</ul>
      <h2>Kelompok</h2>
      ${table(["Kelompok", "Anggota", "Observasi"], classGroups(db(), id).map((g) => {
        const members = db().query("SELECT s.name FROM group_members gm JOIN students s ON s.id = gm.student_id WHERE gm.group_id = ? ORDER BY s.name ASC").all(g.id) as any[];
        const obsCount = (db().query("SELECT COUNT(*) c FROM observations WHERE group_id = ?").get(g.id) as any).c;
        return [esc(g.name), esc(members.map((m: any) => m.name).join(", ")), String(obsCount)];
      }))}
      ${backLink(`/kelas/${id}`)}`;
    return page(s, c, cur.user, `Rekap Kelas — ${cl.name}`, body);
  });

  // ---------- Cetak + narasi ----------
  function printData(db: Database, studentId: number) {
    const st = db.query("SELECT * FROM students WHERE id = ?").get(studentId) as any;
    const period = activePeriod(db);
    const recap = studentRecap(db, studentId, period ? Number(period.id) : null);
    let saved: any = null;
    if (period) saved = db.query("SELECT * FROM report_narratives WHERE student_id = ? AND period_id = ?").get(studentId, period.id) as any;
    return { st, period, recap, saved };
  }

  app.get("/rekap/murid/:id/cetak", (c) => {
    const cur = requireUser(s, c);
    if (cur instanceof Response) return cur;
    const id = Number(c.req.param("id"));
    if (!canAccessStudent(db(), cur.user, id)) return errPage(s, c, cur.user, "Tidak diizinkan", "Anda tidak berhak membuka laporan murid ini.", "/");
    const { st, period, recap, saved } = printData(db(), id);
    if (!st) return errPage(s, c, cur.user, "Tidak ditemukan", "Murid tidak ditemukan.", "/");
    // Narasi: pakai yang tersimpan bila ada; bila belum ada, buat otomatis (tanpa menimpa apa pun)
    let narrative = saved?.narrative || "";
    if (!narrative) {
      const critForNarr: any[] = [];
      // Deskriptor diambil dari kriteria snapshot terakhir per teks kriteria
      for (const pc of recap.perCriterion) {
        const row = db().query("SELECT sc.descriptors, i.levels FROM session_criteria sc JOIN sessions s ON s.id = sc.session_id LEFT JOIN instruments i ON i.id = s.instrument_id WHERE sc.text = ? ORDER BY sc.id DESC LIMIT 1").get(pc.text) as any;
        let descriptor: string | null = null;
        let levels: any[] = [];
        try { levels = row?.levels ? JSON.parse(row.levels) : []; } catch { levels = []; }
        const avg = pc.average;
        if (row?.descriptors && avg !== null) {
          try {
            const d = JSON.parse(row.descriptors);
            const nearest = levels.length ? levels.reduce((a: any, b: any) => (Math.abs(b.v - avg) < Math.abs(a.v - avg) ? b : a)) : null;
            descriptor = nearest ? d[String(nearest.v)] || null : null;
          } catch { descriptor = null; }
        }
        critForNarr.push({ text: pc.text, average: pc.average, levels, descriptor });
      }
      narrative = generateNarrative({ studentName: st.name, periodName: period?.name || null, criteria: critForNarr, activities: recap.activities, notes: recap.notes, overall100: recap.overall100 });
    }
    const points = trendPoints(recap.observations);
    const settings = db().query("SELECT * FROM settings WHERE id = 1").get() as any;
    const canEdit = cur.user.role === "admin" || cur.user.role === "guru";
    const body = `<div class="printsheet">
      <div class="kop"><b>${esc(settings.school_name)}</b><br>${esc(settings.school_address || "")}</div>
      <h2>Laporan Perkembangan Murid</h2>
      <p>Nama: <b>${esc(st.name)}</b> · NIS: ${esc(st.student_no || "-")} · Periode: ${esc(period?.name || "-")}</p>
      <p>Skor keseluruhan: <b>${recap.overall === null ? "—" : fmt(recap.overall)}</b> (${recap.overall100 === null ? "—" : Math.round(recap.overall100)} dari 100)</p>
      ${table(["Instrumen", "Rata-rata", "Dari 100"], recap.perInstrument.map((r) => [esc(r.title), r.average === null ? "—" : fmt(r.average), r.average100 === null ? "—" : String(Math.round(r.average100))]))}
      <h3>Grafik tren</h3>${trendSvg(points)}
      <h3>Narasi</h3><div class="narrative">${esc(narrative).replace(/\n/g, "<br>")}</div>
      <div class="ttd"><p>Guru / Wali kelas</p><br><br><p>________________________</p><p>Kepala Sekolah: ${esc(settings.principal_name || "________________________")}</p></div>
    </div>
    ${canEdit ? `<form method="post" action="/rekap/murid/${id}/narasi" class="card noprint">
      ${csrfInput(cur.csrf)}
      <label class="field"><span>Edit narasi (disimpan per murid per periode)</span><textarea name="narrative" rows="8">${esc(narrative)}</textarea></label>
      <button class="btn" type="submit" name="action" value="save">Simpan narasi</button>
      <button class="btn secondary" type="submit" name="action" value="regenerate">Buat ulang narasi</button>
      <p class="muted">Tombol "Buat ulang narasi" menimpa hasil edit dengan narasi otomatis terbaru. Tanpa tombol itu, regenerasi tidak menimpa narasi yang sudah diedit.</p>
    </form>` : `<p class="muted">Narasi hanya bisa diedit guru/admin.</p>`}
    <p class="noprint"><button class="btn" onclick="window.print()">Cetak / Simpan PDF</button> ${backLink(`/murid/${id}`)}</p>`;
    return page(s, c, cur.user, `Laporan — ${st.name}`, body, true);
  });

  app.post("/rekap/murid/:id/narasi", async (c) => {
    const cur = requireUser(s, c);
    if (cur instanceof Response) return cur;
    const id = Number(c.req.param("id"));
    if (!canAccessStudent(db(), cur.user, id) || cur.user.role === "pengamat") return errPage(s, c, cur.user, "Tidak diizinkan", "Hanya guru/admin yang boleh mengedit narasi.", "/");
    const period = activePeriod(db());
    if (!period) return redirectMsg(c, `/murid/${id}`, "Belum ada periode aktif untuk menyimpan narasi.");
    const body = await formOf(c);
    if (!checkCsrf(db(), c, body)) return errPage(s, c, cur.user, "Gagal", "Token keamanan tidak valid.", `/murid/${id}`);
    const action = str(body, "action");
    if (action === "regenerate") {
      const { recap, st } = printData(db(), id);
      const text = generateNarrative({ studentName: st.name, periodName: period.name, criteria: recap.perCriterion.map((pc) => ({ text: pc.text, average: pc.average, levels: [], descriptor: null })), activities: recap.activities, notes: recap.notes, overall100: recap.overall100 });
      db().query("INSERT INTO report_narratives (student_id, period_id, narrative, edited_by, updated_at) VALUES (?, ?, ?, ?, datetime('now')) ON CONFLICT(student_id, period_id) DO UPDATE SET narrative = excluded.narrative, edited_by = excluded.edited_by, updated_at = datetime('now')").run(id, period.id, text, cur.user.id);
      return redirectMsg(c, `/rekap/murid/${id}/cetak`, "Narasi dibuat ulang.");
    }
    const narrative = strRaw(body, "narrative");
    if (!narrative) return redirectMsg(c, `/rekap/murid/${id}/cetak`, "Narasi tidak boleh kosong.");
    db().query("INSERT INTO report_narratives (student_id, period_id, narrative, edited_by, updated_at) VALUES (?, ?, ?, ?, datetime('now')) ON CONFLICT(student_id, period_id) DO UPDATE SET narrative = excluded.narrative, edited_by = excluded.edited_by, updated_at = datetime('now')").run(id, period.id, narrative, cur.user.id);
    return redirectMsg(c, `/rekap/murid/${id}/cetak`, "Narasi tersimpan.");
  });

  // ---------- Bukti ----------
  app.get("/bukti/:id", async (c) => {
    const cur = requireUser(s, c);
    if (cur instanceof Response) return cur;
    const id = Number(c.req.param("id"));
    const ev = db().query("SELECT * FROM evidence WHERE id = ?").get(id) as any;
    if (!ev || ev.kind !== "foto") return errPage(s, c, cur.user, "Tidak ditemukan", "Bukti foto tidak ditemukan.", "/");
    if (!canAccessEvidence(db(), cur.user, id)) return errPage(s, c, cur.user, "Tidak diizinkan", "Anda tidak berhak membuka bukti ini.", "/");
    const filePath = join(s.dataDir, "bukti", basename(ev.path));
    const file = Bun.file(filePath);
    if (!(await file.exists())) return errPage(s, c, cur.user, "Tidak ditemukan", "Berkas foto tidak ditemukan di server.", "/");
    return new Response(file, { headers: { "Content-Type": ev.mime || "image/jpeg", "Content-Disposition": `inline; filename="${basename(ev.path)}"` } });
  });

  app.post("/bukti/:id/hapus", async (c) => {
    const cur = requireUser(s, c);
    if (cur instanceof Response) return cur;
    const id = Number(c.req.param("id"));
    const ev = db().query("SELECT * FROM evidence WHERE id = ?").get(id) as any;
    if (!ev) return errPage(s, c, cur.user, "Tidak ditemukan", "Bukti tidak ditemukan.", "/");
    // Hanya pencatat (admin/guru pengampu) yang boleh menghapus; pengamat tidak.
    const obs = db().query("SELECT o.*, s.class_id FROM observations o JOIN sessions s ON s.id = o.session_id WHERE o.id = ?").get(ev.observation_id) as any;
    if (!obs || !canRecordSession(db(), cur.user, Number(obs.class_id))) return errPage(s, c, cur.user, "Tidak diizinkan", "Anda tidak berhak menghapus bukti ini.", "/");
    const body = await formOf(c);
    if (!checkCsrf(db(), c, body)) return errPage(s, c, cur.user, "Gagal", "Token keamanan tidak valid.", "/");
    const back = str(body, "back") || `/catat/${obs.session_id}`;
    if (ev.kind === "foto" && ev.path) {
      try { await Bun.file(join(s.dataDir, "bukti", basename(ev.path))).delete(); } catch { /* berkas sudah tidak ada */ }
    }
    db().query("DELETE FROM evidence WHERE id = ?").run(id);
    return redirectMsg(c, back, "Bukti dihapus.");
  });

  // ---------- Admin ----------
  function requireAdmin(s: AppState, c: Ctx): { user: User; csrf: string } | Response {
    const cur = requireUser(s, c);
    if (cur instanceof Response) return cur;
    if (!isAdmin(cur.user)) return errPage(s, c, cur.user, "Tidak diizinkan", "Halaman ini hanya untuk admin.", "/");
    return cur;
  }

  app.get("/admin", (c) => {
    const cur = requireAdmin(s, c);
    if (cur instanceof Response) return cur;
    const body = `<div class="grid">
      <a class="griditem" href="/admin/pengaturan"><b>Pengaturan</b><span>Nama sekolah, kepala sekolah</span></a>
      <a class="griditem" href="/admin/periode"><b>Periode</b><span>Tambah & aktifkan</span></a>
      <a class="griditem" href="/admin/kelas"><b>Kelas</b><span>Tambah & guru pengampu</span></a>
      <a class="griditem" href="/admin/murid"><b>Murid</b><span>Manual & impor CSV</span></a>
      <a class="griditem" href="/admin/guru"><b>Guru & Akun</b><span>Manual, impor CSV, akun pengamat</span></a>
      <a class="griditem" href="/admin/kelompok"><b>Kelompok</b><span>Ceklis murid & impor CSV</span></a>
      <a class="griditem" href="/admin/templat"><b>Templat</b><span>Instrumen & kerangka bawaan</span></a>
      <a class="griditem" href="/admin/backup"><b>Backup</b><span>Unduh & restore</span></a>
    </div>`;
    return page(s, c, cur.user, "Admin", body);
  });

  app.get("/admin/pengaturan", (c) => {
    const cur = requireAdmin(s, c);
    if (cur instanceof Response) return cur;
    const st = db().query("SELECT * FROM settings WHERE id = 1").get() as any;
    const body = `<form method="post" action="/admin/pengaturan" class="card">
      ${csrfInput(cur.csrf)}
      ${field("Nama sekolah", input("school_name", st.school_name, "required"))}
      ${field("Alamat sekolah", input("school_address", st.school_address || ""))}
      ${field("Nama kepala sekolah", input("principal_name", st.principal_name || ""))}
      <button class="btn" type="submit">Simpan pengaturan</button>
    </form>${backLink("/admin")}`;
    return page(s, c, cur.user, "Pengaturan Sekolah", body);
  });

  app.post("/admin/pengaturan", async (c) => {
    const cur = requireAdmin(s, c);
    if (cur instanceof Response) return cur;
    const body = await formOf(c);
    if (!checkCsrf(db(), c, body)) return errPage(s, c, cur.user, "Gagal", "Token keamanan tidak valid.", "/admin");
    db().query("UPDATE settings SET school_name = ?, school_address = ?, principal_name = ? WHERE id = 1").run(str(body, "school_name"), str(body, "school_address") || null, str(body, "principal_name") || null);
    return redirectMsg(c, "/admin/pengaturan", "Pengaturan tersimpan.");
  });

  app.get("/admin/periode", (c) => {
    const cur = requireAdmin(s, c);
    if (cur instanceof Response) return cur;
    const periods = db().query("SELECT * FROM periods ORDER BY id DESC").all() as any[];
    const body = `<form method="post" action="/admin/periode" class="card">
      ${csrfInput(cur.csrf)}
      ${field("Nama periode (mis. 2026/2027 Ganjil)", input("name", "", "required"))}
      ${field("Mulai", `<input type="date" name="starts_on">`)}
      ${field("Selesai", `<input type="date" name="ends_on">`)}
      <button class="btn" type="submit">Tambah periode</button>
    </form>
    ${table(["Nama", "Mulai", "Selesai", "Aktif", "Aksi"], periods.map((p) => [
      esc(p.name), esc(p.starts_on || "-"), esc(p.ends_on || "-"), p.is_active ? "Ya" : "Tidak",
      p.is_active ? "-" : `<form method="post" action="/admin/periode/${p.id}/aktifkan" class="inline">${csrfInput(cur.csrf)}<button class="linkbtn" type="submit">Aktifkan</button></form>`,
    ]))}${backLink("/admin")}`;
    return page(s, c, cur.user, "Periode", body);
  });

  app.post("/admin/periode", async (c) => {
    const cur = requireAdmin(s, c);
    if (cur instanceof Response) return cur;
    const body = await formOf(c);
    if (!checkCsrf(db(), c, body)) return errPage(s, c, cur.user, "Gagal", "Token keamanan tidak valid.", "/admin");
    db().query("INSERT INTO periods (name, starts_on, ends_on, is_active) VALUES (?, ?, ?, 0)").run(str(body, "name"), str(body, "starts_on") || null, str(body, "ends_on") || null);
    return redirectMsg(c, "/admin/periode", "Periode ditambahkan. Aktifkan satu periode agar menjadi periode berjalan.");
  });

  app.post("/admin/periode/:id/aktifkan", async (c) => {
    const cur = requireAdmin(s, c);
    if (cur instanceof Response) return cur;
    const body = await formOf(c);
    if (!checkCsrf(db(), c, body)) return errPage(s, c, cur.user, "Gagal", "Token keamanan tidak valid.", "/admin");
    const id = Number(c.req.param("id"));
    db().transaction(() => {
      db().query("UPDATE periods SET is_active = 0").run();
      db().query("UPDATE periods SET is_active = 1 WHERE id = ?").run(id);
    })();
    return redirectMsg(c, "/admin/periode", "Periode diaktifkan; periode lain otomatis nonaktif.");
  });

  app.get("/admin/kelas", (c) => {
    const cur = requireAdmin(s, c);
    if (cur instanceof Response) return cur;
    const periods = db().query("SELECT * FROM periods ORDER BY id DESC").all() as any[];
    const classes = db().query("SELECT cl.*, p.name AS period_name FROM classes cl LEFT JOIN periods p ON p.id = cl.period_id ORDER BY cl.id DESC").all() as any[];
    const gurus = db().query("SELECT * FROM users WHERE role = 'guru' AND active = 1 ORDER BY name ASC").all() as any[];
    const body = `<form method="post" action="/admin/kelas" class="card">
      ${csrfInput(cur.csrf)}
      ${field("Periode", select("period_id", periods.map((p) => ({ value: String(p.id), label: p.name }))))}
      ${field("Nama kelas", input("name", "", "required placeholder='Mis. 7.1'"))}
      ${field("Label tingkat (bebas)", input("level_label", "", "placeholder='Mis. Kelas 7 / Fase A'"))}
      <button class="btn" type="submit">Tambah kelas</button>
    </form>
    ${classes.map((cl) => {
      const teachers = db().query("SELECT ct.id, u.name, ct.subject_label FROM class_teachers ct JOIN users u ON u.id = ct.user_id WHERE ct.class_id = ?").all(cl.id) as any[];
      return `<div class="card"><b>${esc(cl.name)}</b> (${esc(cl.period_name || "")})
        <ul>${teachers.map((t) => `<li>${esc(t.name)}${t.subject_label ? ` — ${esc(t.subject_label)}` : ""} <form method="post" action="/admin/kelas/${cl.id}/pengampu/${t.id}/hapus" class="inline">${csrfInput(cur.csrf)}<button class="linkbtn" type="submit">Lepas</button></form></li>`).join("") || "<li>Belum ada guru pengampu.</li>"}</ul>
        <form method="post" action="/admin/kelas/${cl.id}/pengampu" class="inline">
          ${csrfInput(cur.csrf)}
          ${select("user_id", gurus.map((g) => ({ value: String(g.id), label: g.name })))}
          ${input("subject_label", "", "placeholder='Mapel / Wali kelas'")}
          <button class="btn secondary" type="submit">Tambah pengampu</button>
        </form></div>`;
    }).join("")}${backLink("/admin")}`;
    return page(s, c, cur.user, "Kelas", body);
  });

  app.post("/admin/kelas", async (c) => {
    const cur = requireAdmin(s, c);
    if (cur instanceof Response) return cur;
    const body = await formOf(c);
    if (!checkCsrf(db(), c, body)) return errPage(s, c, cur.user, "Gagal", "Token keamanan tidak valid.", "/admin");
    try {
      db().query("INSERT INTO classes (period_id, name, level_label) VALUES (?, ?, ?)").run(Number(str(body, "period_id")), str(body, "name"), str(body, "level_label") || null);
    } catch {
      return redirectMsg(c, "/admin/kelas", "Nama kelas sudah ada pada periode ini.");
    }
    return redirectMsg(c, "/admin/kelas", "Kelas ditambahkan.");
  });

  app.post("/admin/kelas/:id/pengampu", async (c) => {
    const cur = requireAdmin(s, c);
    if (cur instanceof Response) return cur;
    const body = await formOf(c);
    if (!checkCsrf(db(), c, body)) return errPage(s, c, cur.user, "Gagal", "Token keamanan tidak valid.", "/admin");
    const id = Number(c.req.param("id"));
    db().query("INSERT OR IGNORE INTO class_teachers (class_id, user_id, subject_label) VALUES (?, ?, ?)").run(id, Number(str(body, "user_id")), str(body, "subject_label") || null);
    return redirectMsg(c, "/admin/kelas", "Guru pengampu ditambahkan.");
  });

  app.post("/admin/kelas/:id/pengampu/:tid/hapus", async (c) => {
    const cur = requireAdmin(s, c);
    if (cur instanceof Response) return cur;
    const body = await formOf(c);
    if (!checkCsrf(db(), c, body)) return errPage(s, c, cur.user, "Gagal", "Token keamanan tidak valid.", "/admin");
    db().query("DELETE FROM class_teachers WHERE id = ? AND class_id = ?").run(Number(c.req.param("tid")), Number(c.req.param("id")));
    return redirectMsg(c, "/admin/kelas", "Guru pengampu dilepas.");
  });

  app.get("/admin/murid", (c) => {
    const cur = requireAdmin(s, c);
    if (cur instanceof Response) return cur;
    const classes = db().query("SELECT cl.*, p.name AS period_name FROM classes cl LEFT JOIN periods p ON p.id = cl.period_id ORDER BY cl.id DESC").all() as any[];
    const students = db().query("SELECT * FROM students ORDER BY name ASC LIMIT 200").all() as any[];
    const body = `<form method="post" action="/admin/murid" class="card">
      ${csrfInput(cur.csrf)}
      ${field("Nama murid", input("name", "", "required"))}
      ${field("NIS", input("student_no", ""))}
      ${field("Masukkan ke kelas", select("class_id", [{ value: "", label: "— Tanpa kelas —" }, ...classes.map((cl) => ({ value: String(cl.id), label: `${cl.name} (${cl.period_name || ""})` }))]))}
      <button class="btn" type="submit">Tambah murid</button>
    </form>
    <form method="post" action="/admin/murid/impor" enctype="multipart/form-data" class="card">
      ${csrfInput(cur.csrf)}
      <p><b>Impor CSV murid</b> — kolom: <code>nis,nama</code>. <a href="/admin/murid/template">Unduh template</a>. Kelas dipilih di bawah, bukan ditebak dari berkas. Bila satu baris tidak valid, seluruh impor dibatalkan.</p>
      ${field("Kelas tujuan", select("class_id", classes.map((cl) => ({ value: String(cl.id), label: `${cl.name} (${cl.period_name || ""})` }))))}
      <div class="field"><span>Berkas CSV</span><input type="file" name="file" accept=".csv,text/csv" required></div>
      <button class="btn" type="submit">Impor murid</button>
    </form>
    ${table(["Nama", "NIS", "Kelas"], students.map((st) => {
      const enr = db().query("SELECT cl.name FROM enrollments e JOIN classes cl ON cl.id = e.class_id WHERE e.student_id = ?").all(st.id) as any[];
      return [esc(st.name), esc(st.student_no || "-"), esc(enr.map((e: any) => e.name).join(", "))];
    }))}${backLink("/admin")}`;
    return page(s, c, cur.user, "Murid", body);
  });

  app.get("/admin/murid/template", (c) => {
    const cur = requireAdmin(s, c);
    if (cur instanceof Response) return cur;
    return new Response("nis,nama\n12345,Ahmad Fauzi\n12346,Siti Rahma\n", { headers: { "Content-Type": "text/csv", "Content-Disposition": 'attachment; filename="murid.csv"' } });
  });

  app.post("/admin/murid", async (c) => {
    const cur = requireAdmin(s, c);
    if (cur instanceof Response) return cur;
    const body = await formOf(c);
    if (!checkCsrf(db(), c, body)) return errPage(s, c, cur.user, "Gagal", "Token keamanan tidak valid.", "/admin");
    try {
      const info: any = db().query("INSERT INTO students (name, student_no) VALUES (?, ?)").run(str(body, "name"), str(body, "student_no") || null);
      if (str(body, "class_id")) db().query("INSERT INTO enrollments (class_id, student_id) VALUES (?, ?)").run(Number(str(body, "class_id")), Number(info.lastInsertRowid));
    } catch {
      return redirectMsg(c, "/admin/murid", "NIS sudah dipakai murid lain.");
    }
    return redirectMsg(c, "/admin/murid", "Murid ditambahkan.");
  });

  app.post("/admin/murid/impor", async (c) => {
    const cur = requireAdmin(s, c);
    if (cur instanceof Response) return cur;
    const body = await formOf(c);
    if (!checkCsrf(db(), c, body)) return errPage(s, c, cur.user, "Gagal", "Token keamanan tidak valid.", "/admin");
    const classId = Number(str(body, "class_id"));
    const files = filesOf(body, "file");
    if (!files.length) return redirectMsg(c, "/admin/murid", "Berkas CSV wajib diunggah.");
    const text = await files[0]!.text();
    const tbl = tableFromCSV(text, ["nis", "nama"]);
    if (tbl.errors.length) return errPage(s, c, cur.user, "Impor dibatalkan", tbl.errors.join(" "), "/admin/murid");
    const val = validateStudentRows(tbl.rows);
    if (val.errors.length) return errPage(s, c, cur.user, "Impor dibatalkan", val.errors.join(" "), "/admin/murid");
    try {
      const res = importStudents(db(), classId, val.data);
      return redirectMsg(c, "/admin/murid", `Impor berhasil: ${res.inserted} murid.`);
    } catch (e: any) {
      return errPage(s, c, cur.user, "Impor dibatalkan", String(e?.message || e), "/admin/murid");
    }
  });

  app.get("/admin/guru", (c) => {
    const cur = requireAdmin(s, c);
    if (cur instanceof Response) return cur;
    const users = db().query("SELECT u.*, ol.student_id FROM users u LEFT JOIN observer_links ol ON ol.user_id = u.id ORDER BY u.role, u.name").all() as any[];
    const students = db().query("SELECT * FROM students ORDER BY name ASC").all() as any[];
    const body = `<form method="post" action="/admin/guru" class="card">
      ${csrfInput(cur.csrf)}
      ${field("Username", input("username", "", "required"))}
      ${field("Nama", input("name", "", "required"))}
      ${field("Kata sandi awal (min. 6)", `<input type="password" name="password" required>`)}
      ${field("Peran", select("role", [{ value: "guru", label: "Guru" }, { value: "admin", label: "Admin" }, { value: "pengamat", label: "Pengamat" }]))}
      ${field("Pengamat kepala sekolah (can_view_all)", select("can_view_all", [{ value: "0", label: "Tidak" }, { value: "1", label: "Ya — kepala sekolah" }]))}
      ${field("Terikat ke murid (untuk akun pengamat murid/ortu)", select("student_id", [{ value: "", label: "— Tidak terikat —" }, ...students.map((st) => ({ value: String(st.id), label: `${st.name} (${st.student_no || "-"})` }))]))}
      <button class="btn" type="submit">Tambah pengguna</button>
    </form>
    <form method="post" action="/admin/guru/impor" enctype="multipart/form-data" class="card">
      ${csrfInput(cur.csrf)}
      <p><b>Impor CSV guru</b> — kolom: <code>username,nama,password_awal</code>. <a href="/admin/guru/template">Unduh template</a>. Bila password_awal kosong, isi kata sandi batch di bawah. Semua akun impor wajib ganti kata sandi saat login pertama.</p>
      ${field("Kata sandi batch (bila ada baris tanpa password_awal)", `<input type="password" name="batch_password">`)}
      <div class="field"><span>Berkas CSV</span><input type="file" name="file" accept=".csv,text/csv" required></div>
      <button class="btn" type="submit">Impor guru</button>
    </form>
    <form method="post" action="/admin/guru/pengamat-murid" class="card">
      ${csrfInput(cur.csrf)}
      <p><b>Buat akun pengamat murid/orang tua</b> — username otomatis = NIS murid, tetap memakai kata sandi.</p>
      ${field("Murid", select("student_id", students.filter((st: any) => st.student_no).map((st: any) => ({ value: String(st.id), label: `${st.name} (${st.student_no})` }))))}
      ${field("Kata sandi awal (min. 6)", `<input type="password" name="password" required>`)}
      <button class="btn" type="submit">Buat akun pengamat</button>
    </form>
    <form method="post" action="/admin/guru/reset" class="card">
      ${csrfInput(cur.csrf)}
      <p><b>Reset kata sandi pengguna</b> — untuk pengguna yang lupa kata sandinya. Semua sesi pengguna itu akan dicabut, ia harus login dengan kata sandi baru lalu menggantinya sendiri. Reset akun sendiri tidak diizinkan; gunakan Ganti Kata Sandi untuk akun sendiri. Aksi reset dicatat di audit log tanpa mencatat kata sandinya.</p>
      ${field("Pengguna", select("user_id", users.filter((u: any) => u.id !== cur.user.id).map((u: any) => ({ value: String(u.id), label: `${u.username} — ${u.name} (${u.role})` }))))}
      ${field("Kata sandi baru (min. 6)", `<input type="password" name="password" required>`)}
      <button class="btn" type="submit">Reset kata sandi</button>
    </form>
    ${table(["Username", "Nama", "Peran", "Kepsek?", "Terikat murid"], users.map((u) => [esc(u.username), esc(u.name), esc(u.role), u.can_view_all ? "Ya" : "Tidak", u.student_id ? String(u.student_id) : "-"]))}${backLink("/admin")}`;
    return page(s, c, cur.user, "Guru & Akun", body);
  });

  app.get("/admin/guru/template", (c) => {
    const cur = requireAdmin(s, c);
    if (cur instanceof Response) return cur;
    return new Response("username,nama,password_awal\nbudi, Budi Santoso,\nsari, Sari Dewi,\n", { headers: { "Content-Type": "text/csv", "Content-Disposition": 'attachment; filename="guru.csv"' } });
  });

  app.post("/admin/guru", async (c) => {
    const cur = requireAdmin(s, c);
    if (cur instanceof Response) return cur;
    const body = await formOf(c);
    if (!checkCsrf(db(), c, body)) return errPage(s, c, cur.user, "Gagal", "Token keamanan tidak valid.", "/admin");
    const password = strRaw(body, "password");
    if (password.length < 6) return redirectMsg(c, "/admin/guru", "Kata sandi minimal 6 karakter.");
    const role = str(body, "role");
    if (!["guru", "admin", "pengamat"].includes(role)) return redirectMsg(c, "/admin/guru", "Peran tidak valid.");
    try {
      const hash = await Bun.password.hash(password, { algorithm: "argon2id" });
      const info: any = db().query("INSERT INTO users (username, name, password_hash, role, can_view_all, must_change_password) VALUES (?, ?, ?, ?, ?, 1)").run(
        str(body, "username"), str(body, "name"), hash, role, str(body, "can_view_all") === "1" ? 1 : 0,
      );
      if (str(body, "student_id")) db().query("INSERT INTO observer_links (user_id, student_id) VALUES (?, ?)").run(Number(info.lastInsertRowid), Number(str(body, "student_id")));
    } catch {
      return redirectMsg(c, "/admin/guru", "Username sudah dipakai atau murid sudah terikat akun lain.");
    }
    return redirectMsg(c, "/admin/guru", "Pengguna ditambahkan (wajib ganti kata sandi saat login pertama).");
  });

  app.post("/admin/guru/impor", async (c) => {
    const cur = requireAdmin(s, c);
    if (cur instanceof Response) return cur;
    const body = await formOf(c);
    if (!checkCsrf(db(), c, body)) return errPage(s, c, cur.user, "Gagal", "Token keamanan tidak valid.", "/admin");
    const files = filesOf(body, "file");
    if (!files.length) return redirectMsg(c, "/admin/guru", "Berkas CSV wajib diunggah.");
    const text = await files[0]!.text();
    const tbl = tableFromCSV(text, ["username", "nama", "password_awal"]);
    if (tbl.errors.length) return errPage(s, c, cur.user, "Impor dibatalkan", tbl.errors.join(" "), "/admin/guru");
    const val = validateTeacherRows(tbl.rows);
    if (val.errors.length) return errPage(s, c, cur.user, "Impor dibatalkan", val.errors.join(" "), "/admin/guru");
    try {
      // Argon2id bersifat async, jadi hash dibuat per baris SEBELUM transaksi impor.
      const withHash: { username: string; nama: string; password_hash: string }[] = [];
      for (const r of val.data) {
        const pw = r.password_awal || strRaw(body, "batch_password");
        if (!pw) throw new Error(`Kata sandi awal kosong untuk ${r.username} dan tidak ada kata sandi batch.`);
        withHash.push({ username: r.username, nama: r.nama, password_hash: await Bun.password.hash(pw, { algorithm: "argon2id" }) });
      }
      const res = importTeachers(db(), withHash);
      return redirectMsg(c, "/admin/guru", `Impor berhasil: ${res.inserted} guru.`);
    } catch (e: any) {
      return errPage(s, c, cur.user, "Impor dibatalkan", String(e?.message || e), "/admin/guru");
    }
  });

  app.post("/admin/guru/pengamat-murid", async (c) => {
    const cur = requireAdmin(s, c);
    if (cur instanceof Response) return cur;
    const body = await formOf(c);
    if (!checkCsrf(db(), c, body)) return errPage(s, c, cur.user, "Gagal", "Token keamanan tidak valid.", "/admin");
    const studentId = Number(str(body, "student_id"));
    const password = strRaw(body, "password");
    const st = db().query("SELECT * FROM students WHERE id = ?").get(studentId) as any;
    if (!st || !st.student_no) return redirectMsg(c, "/admin/guru", "Murid harus memiliki NIS untuk dibuatkan akun pengamat.");
    if (password.length < 6) return redirectMsg(c, "/admin/guru", "Kata sandi minimal 6 karakter.");
    try {
      const hash = await Bun.password.hash(password, { algorithm: "argon2id" });
      const info: any = db().query("INSERT INTO users (username, name, password_hash, role, must_change_password) VALUES (?, ?, ?, 'pengamat', 1)").run(st.student_no, `Orang tua/wali ${st.name}`, hash);
      db().query("INSERT INTO observer_links (user_id, student_id) VALUES (?, ?)").run(Number(info.lastInsertRowid), studentId);
    } catch {
      return redirectMsg(c, "/admin/guru", "NIS sudah dipakai sebagai username atau murid sudah terikat akun lain.");
    }
    return redirectMsg(c, "/admin/guru", `Akun pengamat dibuat dengan username = NIS ${st.student_no}.`);
  });

  app.post("/admin/guru/reset", async (c) => {
    const cur = requireAdmin(s, c);
    if (cur instanceof Response) return cur;
    const body = await formOf(c);
    if (!checkCsrf(db(), c, body)) return errPage(s, c, cur.user, "Gagal", "Token keamanan tidak valid.", "/admin");
    const targetId = Number(str(body, "user_id"));
    const password = strRaw(body, "password");
    if (!targetId) return redirectMsg(c, "/admin/guru", "Pengguna tidak ditemukan.");
    if (targetId === cur.user.id) return redirectMsg(c, "/admin/guru", "Reset kata sandi akun sendiri tidak diizinkan; gunakan Ganti Kata Sandi.");
    if (password.length < 6) return redirectMsg(c, "/admin/guru", "Kata sandi minimal 6 karakter.");
    const target = db().query("SELECT * FROM users WHERE id = ?").get(targetId) as any;
    if (!target) return redirectMsg(c, "/admin/guru", "Pengguna tidak ditemukan.");
    const hash = await Bun.password.hash(password, { algorithm: "argon2id" });
    db().query("UPDATE users SET password_hash = ?, must_change_password = 1 WHERE id = ?").run(hash, targetId);
    db().query("DELETE FROM user_sessions WHERE user_id = ?").run(targetId);
    audit(db(), cur.user.id, "password.reset", "users", targetId, {});
    return redirectMsg(c, "/admin/guru", `Kata sandi ${target.username} berhasil di-reset; semua sesinya dicabut dan ia wajib mengganti kata sandi saat login pertama.`);
  });

  app.get("/admin/kelompok", (c) => {
    const cur = requireAdmin(s, c);
    if (cur instanceof Response) return cur;
    const classes = db().query("SELECT cl.*, p.name AS period_name FROM classes cl LEFT JOIN periods p ON p.id = cl.period_id ORDER BY cl.id DESC").all() as any[];
    const selectedClass = Number(c.req.query("kelas") || 0);
    const students = selectedClass ? classStudents(db(), selectedClass) : [];
    const groups = selectedClass ? classGroups(db(), selectedClass) : [];
    const body = `<form method="get" action="/admin/kelompok" class="card">
      ${field("Pilih kelas", select("kelas", classes.map((cl) => ({ value: String(cl.id), label: `${cl.name} (${cl.period_name || ""})`, selected: cl.id === selectedClass }))))}
      <button class="btn" type="submit">Tampilkan</button>
    </form>
    ${selectedClass ? `<form method="post" action="/admin/kelompok" class="card">
      ${csrfInput(cur.csrf)}
      <input type="hidden" name="class_id" value="${selectedClass}">
      ${field("Nama kelompok (bebas)", input("name", "", "required"))}
      <p>Pilih anggota lewat ceklis (satu murid hanya satu kelompok per kelas):</p>
      ${students.map((st) => `<label class="check"><input type="checkbox" name="student_ids" value="${st.id}"> ${esc(st.name)} (${esc(st.student_no || "-")})</label>`).join("")}
      <button class="btn" type="submit">Bentuk kelompok</button>
    </form>
    <form method="post" action="/admin/kelompok/impor" enctype="multipart/form-data" class="card">
      ${csrfInput(cur.csrf)}
      <input type="hidden" name="class_id" value="${selectedClass}">
      <p><b>Impor CSV kelompok</b> — kolom: <code>nama_kelompok,nis</code>. <a href="/admin/kelompok/template">Unduh template</a>. Bila satu baris tidak valid, seluruh impor dibatalkan.</p>
      <div class="field"><span>Berkas CSV</span><input type="file" name="file" accept=".csv,text/csv" required></div>
      <button class="btn" type="submit">Impor kelompok</button>
    </form>
    ${table(["Kelompok", "Anggota"], groups.map((g) => {
      const members = db().query("SELECT s.name FROM group_members gm JOIN students s ON s.id = gm.student_id WHERE gm.group_id = ? ORDER BY s.name ASC").all(g.id) as any[];
      return [esc(g.name), esc(members.map((m: any) => m.name).join(", "))];
    }))}` : ""}
    ${backLink("/admin")}`;
    return page(s, c, cur.user, "Kelompok", body);
  });

  app.get("/admin/kelompok/template", (c) => {
    const cur = requireAdmin(s, c);
    if (cur instanceof Response) return cur;
    return new Response("nama_kelompok,nis\nKelompok 1,12345\nKelompok 1,12346\n", { headers: { "Content-Type": "text/csv", "Content-Disposition": 'attachment; filename="kelompok.csv"' } });
  });

  app.post("/admin/kelompok", async (c) => {
    const cur = requireAdmin(s, c);
    if (cur instanceof Response) return cur;
    const body = await formOf(c);
    if (!checkCsrf(db(), c, body)) return errPage(s, c, cur.user, "Gagal", "Token keamanan tidak valid.", "/admin");
    const classId = Number(str(body, "class_id"));
    const name = str(body, "name");
    const rawIds = body["student_ids"];
    const ids = (Array.isArray(rawIds) ? rawIds : rawIds ? [rawIds] : []).map((x) => Number(x)).filter((n) => Number.isFinite(n));
    if (!classId || !name || !ids.length) return redirectMsg(c, `/admin/kelompok?kelas=${classId}`, "Nama kelompok dan minimal satu anggota wajib diisi.");
    try {
      db().transaction(() => {
        for (const sid of ids) {
          const enr = db().query("SELECT 1 FROM enrollments WHERE class_id = ? AND student_id = ?").get(classId, sid) as any;
          if (!enr) throw new Error("Salah satu murid bukan anggota kelas ini.");
          const already = db().query("SELECT g.name FROM group_members gm JOIN groups g ON g.id = gm.group_id WHERE g.class_id = ? AND gm.student_id = ?").get(classId, sid) as any;
          if (already) throw new Error(`Murid sudah berada di kelompok "${already.name}" pada kelas ini.`);
        }
        const info: any = db().query("INSERT INTO groups (class_id, name) VALUES (?, ?)").run(classId, name);
        const gid = Number(info.lastInsertRowid);
        for (const sid of ids) db().query("INSERT INTO group_members (group_id, student_id) VALUES (?, ?)").run(gid, sid);
      })();
    } catch (e: any) {
      return errPage(s, c, cur.user, "Gagal membentuk kelompok", String(e?.message || e), `/admin/kelompok?kelas=${classId}`);
    }
    return redirectMsg(c, `/admin/kelompok?kelas=${classId}`, "Kelompok dibentuk.");
  });

  app.post("/admin/kelompok/impor", async (c) => {
    const cur = requireAdmin(s, c);
    if (cur instanceof Response) return cur;
    const body = await formOf(c);
    if (!checkCsrf(db(), c, body)) return errPage(s, c, cur.user, "Gagal", "Token keamanan tidak valid.", "/admin");
    const classId = Number(str(body, "class_id"));
    const files = filesOf(body, "file");
    if (!files.length) return redirectMsg(c, `/admin/kelompok?kelas=${classId}`, "Berkas CSV wajib diunggah.");
    const text = await files[0]!.text();
    const tbl = tableFromCSV(text, ["nama_kelompok", "nis"]);
    if (tbl.errors.length) return errPage(s, c, cur.user, "Impor dibatalkan", tbl.errors.join(" "), `/admin/kelompok?kelas=${classId}`);
    const val = validateGroupRows(tbl.rows);
    if (val.errors.length) return errPage(s, c, cur.user, "Impor dibatalkan", val.errors.join(" "), `/admin/kelompok?kelas=${classId}`);
    try {
      const res = importGroups(db(), classId, val.data);
      return redirectMsg(c, `/admin/kelompok?kelas=${classId}`, `Impor berhasil: ${res.groups} kelompok, ${res.members} anggota.`);
    } catch (e: any) {
      return errPage(s, c, cur.user, "Impor dibatalkan", String(e?.message || e), `/admin/kelompok?kelas=${classId}`);
    }
  });

  app.get("/admin/templat", (c) => {
    const cur = requireAdmin(s, c);
    if (cur instanceof Response) return cur;
    const instruments = db().query("SELECT * FROM instruments WHERE is_template = 1 ORDER BY title ASC").all() as any[];
    const frameworks = db().query("SELECT * FROM frameworks WHERE is_template = 1 ORDER BY title ASC").all() as any[];
    const body = `<p>Templat bawaan dikelola admin. Guru menyalin templat lalu memberi judul sendiri.</p>
      <h2>Instrumen bawaan</h2>
      ${table(["Judul", "Jenis", "Aksi"], instruments.map((i) => [esc(i.title), esc(i.kind), `<a href="/instrumen/${i.id}/edit">Edit templat</a>`]))}
      <h2>Kerangka bawaan</h2>
      ${table(["Judul", "Aksi"], frameworks.map((f) => [esc(f.title), `<a href="/kerangka/${f.id}">Kelola tujuan</a>`]))}
      ${backLink("/admin")}`;
    return page(s, c, cur.user, "Templat Bawaan", body);
  });

  // ---------- Backup / restore ----------
  app.get("/admin/backup", (c) => {
    const cur = requireAdmin(s, c);
    if (cur instanceof Response) return cur;
    const body = `<div class="card">
      <p><a class="btn" href="/admin/backup/download">Unduh backup (database + bukti)</a></p>
      <p class="muted">Backup dibuat dari salinan database yang konsisten saat WAL aktif (VACUUM INTO) plus folder bukti, dalam satu arsip .tar.gz.</p>
    </div>
    <form method="post" action="/admin/backup/restore" enctype="multipart/form-data" class="card" onsubmit="return confirm('Restore akan MENGGANTI seluruh data dan membersihkan semua sesi login. Lanjutkan?')">
      ${csrfInput(cur.csrf)}
      <div class="field"><span>Arsip backup (.tar.gz dari aplikasi ini)</span><input type="file" name="file" accept=".tar.gz,.tgz" required></div>
      <label class="check"><input type="checkbox" name="confirm" value="1" required> Saya paham restore mengganti seluruh data.</label>
      <button class="btn danger" type="submit">Restore</button>
    </form>
    <h2>Log aktivitas terakhir</h2>
    ${table(["Waktu", "Pengguna", "Aksi", "Entitas"], (db().query("SELECT a.*, u.username FROM audit_logs a LEFT JOIN users u ON u.id = a.user_id ORDER BY a.id DESC LIMIT 50").all() as any[]).map((a) => [esc(a.created_at), esc(a.username || "-"), esc(a.action), esc(`${a.entity || ""} ${a.entity_id || ""}`)]))}
    ${backLink("/admin")}`;
    return page(s, c, cur.user, "Backup & Restore", body);
  });

  app.get("/admin/backup/download", async (c) => {
    const cur = requireAdmin(s, c);
    if (cur instanceof Response) return cur;
    const tmp = `/tmp/gezyasko-backup-${Date.now()}`;
    const { mkdirSync, rmSync } = await import("node:fs");
    mkdirSync(tmp, { recursive: true });
    const dbFile = join(tmp, "gezyasko.db");
    // VACUUM INTO menghasilkan salinan yang konsisten walau WAL aktif.
    db().query("VACUUM INTO ?").run(dbFile);
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const archive = `/tmp/gezyasko-backup-${stamp}.tar.gz`;
    const proc = Bun.spawnSync(["tar", "-czf", archive, "-C", tmp, "gezyasko.db", "-C", s.dataDir, "bukti"], { stdout: "pipe", stderr: "pipe" });
    rmSync(tmp, { recursive: true, force: true });
    if (proc.exitCode !== 0) {
      return errPage(s, c, cur.user, "Backup gagal", "Perintah tar gagal di server.", "/admin/backup");
    }
    const buf = await Bun.file(archive).arrayBuffer();
    try { rmSync(archive, { force: true }); } catch { /* abaikan */ }
    return new Response(buf, { headers: { "Content-Type": "application/gzip", "Content-Disposition": `attachment; filename="gezyasko-backup-${stamp}.tar.gz"` } });
  });

  app.post("/admin/backup/restore", async (c) => {
    const cur = requireAdmin(s, c);
    if (cur instanceof Response) return cur;
    const body = await formOf(c);
    if (!checkCsrf(db(), c, body)) return errPage(s, c, cur.user, "Gagal", "Token keamanan tidak valid.", "/admin/backup");
    if (str(body, "confirm") !== "1") return redirectMsg(c, "/admin/backup", "Konfirmasi restore wajib dicentang.");
    const files = filesOf(body, "file");
    if (!files.length) return redirectMsg(c, "/admin/backup", "Arsip backup wajib diunggah.");
    const { mkdirSync, rmSync, existsSync, readdirSync } = await import("node:fs");
    const tmp = `/tmp/gezyasko-restore-${Date.now()}`;
    mkdirSync(tmp, { recursive: true });
    const archive = join(tmp, "backup.tar.gz");
    await Bun.write(archive, Buffer.from(await files[0]!.arrayBuffer()));
    const listProc = Bun.spawnSync(["tar", "-tzf", archive], { stdout: "pipe", stderr: "pipe" });
    const listing = new TextDecoder().decode(listProc.stdout);
    if (!listing.split("\n").some((l) => l.trim() === "gezyasko.db" || l.trim() === "./gezyasko.db")) {
      rmSync(tmp, { recursive: true, force: true });
      return errPage(s, c, cur.user, "Restore gagal", "Arsip tidak berisi gezyasko.db.", "/admin/backup");
    }
    const extProc = Bun.spawnSync(["tar", "-xzf", archive, "-C", tmp], { stdout: "pipe", stderr: "pipe" });
    if (extProc.exitCode !== 0) {
      rmSync(tmp, { recursive: true, force: true });
      return errPage(s, c, cur.user, "Restore gagal", "Arsip tidak bisa diekstrak.", "/admin/backup");
    }
    const restoredDb = join(tmp, "gezyasko.db");
    if (!existsSync(restoredDb)) {
      rmSync(tmp, { recursive: true, force: true });
      return errPage(s, c, cur.user, "Restore gagal", "gezyasko.db tidak ditemukan setelah ekstrak.", "/admin/backup");
    }
    // Validasi ringan: buka salinan read-only dan pastikan tabel users ada.
    try {
      const check = new (await import("bun:sqlite")).Database(restoredDb, { readonly: true });
      check.query("SELECT 1 FROM users LIMIT 1").get();
      check.close();
    } catch {
      rmSync(tmp, { recursive: true, force: true });
      return errPage(s, c, cur.user, "Restore gagal", "Berkas database tidak valid.", "/admin/backup");
    }
    // Ganti database live: tutup, salin, buka ulang, bersihkan semua sesi.
    const livePath = join(s.dataDir, "gezyasko.db");
    try { db().close(); } catch { /* abaikan */ }
    const { copyFileSync } = await import("node:fs");
    copyFileSync(restoredDb, livePath);
    // Ganti folder bukti bila ada di arsip
    const buktiTmp = join(tmp, "bukti");
    if (existsSync(buktiTmp)) {
      const buktiLive = join(s.dataDir, "bukti");
      rmSync(buktiLive, { recursive: true, force: true });
      mkdirSync(buktiLive, { recursive: true });
      for (const f of readdirSync(buktiTmp)) copyFileSync(join(buktiTmp, f), join(buktiLive, f));
    }
    rmSync(tmp, { recursive: true, force: true });
    // Buka ulang database dan bersihkan sesi — app.ts membaca s.db setiap request,
    // jadi cukup ganti referensinya di sini.
    const { openDb } = await import("./db");
    (s as any).db = openDb(livePath);
    (s as any).db.query("DELETE FROM user_sessions").run();
    logoutSession((s as any).db, c);
    return c.redirect("/login?msg=" + encodeURIComponent("Restore berhasil. Silakan masuk kembali dengan kata sandi dari backup."));
  });
}
