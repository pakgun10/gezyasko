import { Hono } from "hono";
import { join, basename, extname } from "node:path";
import { openDb, resolveDataDir, dbPathFor, seedAdminIfEmpty, type Db } from "./db";
import { buildRoutes, type AppState } from "./routes";

const MIME: Record<string, string> = {
  ".css": "text/css",
  ".js": "text/javascript",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".webp": "image/webp",
  ".svg": "image/svg+xml",
};

export async function createApp(dataDirOverride?: string): Promise<{ app: Hono; state: AppState }> {
  const dataDir = dataDirOverride || resolveDataDir();
  const publicDir = join(process.cwd(), "public");
  let db: Db = openDb(dbPathFor(dataDir));
  // state.db sengaja bisa diganti (restore membuka ulang database)
  const state: AppState = { db: db as any, dataDir, publicDir };
  // Proxy: route selalu membaca state.db terbaru
  const stateProxy = new Proxy(state, {
    get(t, p) {
      if (p === "db") return (t as any)._db || t.db;
      return (t as any)[p];
    },
    set(t, p, v) {
      if (p === "db") (t as any)._db = v;
      else (t as any)[p] = v;
      return true;
    },
  }) as AppState;

  await seedAdminIfEmpty(stateProxy.db);

  const app = new Hono();
  app.onError((err, c) => {
    console.error("[gezyasko]", err);
    return c.text("Terjadi kesalahan di server. Silakan kembali dan coba lagi.", 500);
  });
  app.notFound((c) => c.text("Halaman tidak ditemukan.", 404));

  // Aset statis lokal (bukan CDN). Hanya berkas di public/ yang boleh dilayani.
  app.get("/static/*", async (c) => {
    const rel = c.req.path.replace(/^\/static\//, "");
    if (!rel || rel.includes("..")) return c.text("Tidak ditemukan.", 404);
    const filePath = join(publicDir, rel);
    const file = Bun.file(filePath);
    if (!(await file.exists())) return c.text("Tidak ditemukan.", 404);
    const ext = extname(basename(filePath)).toLowerCase();
    return new Response(file, { headers: { "Content-Type": MIME[ext] || "application/octet-stream", "Cache-Control": "public, max-age=3600" } });
  });

  buildRoutes(app, stateProxy);
  return { app, state: stateProxy };
}
