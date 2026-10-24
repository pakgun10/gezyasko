// Kompresi foto di sisi klien sampai <= 5 MB sebelum dikirim.
// Foto yang sudah <= 5 MB dibiarkan apa adanya; yang lebih besar
// diperkecil (maks. sisi terpanjang 1920px, JPEG kualitas 0.82, turun
// bertahap bila masih > 5 MB). Server tetap menolak foto > 5 MB,
// mime di luar JPG/PNG/WebP, dan foto ke-6+ per observasi.
const MAX_BYTES = 5 * 1024 * 1024;

function compressImage(file) {
  return new Promise((resolve) => {
    if (file.size <= MAX_BYTES) return resolve(file);
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      URL.revokeObjectURL(url);
      let w = img.width, h = img.height;
      const maxSide = 1920;
      const scale = Math.min(1, maxSide / Math.max(w, h));
      w = Math.round(w * scale); h = Math.round(h * scale);
      const canvas = document.createElement("canvas");
      canvas.width = w; canvas.height = h;
      canvas.getContext("2d").drawImage(img, 0, 0, w, h);
      let q = 0.82;
      const attempt = () => {
        canvas.toBlob((blob) => {
          if (!blob) return resolve(file);
          if (blob.size <= MAX_BYTES || q <= 0.4) {
            const name = file.name.replace(/\.[^.]+$/, "") + ".jpg";
            return resolve(new File([blob], name, { type: "image/jpeg" }));
          }
          q -= 0.15;
          attempt();
        }, "image/jpeg", q);
      };
      attempt();
    };
    img.onerror = () => { URL.revokeObjectURL(url); resolve(file); };
    img.src = url;
  });
}

document.addEventListener("DOMContentLoaded", () => {
  document.querySelectorAll("form[data-compress]").forEach((form) => {
    form.addEventListener("submit", async (e) => {
      const input = form.querySelector('input[type="file"][name="foto"]');
      if (!input || !input.files.length) return;
      e.preventDefault();
      const dt = new DataTransfer();
      for (const f of input.files) dt.items.add(await compressImage(f));
      input.files = dt.files;
      form.submit();
    });
  });
});
