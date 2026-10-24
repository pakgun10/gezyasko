# GezyAsko — Aplikasi (MVP Fase 0–4)

Aplikasi asesmen observasi (bukan CBT) untuk TK–SMK, satu instalasi
untuk satu sekolah. Rencana lengkap ada di dokumen
`implementation_plan.md` di repo (bukan di folder aplikasi ini).

## Menjalankan lokal

```sh
bun install
SEED_ADMIN_PASSWORD='<kata-sandi-uji>' DATA_DIR=./data PORT=3000 bun run src/index.ts
```

Buka `http://localhost:3000`, masuk dengan akun `admin` dan kata sandi
yang diberikan lewat `SEED_ADMIN_PASSWORD` saat pertama kali
menjalankan. Bila variabel itu tidak diisi, aplikasi membuat kata
sandi acak yang hanya tampil sekali di log — segera ganti setelah
login pertama.

> Jangan menulis kata sandi nyata di repo, laporan, atau chat.
> Akun seed hanya untuk pengujian lokal; di deploy production, akun
> admin awal wajib diganti kata sandinya.

Perintah lain:

```sh
bun test            # seluruh pengujian
bun run src/index.ts  # server (PORT dan DATA_DIR lewat env)
```

## Struktur

- `src/index.ts` — entrypoint server.
- `src/app.ts` — pembuatan aplikasi Hono + aset statis lokal.
- `src/routes.ts` — semua route MVP (auth, dasbor, kelas, sesi,
  catat cepat, instrumen, kerangka, profil, rekap, cetak, bukti,
  admin, backup).
- `src/db.ts` — skema, seed templat, snapshot instrumen, audit.
- `src/auth.ts` — sesi login (tabel terpisah dari sesi observasi)
  dan cek hak (RBAC).
- `src/recap.ts` — pengambilan data profil/rekap.
- `src/lib/scores.ts` — SATU-SATUNYA tempat rumus skor (jangan
  menduplikasi rumus di route).
- `src/lib/validate.ts` — validasi nilai per input_type.
- `src/lib/csv.ts` + `src/lib/imports.ts` — parser dan impor CSV
  transaksional.
- `src/lib/narrative.ts` — generator narasi.
- `src/lib/evidence.ts` — aturan bukti foto/video.
- `public/` — CSS buatan sendiri, JS catat cepat dan kompresi foto,
  serta htmx yang di-vendor lokal (bukan CDN).
- `tests/` — pengujian `bun test`.
- `deploy/` — contoh systemd, skrip backup, dan panduan deploy.
- `templates-impor/` — contoh CSV murid, guru, kelompok.

## Yang TIDAK ada di MVP (fase berikutnya)

Antrean offline IndexedDB dan `/api/sync`, service worker, ekspor
Word, unggah berkas video, dan akun orang tua terpisah dari akun
murid. Di MVP, video hanya berupa URL https yang ditempel guru.
