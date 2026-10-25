import { describe, test, expect } from "bun:test";
import { readFileSync } from "node:fs";
import { layout, table } from "../src/views";

const admin: any = { id: 1, username: "admin", name: "Admin", role: "admin", active: 1 };

describe("tata letak sidebar + navigasi bawah", () => {
  test("pengguna login mendapat sidebar, bar atas, navigasi bawah, dan tautan aktif", () => {
    const html = layout({ title: "Instrumen", user: admin, schoolName: "SMP Negeri 1 Punggur", body: "<p>x</p>", currentPath: "/instrumen/6/edit" });
    expect(html).toContain('class="sidebar"');
    expect(html).toContain('class="topbar"');
    expect(html).toContain('class="bottomnav"');
    expect(html).toContain('class="sidelink active" href="/instrumen"');
    expect(html).toContain('class="bottomlink active" href="/instrumen"');
    expect(html).toContain("© 2026 GezyTech App · Dikembangkan oleh PakGun");
    expect(html).toContain("Aplikasi Asesmen Kurikuler");
    expect(html).not.toContain("🔔");
  });
  test("dasbor aktif hanya di path /, bukan di halaman lain", () => {
    const html = layout({ title: "Kelas", user: admin, schoolName: "SMP", body: "", currentPath: "/kelas/1" });
    expect(html).not.toContain('class="sidelink active" href="/"');
  });
  test("halaman login tanpa pengguna: tanpa sidebar dan navigasi bawah", () => {
    const html = layout({ title: "Masuk", user: null, schoolName: "SMP", body: "" });
    expect(html).toContain('class="sitehead"');
    expect(html).not.toContain('class="sidebar"');
    expect(html).not.toContain('class="bottomnav"');
  });
  test("tautan CSS dan JS memakai nomor versi yang sama (cache-busting)", () => {
    const html = layout({ title: "Dasbor", user: admin, schoolName: "SMP", body: "", currentPath: "/" });
    const css = html.match(/\/static\/css\/app\.css\?v=([0-9a-f]{8})/);
    expect(css).not.toBeNull();
    expect(html).toContain(`/static/js/catat.js?v=${css![1]}`);
    expect(html).toContain(`/static/js/level-builder.js?v=${css![1]}`);
  });
  test("tabel memakai data-label per kolom untuk kartu HP", () => {
    const html = table(["Judul", "Jenis", "Aksi"], [["Senam", "rubrik", `<a href="/x">Edit</a>`]]);
    expect(html).toContain('<td data-label="Judul">Senam</td>');
    expect(html).toContain('<td data-label="Jenis">rubrik</td>');
    expect(html).toContain('<td data-label="Aksi"><a href="/x">Edit</a></td>');
  });
  test("CSS memuat aturan tabel-jadi-kartu hanya untuk layar kecil", () => {
    const css = readFileSync(new URL("../public/css/app.css", import.meta.url), "utf8");
    expect(css).toContain("@media screen and (max-width:767px)");
    expect(css).toContain(".tablewrap td::before");
    expect(css).toContain("content:attr(data-label)");
  });
  test("pengguna non-admin tidak mendapat tautan Admin", () => {
    const guru: any = { ...admin, role: "guru" };
    const html = layout({ title: "Dasbor", user: guru, schoolName: "SMP", body: "", currentPath: "/" });
    expect(html).not.toContain('href="/admin"');
  });
});
