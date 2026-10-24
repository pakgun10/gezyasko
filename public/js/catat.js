// Interaksi ringan catat cepat: ketuk level langsung terlihat terpilih
// (radio sudah ditangani CSS), dan tombol simpan tidak bisa diklik ganda.
document.addEventListener("DOMContentLoaded", () => {
  document.querySelectorAll("form.catatform").forEach((form) => {
    form.addEventListener("submit", (e) => {
      const btn = form.querySelector('button[type="submit"]');
      if (btn) {
        btn.disabled = true;
        btn.textContent = "Menyimpan…";
      }
      void e;
    });
  });
});
