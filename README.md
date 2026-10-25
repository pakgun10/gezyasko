# GezyAsko — Aplikasi Asesmen Observasi

Aplikasi asesmen observasi (bukan CBT) untuk TK–SMK, satu instalasi
untuk satu sekolah. Rencana lengkap ada di dokumen
`implementation_plan.md` di root repo.

Live: https://asko.gezytech.web.id/

## Fitur utama

- Login admin, guru, dan pengamat (kepala sekolah bisa membaca semua
  rekap; murid/orang tua memakai NIS sebagai username, tetap dengan
  kata sandi, dan hanya melihat laporan muridnya).
- Kelas, murid, kelompok permanen per kelas, dan impor CSV
  transaksional (murid, guru, kelompok).
- Instrumen bebas (judul, jenis, dan level ditentukan pembuatnya),
  kerangka tujuan, dan snapshot instrumen saat sesi dibuat — mengubah
  instrumen belakangan tidak mengubah sesi lama.
- Catat cepat per murid/kelompok, bukti foto (maks. 5 foto per
  observasi, maks. 5 MB per berkas) dan URL video, catatan individu
  per anggota kelompok.
- Rekap per murid, per kelas, dan per instrumen — selalu menampilkan
  skor level dan skor 0–100 berdampingan — narasi otomatis yang bisa
  diedit guru, dan laporan cetak HTML/PDF.
- Backup dan restore dari halaman admin; restore mengganti database
  dan folder bukti serta membersihkan semua sesi login.
- Admin dapat mereset kata sandi pengguna lain (tidak bisa mereset
  akunnya sendiri); akun yang direset wajib ganti kata sandi saat
  login berikutnya dan semua sesinya dicabut.
- Footer dua baris rata tengah (disembunyikan saat cetak):
  "© 2026 GezyTech App · Dikembangkan oleh PakGun" dan
  "Aplikasi Asesmen Kurikuler".

## Rubrik pola Aspro

Khusus tipe input rubrik, GezyAsko memakai pola Aspro: penilai
mengklik tombol tingkat, lalu mengetik bilangan bulat yang paling
mendekati di dalam rentang tingkat itu. Dua datum dikirim sekaligus
ke database: posisi tingkat yang diklik dan nilai bulat yang diketik.

Level rubrik didefinisikan di JSON level instrumen dengan rentang
dan nilai awal, misalnya:

```json
[
  {"v": 1, "label": "Kurang kompak", "min": 0, "max": 64, "def": 50},
  {"v": 2, "label": "Cukup kompak", "min": 65, "max": 77, "def": 71},
  {"v": 3, "label": "Kompak", "min": 78, "max": 89, "def": 84},
  {"v": 4, "label": "Sangat kompak", "min": 90, "max": 100, "def": 95}
]
```

Aturannya: bila satu level memakai rentang, semua level wajib
memakai rentang dan nilai awal (`min <= def <= max`); klik tombol
mengisi kolom angka dengan nilai awal level itu; nilai yang diketik
wajib bilangan bulat di dalam rentang level yang diklik (kosong =
nilai awal); rekap menghitung dari nilai bulatnya, sedangkan label,
deskriptor, dan narasi diambil dari posisi tingkat yang diklik.
Tipe skala, checklist, dan teks tidak memakai pola ini, dan
instrumen lama yang levelnya belum punya rentang tetap berjalan
dengan aturan lama (nilai = nilai level).

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
- `src/routes.ts` — semua route (auth, dasbor, kelas, sesi,
  catat cepat, instrumen, kerangka, profil, rekap, cetak, bukti,
  admin, backup).
- `src/db.ts` — skema, migrasi ringan, seed templat, snapshot
  instrumen dan level, audit.
- `src/auth.ts` — sesi login (tabel terpisah dari sesi observasi)
  dan cek hak (RBAC).
- `src/recap.ts` — pengambilan data profil/rekap.
- `src/lib/scores.ts` — SATU-SATUNYA tempat rumus skor (jangan
  menduplikasi rumus di route); termasuk definisi level rubrik
  rentang dan penyebut skala rekap.
- `src/lib/validate.ts` — validasi nilai per input_type, termasuk
  penyelesaian skor rubrik pola Aspro (posisi + nilai bulat).
- `src/lib/csv.ts` + `src/lib/imports.ts` — parser dan impor CSV
  transaksional.
- `src/lib/narrative.ts` — generator narasi.
- `src/lib/evidence.ts` — aturan bukti foto/video.
- `public/` — CSS buatan sendiri, JS catat cepat (termasuk pengisi
  otomatis nilai awal rubrik) dan kompresi foto, serta htmx yang
  di-vendor lokal (bukan CDN).
- `tests/` — pengujian `bun test`, termasuk `tests/rubric.test.ts`
  untuk rubrik pola Aspro.
- `deploy/` — contoh systemd, skrip backup, dan panduan deploy.
- `templates-impor/` — contoh CSV murid, guru, kelompok.

## Yang TIDAK ada (fase berikutnya)

Antrean offline IndexedDB dan `/api/sync`, service worker, ekspor
Word, unggah berkas video, dan akun orang tua terpisah dari akun
murid. Saat ini, video hanya berupa URL https yang ditempel guru.
