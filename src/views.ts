// Template HTML server (string template, tanpa build step).
// Semua nilai dari pengguna di-escape sebelum dirender.

import type { User } from "./auth";

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
}): string {
  const { title, user, schoolName, body, msg, print } = opts;
  const nav = user
    ? `<nav class="topnav">
        <a href="/">Dasbor</a>
        <a href="/instrumen">Instrumen</a>
        <a href="/kerangka">Kerangka</a>
        ${user.role === "admin" ? `<a href="/admin">Admin</a>` : ""}
        <span class="navuser">${esc(user.name)} (${esc(user.role)})</span>
        <a href="/ganti-sandi">Ganti Sandi</a>
        <form method="post" action="/logout" class="inline"><button class="linkbtn" type="submit">Keluar</button></form>
      </nav>`
    : "";
  return `<!doctype html><html lang="id"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)} — GezyAsko</title>
<link rel="stylesheet" href="/static/css/app.css">
<script src="/static/js/htmx.min.js" defer></script>
<script src="/static/js/catat.js" defer></script>
<script src="/static/js/kompres-foto.js" defer></script>
</head><body>
<header class="sitehead ${print ? "print-only-head" : ""}"><div class="brand">GezyAsko</div><div class="school">${esc(schoolName)}</div></header>
${nav}
<main class="wrap">
${msg ? `<div class="flash">${esc(msg)}</div>` : ""}
<h1>${esc(title)}</h1>
${body}
</main>
<footer class="foot">GezyAsko — Asesmen Observasi (bukan CBT) · Satu instalasi untuk satu sekolah</footer>
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
  const tr = rows.map((r) => `<tr>${r.map((c) => `<td>${c}</td>`).join("")}</tr>`).join("");
  return `<div class="tablewrap"><table><thead><tr>${th}</tr></thead><tbody>${tr}</tbody></table></div>`;
}

export function backLink(href: string, label = "Kembali"): string {
  return `<p><a class="btn secondary" href="${esc(href)}">← ${esc(label)}</a></p>`;
}
