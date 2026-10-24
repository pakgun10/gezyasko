import { createApp } from "./app";

const port = Number(process.env.PORT || 3000);
const { app } = await createApp();

console.log(`[gezyasko] Berjalan di http://localhost:${port} (DATA_DIR=${process.env.DATA_DIR || "data bawaan ./data"})`);
export default {
  port,
  fetch: app.fetch,
};
