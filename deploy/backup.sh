#!/bin/sh
# Backup GezyAsko: salinan database yang konsisten saat WAL aktif (VACUUM INTO)
# plus folder bukti, dalam satu arsip .tar.gz.
# Penggunaan: DATA_DIR=/opt/gezyasko/data ./deploy/backup.sh [direktori-tujuan]
# Catatan: skrip ini contoh untuk VPS; backup lewat halaman /admin/backup di aplikasi
# melakukan hal yang sama tanpa perlu skrip ini.
set -eu
DATA_DIR="${DATA_DIR:-/opt/gezyasko/data}"
DEST="${1:-/opt/gezyasko/backups}"
APP_DIR="${APP_DIR:-/opt/gezyasko/gezyasko-app}"
mkdir -p "$DEST" /tmp/gezyasko-backup-tmp
STAMP="$(date +%Y%m%d-%H%M%S)"
# VACUUM INTO lewat bun + bun:sqlite (baca saja, tidak mengubah database live)
bun -e "
import { Database } from 'bun:sqlite';
const db = new Database(process.env.DATA_DIR + '/gezyasko.db', { readonly: false });
db.exec('PRAGMA busy_timeout = 5000;');
db.query('VACUUM INTO ?').run('/tmp/gezyasko-backup-tmp/gezyasko.db');
db.close();
"
tar -czf "$DEST/gezyasko-backup-$STAMP.tar.gz" -C /tmp/gezyasko-backup-tmp gezyasko.db -C "$DATA_DIR" bukti
rm -rf /tmp/gezyasko-backup-tmp
echo "Backup tersimpan: $DEST/gezyasko-backup-$STAMP.tar.gz"
echo "Restore lewat halaman /admin/backup di aplikasi (akan membersihkan semua sesi login)."
