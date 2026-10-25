// Template HTML server (string template, tanpa build step).
// Semua nilai dari pengguna di-escape sebelum dirender.

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import type { User } from "./auth";

// Cache-busting: nomor versi dihitung dari isi berkas public/ saat server
// start, jadi setiap deploy yang mengubah CSS/JS otomatis meminta browser
// mengambil berkas baru (URL berbeda), tanpa perlu hard refresh. URL lama
// yang sudah tercache tidak dipakai lagi.
function assetVersion(): string {
  try {
    const h = createHash("sha256");
    for (const f of [
      "../public/css/app.css",
      "../public/js/htmx.min.js",
      "../public/js/catat.js",
      "../public/js/kompres-foto.js",
      "../public/js/level-builder.js",
    ]) {
      h.update(readFileSync(new URL(f, import.meta.url)));
    }
    return h.digest("hex").slice(0, 8);
  } catch {
    return "1";
  }
}
const ASSET_VERSION = assetVersion();

export function esc(s: unknown): string {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function layout(opts: {
  title: string;
  user: User | null;
  schoolName: string;
  body: string;
  msg?: string | null;
  print?: boolean;
  currentPath?: string;
}): string {
  const { title, user, schoolName, body, msg, print, currentPath = "" } = opts;
  const active = (href: string): string => {
    if (!currentPath) return "";
    if (href === "/") return currentPath === "/" ? " active" : "";
    return currentPath === href || currentPath.startsWith(`${href}/`) ? " active" : "";
  };
  const main = `<main class="wrap">
${msg ? `<div class="flash">${esc(msg)}</div>` : ""}
<h1>${esc(title)}</h1>
${body}
</main>
<footer class="foot"><div>© 2026 GezyTech App · Dikembangkan oleh PakGun</div><div>Aplikasi Asesmen Kurikuler</div></footer>`;
  // Tata letak: sidebar di laptop/desktop, bar atas + navigasi bawah
  // di HP/tablet. Tanpa lonceng (tidak ada notifikasi di aplikasi ini).
  // Footer tetap dua baris yang sudah disetujui, disembunyikan saat cetak.
  const app = user
    ? `<div class="app">
  <aside class="sidebar">
    <div class="side-brand"><div class="brand">GezyAsko</div><div class="school">${esc(schoolName)}</div></div>
    <nav class="sidenav">
      <a class="sidelink${active("/")}" href="/">🏠 Dasbor</a>
      <a class="sidelink${active("/instrumen")}" href="/instrumen">📋 Instrumen</a>
      <a class="sidelink${active("/kerangka")}" href="/kerangka">🗂️ Kerangka</a>
      ${user.role === "admin" ? `<a class="sidelink${active("/admin")}" href="/admin">⚙️ Admin</a>` : ""}
    </nav>
    <div class="side-user">
      <div class="side-username"><b>${esc(user.name)}</b><span>${esc(user.role)}</span></div>
      <a href="/ganti-sandi">🔑 Ganti Sandi</a>
      <form method="post" action="/logout"><button class="linkbtn" type="submit">🚪 Keluar</button></form>
    </div>
  </aside>
  <div class="maincol">
    <header class="topbar">
      <div><div class="brand">GezyAsko</div><div class="school">${esc(schoolName)}</div></div>
      <details class="account"><summary>👤 ${esc(user.name)}</summary><div class="account-menu"><a href="/ganti-sandi">Ganti Sandi</a><form method="post" action="/logout"><button class="linkbtn" type="submit">Keluar</button></form></div></details>
    </header>
    ${main}
    <nav class="bottomnav">
      <a class="bottomlink${active("/")}" href="/">🏠<span>Dasbor</span></a>
      <a class="bottomlink${active("/instrumen")}" href="/instrumen">📋<span>Instrumen</span></a>
      <a class="bottomlink${active("/kerangka")}" href="/kerangka">🗂️<span>Kerangka</span></a>
      ${user.role === "admin" ? `<a class="bottomlink${active("/admin")}" href="/admin">⚙️<span>Admin</span></a>` : ""}
    </nav>
  </div>
</div>`
    : `<header class="sitehead${print ? " print-only-head" : ""}"><div class="brand">GezyAsko</div><div class="school">${esc(schoolName)}</div></header>
${main}`;
  return `<!doctype html><html lang="id"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)} — GezyAsko</title>
<link rel="stylesheet" href="/static/css/app.css?v=${ASSET_VERSION}">
<script src="/static/js/htmx.min.js?v=${ASSET_VERSION}" defer></script>
<script src="/static/js/catat.js?v=${ASSET_VERSION}" defer></script>
<script src="/static/js/kompres-foto.js?v=${ASSET_VERSION}" defer></script>
<script src="/static/js/level-builder.js?v=${ASSET_VERSION}" defer></script>
</head><body>
${app}
</body></html>`;
}

export function field(label: string, input: string): string {
  return `<label class="field"><span>${esc(label)}</span>${input}</label>`;
}

export function input(name: string, value = "", extra = ""): string {
  return `<input name="${esc(name)}" value="${esc(value)}" ${extra}>`;
}

export function select(name: string, options: { value: string; label: string; selected?: boolean }[], extra = ""): string {
  const opts = options.map((o) => `<option value="${esc(o.value)}"${o.selected ? " selected" : ""}>${esc(o.label)}</option>`).join("");
  return `<select name="${esc(name)}" ${extra}>${opts}</select>`;
}

export function csrfInput(csrf: string): string {
  return `<input type="hidden" name="_csrf" value="${esc(csrf)}">`;
}

export function table(headers: string[], rows: string[][]): string {
  const th = headers.map((h) => `<th>${esc(h)}</th>`).join("");
  // data-label dipakai CSS kartu di HP: tiap sel menampilkan nama kolomnya.
  const tr = rows.map((r) => `<tr>${r.map((c, i) => `<td data-label="${esc(headers[i] ?? "")}">${c}</td>`).join("")}</tr>`).join("");
  return `<div class="tablewrap"><table><thead><tr>${th}</tr></thead><tbody>${tr}</tbody></table></div>`;
}

export function backLink(href: string, label = "Kembali"): string {
  return `<p><a class="btn secondary" href="${esc(href)}">← ${esc(label)}</a></p>`;
}
