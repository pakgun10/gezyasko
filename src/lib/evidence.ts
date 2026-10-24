// Aturan bukti foto (plan bagian 7 + A3).

export const MAX_PHOTO_BYTES = 5 * 1024 * 1024;
export const MAX_PHOTOS_PER_OBSERVATION = 5;
export const MAX_CAPTION = 200;
export const ALLOWED_MIME = new Set(["image/jpeg", "image/png", "image/webp"]);

export function extensionForMime(mime: string): string | null {
  if (mime === "image/jpeg") return "jpg";
  if (mime === "image/png") return "png";
  if (mime === "image/webp") return "webp";
  return null;
}

export function validatePhoto(mime: string, bytes: number, existingCount: number): string | null {
  if (!ALLOWED_MIME.has(mime)) return "Foto harus berformat JPG, PNG, atau WebP.";
  if (bytes > MAX_PHOTO_BYTES) return "Foto melebihi 5 MB.";
  if (existingCount >= MAX_PHOTOS_PER_OBSERVATION) return "Maksimal 5 foto per observasi.";
  return null;
}

export function validateVideoUrl(url: string): string | null {
  if (!url) return null;
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return "URL video tidak valid.";
  }
  if (u.protocol !== "https:") return "URL video harus memakai https.";
  return null;
}

export function safeFileName(id: string, mime: string): string | null {
  const ext = extensionForMime(mime);
  if (!ext) return null;
  return `${id}.${ext}`;
}
