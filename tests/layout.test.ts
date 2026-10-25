import { describe, test, expect } from "bun:test";
import { layout } from "../src/views";

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
  test("pengguna non-admin tidak mendapat tautan Admin", () => {
    const guru: any = { ...admin, role: "guru" };
    const html = layout({ title: "Dasbor", user: guru, schoolName: "SMP", body: "", currentPath: "/" });
    expect(html).not.toContain('href="/admin"');
  });
});
