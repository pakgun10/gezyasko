# Deploy GezyAsko ke VPS (contoh)

Dokumen ini hanya contoh; domain, pengguna, dan direktori disesuaikan
dengan VPS Pak Gun. Deploy dan restart sepenuhnya di tangan pemilik VPS.

## Prasyarat

- Bun terpasang di VPS.
- Reverse proxy (Nginx/Caddy) dengan HTTPS mengarah ke port aplikasi.
- Direktori data di luar repo, mis. `/opt/gezyasko/data`.

## Langkah

1. Salin kode aplikasi ke VPS (mis. `/opt/gezyasko/gezyasko-app`),
   lalu `bun install` di direktori itu.
2. Buat direktori data: `mkdir -p /opt/gezyasko/data/bukti`.
3. Salin `deploy/gezyasko.service` ke `/etc/systemd/system/` dan
   sesuaikan `User`, `WorkingDirectory`, `DATA_DIR`, dan path Bun.
4. Jalankan pertama kali dengan kata sandi admin awal lewat env:

   ```sh
   SEED_ADMIN_PASSWORD='<kata-sandi-kuat>' DATA_DIR=/opt/gezyasko/data PORT=3000 bun run src/index.ts
   ```

   Bila `SEED_ADMIN_PASSWORD` tidak diisi, aplikasi membuat kata sandi
   acak sekali tampil di log — segera ganti setelah login pertama.
   Akun admin awal wajib diganti kata sandinya saat deploy pertama.
5. `systemctl daemon-reload && systemctl enable --now gezyasko`.
6. Atur reverse proxy HTTPS ke `http://127.0.0.1:3000` dan set
   `COOKIE_SECURE=1` di service.
7. Uji: buka `/api/kesehatan` (harus `{"ok":true}`), login admin,
   lalu ubah nama sekolah di `/admin/pengaturan`.

## Backup dan restore

- Backup berkala: jalankan `deploy/backup.sh` lewat cron, atau unduh
  dari halaman `/admin/backup`.
- Restore hanya lewat halaman `/admin/backup` (konfirmasi wajib);
  restore mengganti database + folder bukti dan membersihkan semua
  sesi login, sehingga semua pengguna harus masuk kembali.

## Yang tidak pernah di-commit

`data/`, berkas `*.db` beserta `-wal`/`-shm`, `.env`, dan arsip
backup. Lihat `.gitignore`.
