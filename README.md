# GezyAsko

Aplikasi asesmen observasi untuk guru: guru mengobservasi murid secara
langsung saat mereka unjuk kerja (individu atau berkelompok) atau atas
hasil karya mereka, lalu mencatat hasilnya, melihat perkembangan murid,
dan mencetak laporannya.

> **Status: tahap perencanaan.** Repo ini baru berisi
> [`implementation_plan.md`](implementation_plan.md). Belum ada kode
> aplikasi, sehingga aplikasi belum bisa dijalankan atau di-deploy.
> Pembangunan mengikuti rencana di dokumen tersebut dan dimulai atas
> perintah terpisah.

## Bukan CBT

GezyAsko bukan Computer Based Test. Murid tidak mengerjakan soal di
aplikasi ini. Yang bekerja di aplikasi adalah guru (dan pengamat yang
membaca laporan): memilih kelas dan instrumen, mengetuk level capaian
per kriteria, menulis catatan singkat, dan melampirkan bukti foto bila
ada.

## Untuk siapa

Aplikasi generik sejak MVP untuk TK sampai SMK, satu instalasi untuk
satu sekolah. Nama sekolah, jenjang, dan tingkat ditulis sendiri oleh
admin di pengaturan — tidak ada daftar jenjang yang dikunci, dan tidak
ada berbagi data antar sekolah.

## Fitur MVP (sesuai rencana)

- **Dasbor guru:** kelas yang diampu dan murid/kelompok yang belum
  diamati.
- **Catat cepat (mobile-first, online di MVP):** grid murid atau
  kelompok, ketuk level per kriteria, catatan opsional, foto opsional.
  Target sekitar 10 detik per murid atau per kelompok.
- **Instrumen:** rubrik, checklist, skala, anekdotal, dan gabungan.
  Level bisa diedit, deskriptor per level, bobot per kriteria, dan
  tautan kriteria ke tujuan/kerangka (opsional).
- **Kelompok permanen per kelas:** dibentuk dari data murid kelas
  (dipilih lewat ceklis, bukan ketik bebas). Satu nilai kelompok
  berlaku sama untuk semua anggota, ditambah catatan individu opsional
  per anggota.
- **Profil murid dan rekap kelas:** perkembangan per kriteria dan per
  tujuan, grafik tren SVG, daftar yang belum diamati, dan peringkat
  hanya di rekap kelas (bukan di laporan murid).
- **Rekap selalu ada angka:** skor level dan skor 0–100 ditampilkan
  berdampingan, misalnya 3,25 dari 4 sama dengan 81 dari 100. Rumus
  lengkapnya ada di `implementation_plan.md` bagian 6.
- **Narasi dan cetak:** narasi dibuat otomatis dari deskriptor level
  dan catatan guru, bisa diedit guru sebelum cetak, lalu dicetak
  menjadi PDF lewat cetak HTML.
- **Bukti:** foto dikompresi di sisi klien sampai maksimal 5 MB per
  berkas (maksimal 5 foto per observasi). Video di MVP hanya berupa
  URL yang ditempel guru, bukan berkas yang diunggah.
- **Impor CSV:** murid dan guru, dengan validasi ketat dan pembatalan
  penuh bila ada baris yang tidak valid. Nama kelas dan NIS dicocokkan
  persis.
- **Backup dan restore:** database plus folder bukti dalam satu arsip.

## Peran

| Peran | Hak utama |
|---|---|
| `admin` | Kelola guru, kelas, murid, kelompok, periode, instrumen dan templat bawaan, serta backup. |
| `guru` | Buat/gunakan instrumen, lakukan observasi, lihat rekap kelas yang diampu. |
| `pengamat` | Hanya baca laporan. Kepala sekolah membaca semua rekap; akun murid/orang tua hanya membaca laporan murid itu dan kelompoknya. |

Login memakai username dan kata sandi (bukan email). Akun murid/orang
tua memakai NIS sebagai username, dipakai bersama oleh murid dan orang
tuanya, dan tetap memakai kata sandi yang ditetapkan admin.

## Nama asesmen bebas

Tidak ada daftar nama asesmen yang dikunci. Admin dan guru bebas
memberi nama: judul instrumen, nama aktivitas sesi (misalnya "Pidato"
atau "Praktikum"), nama kelompok, nama kelas, dan nama kerangka atau
tujuan. Templat bawaan hanya titik awal: admin boleh mengubah templat
bawaan, guru menyalin templat lalu memberi judul sendiri untuk
salinannya.

## Teknologi (rencana)

- Bun + Hono (termasuk Hono JSX untuk render server) + `bun:sqlite`
  mode WAL: satu proses, satu file database, ringan di VPS.
- HTML dari server + htmx + sedikit JS vanilla + CSS buatan sendiri.
  Tanpa framework SPA dan tanpa pustaka grafik (grafik memakai SVG
  inline).
- Kata sandi memakai `Bun.password` (argon2id); sesi login memakai
  cookie.
- Foto tidak pernah dilayani sebagai file statis publik; selalu lewat
  route ber-auth dengan cek hak atas kelasnya.
- Database dan folder bukti tidak pernah di-commit ke repo.

## Struktur repo (rencana)

```text
gezyasko/
  README.md
  implementation_plan.md
  package.json
  src/            # Hono, auth, rute per modul, rumus skor, narasi, impor CSV
  public/         # CSS dan JS catat cepat + kompresi foto
  tests/          # bun test
  deploy/         # contoh systemd dan skrip backup
  templates-impor/ # contoh murid.csv, guru.csv, kelompok.csv
  data/           # gitignored: database + bukti (di VPS via DATA_DIR)
```

Struktur ini baru terbentuk saat pembangunan Fase 0 dimulai.

## Rencana pembangunan

- **Fase 0 — Fondasi:** skema dan migrasi, auth, pengaturan sekolah,
  CRUD periode/kelas/murid, impor CSV, akun pengamat, templat bawaan,
  backup.
- **Fase 1 — Kerangka dan instrumen:** kerangka/tujuan bersarang,
  pembuat instrumen, snapshot instrumen saat sesi dibuat.
- **Fase 2 — Catat cepat dan bukti:** sesi individu/kelompok, grid
  catat cepat, foto terkompresi, URL video.
- **Fase 3 — Profil, rekap, dan narasi:** profil murid, grafik tren,
  rekap kelas, generator dan editor narasi.
- **Fase 4 — Cetak, backup, dan hardening MVP:** cetak PDF via print,
  backup/restore, audit log perubahan nilai, panduan deploy VPS.

Di luar MVP: antrean offline (IndexedDB + sinkron idempoten), service
worker untuk catat cepat, ekspor Word, dan unggah berkas video bila
nanti diputuskan.

## Rencana selengkapnya

Semua keputusan desain, skema database final, rumus skor, peta route,
aturan impor, keamanan, dan kriteria selesai MVP ada di
[`implementation_plan.md`](implementation_plan.md). Bila ada perbedaan
antara README ini dan dokumen rencana, dokumen rencana yang berlaku.
