# GezyAsko — Implementation Plan

Aplikasi asesmen observasi (bukan CBT): guru mengobservasi murid secara
langsung saat unjuk kerja atau atas hasil karya, individu atau berkelompok.
Repo: `https://github.com/pakgun10/gezyasko.git` (saat plan ini ditulis,
repo sudah ada tetapi masih kosong, belum ada commit).

Dokumen ini adalah rencana pembangunan. Belum ada kode aplikasi di repo
sampai Pak Gun menyetujui plan ini dan memerintahkan pembangunan.

## 1. Keputusan yang sudah terkunci

Keputusan di bawah ini berasal dari rancangan awal dan jawaban Pak Gun
pada 24 Oktober 2026. Bagian 10 berisi asumsi yang masih boleh dikoreksi.

1. **Single-tenant, satu instalasi = satu sekolah.** Tidak ada
   `school_id`, tidak ada middleware tenant, tidak ada `super_admin`,
   tidak ada berbagi antar sekolah.
2. **Nama sekolah ditulis sendiri oleh admin** di pengaturan. Aplikasi
   generik sejak MVP untuk TK sampai SMK; label jenjang/tingkat adalah
   teks bebas, bukan enum.
3. **Peran hanya tiga:** `admin`, `guru`, `pengamat`.
   - `admin`: kelola guru, kelas, murid, kelompok, periode, instrumen
     dan templat, serta backup.
   - `guru`: buat/gunakan instrumen, lakukan observasi, lihat rekap
     kelas yang diampu.
   - `pengamat`: hanya baca laporan. Ada dua jenis pengamat:
     kepala sekolah (baca semua rekap) dan akun murid/orang tua
     (hanya laporan murid itu dan kelompoknya, lihat poin 4).
4. **Login murid/orang tua memakai NIS sebagai username**, satu akun
   dipakai bersama oleh murid dan orang tuanya. Akun ini terikat ke
   satu murid dan tidak bisa melihat murid lain. Soal kata sandi,
   lihat asumsi A1 di bagian 10.
5. **Kelompok model A, permanen per kelas.** Satu nilai kelompok berlaku
   sama untuk semua anggota, ditambah catatan individu opsional per
   anggota. Kelompok dibentuk dari data murid kelas yang sudah ada
   (dipilih lewat ceklis, bukan ketik bebas), dan berlaku selama kelas
   itu berjalan. Kelas baru pada periode baru berarti kelompok baru.
6. **Rekap selalu menampilkan angka.** Seperti pola Aspro, setiap
   rekap menampilkan skor level dan skor 0–100 berdampingan, bukan
   hanya label kualitatif. Rumus ada di bagian 6.
7. **Bukti MVP: foto saja, plus URL video.** Foto dikompresi di sisi
   klien sampai maksimal 5 MB per berkas. Video tidak diunggah sebagai
   berkas di MVP; guru menempelkan URL video (misalnya YouTube/Drive)
   yang disimpan sebagai tautan.
8. **Offline ditunda ke fase berikutnya.** MVP sepenuhnya online.
   Kolom `client_uuid` tetap disiapkan sejak awal agar antrean offline
   nanti tidak butuh migrasi yang merusak, tetapi endpoint `/api/sync`
   dan IndexedDB tidak dibangun di MVP.
9. **Narasi otomatis, bisa diedit, lalu cetak PDF lewat cetak HTML.**
   Narasi dibuat dari deskriptor level plus catatan guru, bisa diedit
   guru sebelum cetak, dan hasil edit disimpan. Ekspor Word menyusul
   di fase berikutnya.
10. **Login guru memakai username + kata sandi**, bukan email. Akun guru
    bisa dibuat manual oleh admin dan bisa juga diimpor lewat CSV.
11. **Nama asesmen bebas dibuat sendiri oleh admin/guru.** Tidak ada
    daftar nama asesmen yang dikunci. Yang bisa dinamai bebas: judul
    instrumen, nama aktivitas sesi (misalnya "Pidato", "Praktikum"),
    nama kelompok, nama kelas, dan nama kerangka/tujuan. Templat bawaan
    hanya titik awal: admin boleh mengubah templat bawaan, guru menyalin
    templat lalu memberi judul sendiri untuk salinannya.

## 2. Stack dan struktur proyek

- Runtime: Bun. Framework: Hono (termasuk Hono JSX untuk render server).
- Database: `bun:sqlite`, mode WAL, satu proses, satu file database.
- Frontend: HTML dari server + htmx + sedikit JS vanilla + CSS buatan
  sendiri (tanpa Pico.css agar ringan di HP, tanpa framework SPA,
  tanpa pustaka grafik; grafik memakai SVG inline).
- Bukti foto disimpan di folder data di luar repo, misalnya
  `DATA_DIR/bukti/` (nilai default `./data/bukti/`), bukan di dalam
  repo dan bukan folder statis publik.
- Kata sandi memakai `Bun.password` (argon2id). Cookie sesi `HttpOnly`,
  `SameSite=Lax`, `Secure` di produksi.
- Bahasa antarmuka: Indonesia.

Struktur yang diusulkan:

```text
gezyasko/
  implementation_plan.md
  package.json
  src/
    index.ts            # entrypoint Hono, static, error handler
    db.ts               # koneksi sqlite, WAL, busy_timeout, migrasi
    schema.sql          # skema awal (bagian 4)
    auth.ts             # login, sesi, hash, middleware peran
    rbac.ts             # cek hak: admin / guru pengampu / pengamat
    lib/
      scores.ts         # rumus skor (bagian 6), tanpa dependensi HTTP
      narrative.ts      # generator narasi dari deskriptor + catatan
      csv.ts            # parser + validasi impor (transaksional)
      evidence.ts       # nama berkas aman, cek mime/ukuran
    routes/
      auth.ts           # /login, /logout, /ganti-sandi
      dashboard.ts      # /
      classes.ts        # /kelas/:id
      record.ts         # /catat/:sessionId (catat cepat)
      instruments.ts    # /instrumen, /instrumen/:id/edit
      students.ts       # /murid/:id
      recaps.ts         # /rekap/kelas/:id, /rekap/murid/:id/cetak
      admin.ts          # /admin/*, /admin/backup
      evidence.ts       # /bukti/:id (wajib login + cek hak)
  public/
    css/app.css
    js/catat.js         # interaksi grid catat cepat (online, MVP)
    js/kompres-foto.js  # kompresi foto klien ke <= 5 MB
  data/                 # gitignored: database + bukti (di VPS via DATA_DIR)
  tests/                # bun test
  deploy/
    gezyasko.service    # systemd (contoh, disesuaikan VPS Pak Gun)
    backup.sh           # backup database + folder bukti
  templates-impor/
    murid.csv
    guru.csv
    kelompok.csv
```

## 3. Peran dan hak (matriks)

| Rute / aksi | admin | guru | pengamat kepsek | pengamat murid/ortu |
|---|:---:|:---:|:---:|:---:|
| Kelola guru, kelas, murid, kelompok, periode | Ya | Tidak | Tidak | Tidak |
| Kelola templat bawaan | Ya | Tidak | Tidak | Tidak |
| Buat/edit instrumen sendiri | Ya | Ya | Tidak | Tidak |
| Salin dari templat | Ya | Ya | Tidak | Tidak |
| Buat sesi dan observasi | Ya* | Ya, hanya kelas yang diampu | Tidak | Tidak |
| Lihat rekap kelas | Ya | Hanya kelas yang diampu | Ya, semua | Tidak |
| Lihat profil dan laporan murid | Ya | Hanya murid kelas yang diampu | Ya, semua | Ya, hanya muridnya + kelompoknya |
| Cetak laporan murid | Ya | Ya, kelas yang diampu | Ya | Ya, hanya muridnya |
| Backup / restore | Ya | Tidak | Tidak | Tidak |

\* Admin boleh membuat sesi darurat, tetapi alur normalnya adalah guru
pengampu. Aturan ini ditegakkan di server, bukan hanya disembunyikan
di tombol antarmuka.

Akun pengamat murid/orang tua:

- `users.username` = NIS murid, `users.role` = `pengamat`.
- `observer_links(user_id, student_id)` mengikat satu akun ke satu murid.
- Akun kepala sekolah adalah `pengamat` tanpa baris di `observer_links`
  dan dengan flag `can_view_all = 1`.
- Murid tanpa NIS tidak bisa dibuatkan akun pengamat.

## 4. Skema database (final, sudah dikoreksi dari rancangan awal)

Perubahan penting dari rancangan awal: email dihapus (login pakai
username), tabel sesi login dipisah dari sesi observasi, `class_teachers`
memakai kunci pengganti agar satu guru bisa memegang dua label di kelas
yang sama, instrumen memakai snapshot per sesi, kelompok dan catatan
anggota ditambahkan, dan bukti dibedakan foto vs URL video.

```sql
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;
PRAGMA busy_timeout = 5000;

CREATE TABLE settings (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  school_name TEXT NOT NULL DEFAULT 'Sekolah Saya',
  school_address TEXT,
  principal_name TEXT
);

CREATE TABLE users (
  id INTEGER PRIMARY KEY,
  username TEXT NOT NULL UNIQUE,      -- guru/admin: username bebas; murid/ortu: NIS
  name TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('admin', 'guru', 'pengamat')),
  can_view_all INTEGER NOT NULL DEFAULT 0, -- hanya untuk pengamat kepsek
  must_change_password INTEGER NOT NULL DEFAULT 0,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE user_sessions (
  id INTEGER PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  created_at TEXT DEFAULT (datetime('now')),
  expires_at TEXT NOT NULL,
  last_seen_at TEXT
);

CREATE TABLE observer_links (
  user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  student_id INTEGER NOT NULL UNIQUE REFERENCES students(id) ON DELETE CASCADE
);

CREATE TABLE periods (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,                  -- "2026/2027 Ganjil"
  starts_on TEXT, ends_on TEXT,
  is_active INTEGER NOT NULL DEFAULT 0 -- ditegakkan di aplikasi: tepat satu aktif
);

CREATE TABLE classes (
  id INTEGER PRIMARY KEY,
  period_id INTEGER NOT NULL REFERENCES periods(id),
  name TEXT NOT NULL,                  -- "TK B1", "7.1", "XI TKJ 2"
  level_label TEXT,                    -- teks bebas: "Fase A", "Kelas 7"
  UNIQUE (period_id, name)
);

CREATE TABLE students (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  student_no TEXT UNIQUE,              -- NIS; boleh kosong, tapi wajib untuk akun pengamat
  active INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE enrollments (
  class_id INTEGER NOT NULL REFERENCES classes(id),
  student_id INTEGER NOT NULL REFERENCES students(id),
  PRIMARY KEY (class_id, student_id)
);

-- Kelompok permanen per kelas (model A)
CREATE TABLE groups (
  id INTEGER PRIMARY KEY,
  class_id INTEGER NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
  name TEXT NOT NULL,                  -- "Kelompok 1"
  UNIQUE (class_id, name)
);

CREATE TABLE group_members (
  group_id INTEGER NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  student_id INTEGER NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  PRIMARY KEY (group_id, student_id)
);

CREATE TABLE class_teachers (
  id INTEGER PRIMARY KEY,
  class_id INTEGER NOT NULL REFERENCES classes(id),
  user_id INTEGER NOT NULL REFERENCES users(id),
  subject_label TEXT,                  -- "Matematika", "Wali kelas"
  UNIQUE (class_id, user_id, subject_label)
);

CREATE TABLE frameworks (
  id INTEGER PRIMARY KEY,
  owner_id INTEGER REFERENCES users(id),
  title TEXT NOT NULL,
  description TEXT,
  visibility TEXT NOT NULL DEFAULT 'private'
    CHECK (visibility IN ('private', 'sekolah')),
  is_template INTEGER NOT NULL DEFAULT 0 -- templat bawaan, dikelola admin
);

CREATE TABLE goals (
  id INTEGER PRIMARY KEY,
  framework_id INTEGER NOT NULL REFERENCES frameworks(id) ON DELETE CASCADE,
  parent_id INTEGER REFERENCES goals(id),
  code TEXT,
  text TEXT NOT NULL,
  sort INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE instruments (
  id INTEGER PRIMARY KEY,
  owner_id INTEGER REFERENCES users(id),
  title TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('rubrik', 'checklist', 'skala', 'anekdotal', 'gabungan')),
  levels TEXT NOT NULL DEFAULT '[]',   -- JSON: [{"v":1,"label":"Mulai muncul"}, ...]
  visibility TEXT NOT NULL DEFAULT 'private'
    CHECK (visibility IN ('private', 'sekolah')),
  is_template INTEGER NOT NULL DEFAULT 0,
  forked_from INTEGER REFERENCES instruments(id)
);

CREATE TABLE criteria (
  id INTEGER PRIMARY KEY,
  instrument_id INTEGER NOT NULL REFERENCES instruments(id) ON DELETE CASCADE,
  goal_id INTEGER REFERENCES goals(id),
  text TEXT NOT NULL,
  descriptors TEXT,                    -- JSON per level, mis. {"1": "...", "2": "..."}
  weight REAL NOT NULL DEFAULT 1,
  input_type TEXT NOT NULL CHECK (input_type IN ('rubrik', 'checklist', 'skala', 'teks')),
  sort INTEGER NOT NULL DEFAULT 0
);
-- Aturan: bila kind bukan 'gabungan', semua input_type kriteria harus sama
-- dengan kind itu (kecuali 'teks' hanya untuk catatan tanpa skor).
-- Bila kind = 'gabungan', input_type boleh campuran, dan kriteria 'teks'
-- tidak menghasilkan skor.

CREATE TABLE sessions (
  id INTEGER PRIMARY KEY,
  class_id INTEGER NOT NULL REFERENCES classes(id),
  instrument_id INTEGER REFERENCES instruments(id),
  teacher_id INTEGER NOT NULL REFERENCES users(id),
  scope TEXT NOT NULL CHECK (scope IN ('individu', 'kelompok')),
  observed_at TEXT NOT NULL,           -- tanggal observasi (ISO), bukan waktu simpan
  activity TEXT,                       -- "Pidato", "Praktikum", "Bermain peran"
  note TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

-- Snapshot instrumen saat sesi dibuat. Skor selalu merujuk ke snapshot,
-- sehingga edit instrumen belakangan tidak mengubah riwayat.
CREATE TABLE session_criteria (
  id INTEGER PRIMARY KEY,
  session_id INTEGER NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  source_criterion_id INTEGER REFERENCES criteria(id),
  goal_id INTEGER REFERENCES goals(id),
  text TEXT NOT NULL,
  descriptors TEXT,
  weight REAL NOT NULL DEFAULT 1,
  input_type TEXT NOT NULL CHECK (input_type IN ('rubrik', 'checklist', 'skala', 'teks')),
  sort INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE observations (
  id INTEGER PRIMARY KEY,
  session_id INTEGER NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  student_id INTEGER REFERENCES students(id),
  group_id INTEGER REFERENCES groups(id),
  note TEXT,                           -- catatan anekdotal utama
  client_uuid TEXT UNIQUE,             -- disiapkan untuk sinkron offline (fase berikutnya)
  created_at TEXT DEFAULT (datetime('now')),
  CHECK (
    (student_id IS NOT NULL AND group_id IS NULL) OR
    (student_id IS NULL AND group_id IS NOT NULL)
  )
);
CREATE UNIQUE INDEX idx_obs_session_student
  ON observations(session_id, student_id) WHERE student_id IS NOT NULL;
CREATE UNIQUE INDEX idx_obs_session_group
  ON observations(session_id, group_id) WHERE group_id IS NOT NULL;

-- Catatan individu opsional untuk anggota kelompok (model A)
CREATE TABLE member_notes (
  id INTEGER PRIMARY KEY,
  observation_id INTEGER NOT NULL REFERENCES observations(id) ON DELETE CASCADE,
  student_id INTEGER NOT NULL REFERENCES students(id),
  note TEXT NOT NULL,
  UNIQUE (observation_id, student_id)
);

CREATE TABLE scores (
  observation_id INTEGER NOT NULL REFERENCES observations(id) ON DELETE CASCADE,
  snapshot_criterion_id INTEGER NOT NULL REFERENCES session_criteria(id),
  value REAL NOT NULL,
  PRIMARY KEY (observation_id, snapshot_criterion_id)
);

CREATE TABLE evidence (
  id INTEGER PRIMARY KEY,
  observation_id INTEGER NOT NULL REFERENCES observations(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('foto', 'video_url')),
  path TEXT,                           -- foto: nama berkas hasil generate server
  url TEXT,                            -- video_url: tautan https yang ditempel guru
  caption TEXT,                        -- opsional, maks. 200 karakter
  mime TEXT, bytes INTEGER,
  created_at TEXT DEFAULT (datetime('now')),
  CHECK ((kind = 'foto' AND path IS NOT NULL) OR (kind = 'video_url' AND url IS NOT NULL))
);

-- Narasi tersimpan per murid per periode; hasil edit guru tidak ditimpa
-- regenerasi otomatis kecuali guru menekan "Buat ulang narasi".
CREATE TABLE report_narratives (
  id INTEGER PRIMARY KEY,
  student_id INTEGER NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  period_id INTEGER NOT NULL REFERENCES periods(id) ON DELETE CASCADE,
  narrative TEXT NOT NULL,
  edited_by INTEGER REFERENCES users(id),
  updated_at TEXT DEFAULT (datetime('now')),
  UNIQUE (student_id, period_id)
);

CREATE TABLE audit_logs (
  id INTEGER PRIMARY KEY,
  user_id INTEGER REFERENCES users(id),
  action TEXT NOT NULL,                -- mis. "score.create", "score.update", "login"
  entity TEXT, entity_id INTEGER,
  detail TEXT,                         -- JSON ringkas
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX idx_obs_student ON observations(student_id, created_at);
CREATE INDEX idx_obs_group ON observations(group_id, created_at);
CREATE INDEX idx_sessions_class ON sessions(class_id, observed_at);
CREATE INDEX idx_enroll_student ON enrollments(student_id);
CREATE INDEX idx_group_member_student ON group_members(student_id);
```

Aturan validasi nilai (ditegakkan di server, diuji otomatis):

- Kriteria `rubrik` dan `skala`: `value` harus sama persis dengan salah
  satu `v` di `levels` instrumen snapshot.
- Kriteria `checklist`: `value` hanya 0 atau 1. Level default checklist
  adalah `[{v:0,label:"Belum"},{v:1,label:"Ya"}]` bila guru tidak mengisi.
- Kriteria `teks`: tidak boleh punya baris di `scores`; nilainya hanya
  catatan di `observations.note` atau `member_notes.note`.
- Instrumen `anekdotal` murni tidak punya skor; rekapnya berupa daftar
  catatan dan bukti, tanpa angka.
- Observasi boleh disimpan sebagian (beberapa kriteria kosong), tetapi
  ditandai "belum lengkap" sampai semua kriteria berskor terisi.

## 5. Peta route (MVP)

```text
/login, /logout, /ganti-sandi
/                                  dasbor: kelas saya, murid/kelompok belum diamati
/kelas/:id                         daftar murid + kelompok + status pengamatan
/catat/:sessionId                  layar catat cepat (mobile-first, online di MVP)
/instrumen                          daftar, buat, salin dari templat
/instrumen/:id/edit
/murid/:id                         profil perkembangan + grafik + semua catatan
/rekap/kelas/:id                   rekap per kriteria / tujuan / kelompok
/rekap/murid/:id/cetak             pratinjau narasi (bisa diedit) + cetak PDF via print
/bukti/:id                         berkas foto, wajib login + cek hak (bukan statis publik)
/admin                             dasbor admin
/admin/pengaturan                  nama sekolah, kepala sekolah, alamat
/admin/guru                        daftar, tambah manual, impor CSV
/admin/kelas                       daftar, tambah, atur guru pengampu
/admin/murid                       daftar, tambah manual, impor CSV
/admin/kelompok                    bentuk kelompok dari murid kelas (ceklis)
/admin/periode                      daftar, tambah, aktifkan (tepat satu aktif)
/admin/templat                      kelola instrumen dan kerangka bawaan
/admin/backup                      unduh backup, restore (dengan konfirmasi)
/api/kesehatan                      health check tanpa login (untuk systemd/VPS)
```

Rute `/catat/:kelasId` pada rancangan awal diubah menjadi
`/catat/:sessionId`, karena sesi sudah mengikat kelas, instrumen, scope,
aktivitas, dan tanggal. Alur membuat sesi: pilih kelas -> pilih scope
(individu/kelompok) -> pilih instrumen atau tanpa instrumen (anekdotal)
-> isi aktivitas dan tanggal -> masuk ke grid catat cepat.

## 6. Rumus skor dan rekap (selalu ada angka)

Definisi ini mengikat dan harus diimplementasikan persis di `scores.ts`
serta diuji dengan `bun test`.

- `max_level` satu sesi = nilai `v` terbesar di `levels` snapshot sesi
  itu. Untuk checklist, `max_level` = 1.
- **Skor satu observasi** (hanya kriteria berskor yang terisi):
  `sum(value * weight) / sum(weight)`.
  **Skor 0–100 observasi** = `skor observasi / max_level * 100`.
- **Skor per kriteria untuk satu murid** dalam satu periode:
  rata-rata `value` kriteria itu di semua observasi murid tersebut
  (observasi kelompok ikut dihitung untuk setiap anggotanya),
  ditambah distribusi: berapa kali tiap label level muncul.
- **Skor per tujuan:** rata-rata berbobot semua kriteria yang tertaut
  ke tujuan itu, termasuk kriteria pada tujuan anak yang digulung ke
  tujuan induknya.
- **Skor keseluruhan murid per periode:** rata-rata skor observasi
  murid itu dalam periode tersebut. Angka ini selalu ditampilkan
  bersama rincian per instrumen, supaya campuran instrumen yang
  berbeda tidak disalahartikan sebagai satu nilai tunggal yang murni.
- **Skor kelompok:** sama dengan skor observasinya; di profil tiap
  anggota, observasi kelompok ditandai "Kelompok: <nama>" dan nilainya
  sama untuk semua anggota.
- **Rekap kelas:** rata-rata murid, distribusi level per kriteria,
  daftar murid/kelompok yang belum diamati pada periode aktif, dan
  peringkat opsional per kelas (peringkat hanya di rekap kelas, bukan
  di laporan murid, agar laporan murid tetap bersifat perkembangan).
- **Tren murid:** grafik SVG: sumbu-x `observed_at`, sumbu-y skor 0–100,
  satu titik per observasi, diberi label aktivitas saat diarahkan.
- Instrumen anekdotal murni tidak punya skor 0–100; rekapnya menampilkan
  jumlah catatan dan daftar catatan, dan tidak ikut menarik rata-rata
  keseluruhan ke bawah.

Contoh: level PAUD 1 = Belum muncul, 2 = Mulai muncul,
3 = Berkembang sesuai harapan, 4 = Membudaya. Murid dengan rata-rata
3,25 tampil sebagai "3,25 dari 4 (81 dari 100)".

## 7. Narasi, cetak, dan bukti

- Narasi dibuat otomatis per murid per periode dari: level yang paling
  sering muncul per kriteria/tujuan, deskriptor level tersebut, catatan
  guru, dan aktivitas yang diamati. Kalimat narasi memakai label level
  apa adanya, tidak mengarang capaian yang tidak ada datanya.
- Guru bisa mengedit narasi di halaman pratinjau cetak. Hasil edit
  disimpan di `report_narratives`. Regenerasi otomatis tidak menimpa
  narasi yang sudah diedit, kecuali guru menekan "Buat ulang narasi".
- Cetak MVP: halaman cetak dengan CSS print (kop sekolah dari
  pengaturan, identitas murid, tabel skor, grafik, narasi, tanda tangan
  kepala sekolah/guru bila diisi di pengaturan). Guru mencetak lewat
  dialog print browser menjadi PDF. Tidak ada pustaka PDF server di MVP.
- Bukti foto: kompresi di klien (canvas, JPEG) sampai <= 5 MB; server
  menolak berkas > 5 MB, mime di luar jpg/png/webp, dan nama berkas
  dari pengguna. Server menyimpan dengan nama hasil generate (UUID +
  ekstensi aman) dan menghapus berkas fisiknya saat baris evidence
  dihapus. URL video hanya disimpan sebagai tautan https dan
  ditampilkan sebagai tautan, bukan unduhan dari server.

## 8. Impor CSV (pelajaran dari GezyAspro dan GezyRaport)

- Semua impor berjalan dalam satu transaksi: bila satu baris tidak
  valid, seluruh impor dibatalkan dan admin diberi daftar baris yang
  bermasalah. Tidak ada impor setengah jalan.
- Pencocokan nama murid/kelas memakai NIS atau nama kelas persis
  (cocok-persis), bukan pencocokan mirip. NIS duplikat ditolak.
- `murid.csv`: kolom `nis,nama`. Kelas tujuan dipilih di antarmuka
  sebelum unggah, bukan ditebak dari isi berkas.
- `guru.csv`: kolom `username,nama,password_awal`. Bila
  `password_awal` kosong, admin wajib mengisi satu kata sandi awal
  untuk batch itu di form impor; semua akun impor ditandai
  `must_change_password = 1`.
- `kelompok.csv` (opsional, bila membentuk banyak kelompok sekaligus):
  kolom `nama_kelompok,nis`. NIS harus sudah ada di kelas itu;
  satu murid hanya boleh di satu kelompok per kelas (asumsi A2).
- Template contoh selalu tersedia untuk diunduh dari halaman impor.

## 9. Urutan pembangunan (MVP, lalu fase berikutnya)

### Fase 0 — Fondasi

Skema dan migrasi, auth username + kata sandi, sesi login, middleware
peran dan cek pengampu, pengaturan sekolah, CRUD periode/kelas/murid,
impor CSV murid dan guru, akun pengamat (kepsek dan NIS), seed templat
bawaan, halaman login dan dasbor, `bun test` dasar, dan skrip backup.

### Fase 1 — Kerangka dan instrumen

CRUD kerangka dan tujuan bersarang, pembuat instrumen (rubrik,
checklist, skala, anekdotal, gabungan), level yang bisa diedit,
deskriptor per level, bobot, tautan kriteria ke tujuan (opsional),
templat bawaan yang bisa disalin guru, dan snapshot instrumen saat sesi
dibuat.

### Fase 2 — Catat cepat dan bukti

Pembuatan sesi (individu/kelompok), grid murid atau kelompok dengan
tanda sudah/belum diamati, form tap level per kriteria dengan target
sekitar 10 detik per murid atau per kelompok, catatan opsional,
catatan anggota kelompok, foto terkompresi, dan URL video.

### Fase 3 — Profil, rekap, dan narasi

Profil murid (termasuk observasi kelompok yang diperluas ke anggota),
grafik tren SVG, rekap kelas per kriteria/tujuan/kelompok, daftar belum
diamati, generator narasi dan editor narasi.

### Fase 4 — Cetak, backup, dan hardening MVP

Halaman cetak PDF via print, backup dan restore (database + folder
bukti dalam satu arsip, dengan konfirmasi dan pembersihan sesi setelah
restore), audit log perubahan nilai, pengujian akhir, dan panduan
deploy VPS.

### Fase berikutnya (di luar MVP, sesuai jawaban Pak Gun)

- Antrean offline: IndexedDB + `/api/sync` idempoten berbasis
  `client_uuid`, termasuk antrean foto dan status antrean di antarmuka.
- Service worker minimal agar shell catat cepat bisa dibuka ulang
  tanpa sinyal.
- Ekspor Word (docx) memakai kembali alur pembuatan dokumen yang
  sudah dipakai Pak Gun sebelumnya.
- Unggah berkas video (bila nanti diputuskan, dengan batas dan
  kompresi yang ditetapkan tersendiri; di MVP video hanya URL).
- Relasi orang tua-murid yang terpisah dari akun murid, bila nanti
  akun orang tua tidak lagi disamakan dengan akun murid.

## 10. Asumsi yang saya pakai (koreksi bila salah)

- **A1 — NIS bukan satu-satunya kredensial.** "Pakai NIS saja" saya
  tafsirkan sebagai username = NIS, tetap dengan kata sandi yang
  ditetapkan admin. NIS saja tanpa kata sandi berarti siapa pun yang
  tahu NIS seorang murid bisa membuka laporannya, jadi itu tidak saya
  pakai sebagai default. Bila maksud Pak Gun memang tanpa kata sandi,
  beri tahu saya sebelum pembangunan.
- **A2 — Satu murid, satu kelompok per kelas.** Ini mencegah satu murid
  mendapat dua nilai kelompok yang berbeda dalam kelas yang sama dan
  menggandakan rekapnya.
- **A3 — Maksimal 5 foto per observasi**, caption maksimal 200 karakter
  (mengikuti pola Aspro). Batas per berkas tetap 5 MB setelah kompresi.
- **A4 — Skor keseluruhan = rata-rata skor observasi** dalam periode,
  selalu ditampilkan bersama rincian per instrumen.
- **A5 — Video URL boleh tautan https apa pun**, ditampilkan sebagai
  tautan, bukan diputar otomatis dari server.
- **A6 — Periode aktif tepat satu.** Mengaktifkan periode baru
  menonaktifkan periode lama secara otomatis.

## 11. Keamanan, backup, dan deploy (MVP)

- Setiap route memeriksa peran di server; guru hanya untuk kelas yang
  diampu (cek `class_teachers`), pengamat murid/ortu hanya untuk
  muridnya (cek `observer_links`).
- Foto tidak pernah dilayani sebagai file statis publik; selalu lewat
  `/bukti/:id` dengan cek login dan hak.
- Backup = salinan database lewat perintah backup SQLite (bukan salin
  file mentah saat WAL aktif) + arsip folder bukti + cap waktu.
  Restore mengganti keduanya dan membersihkan semua sesi login.
  Database dan folder bukti tidak pernah di-commit ke repo.
- Akun admin awal wajib diganti kata sandinya saat deploy pertama;
  kredensial tidak ditulis di repo maupun di plan ini.
- Deploy di tangan Pak Gun (pola yang sama seperti GezyAspro dan
  GezyRaport): `git pull` di VPS + restart service systemd di balik
  reverse proxy HTTPS. Plan ini tidak menetapkan domain; domain
  ditentukan saat deploy.
- Kriteria selesai MVP: semua route di bagian 5 bisa dipakai tanpa
  login ganda yang bocor, rumus bagian 6 lolos `bun test`, impor CSV
  yang salah dibatalkan penuh, snapshot instrumen terbukti tidak
  berubah setelah edit, dan backup hasil deploy bisa di-restore di
  salinan percobaan.
