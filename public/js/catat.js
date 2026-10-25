// Interaksi ringan catat cepat: ketuk level langsung terlihat terpilih
// (radio sudah ditangani CSS), dan tombol simpan tidak bisa diklik ganda.
//
// Rubrik pola Aspro: begitu tombol tingkat diklik, kolom angka di
// kriteria yang sama terisi nilai awal level itu (data-def), dengan
// batas min/max level itu. Guru boleh mengubah angka itu selama masih
// di dalam rentang; server tetap memvalidasi ulang. Tombol "Belum diisi"
// mengosongkan kolom angka.
document.addEventListener("DOMContentLoaded", () => {
  document.querySelectorAll("form.catatform").forEach((form) => {
    form.querySelectorAll('input[type="radio"][name^="level_"]').forEach((radio) => {
      radio.addEventListener("change", () => {
        const critId = radio.name.replace("level_", "");
        const scoreInput = form.querySelector(`input[data-rubric-score="${critId}"]`);
        if (!scoreInput) return;
        if (radio.dataset.clear === "1" || radio.value === "") {
          scoreInput.value = "";
          scoreInput.removeAttribute("min");
          scoreInput.removeAttribute("max");
          return;
        }
        if (radio.dataset.def !== undefined && radio.dataset.def !== "") scoreInput.value = radio.dataset.def;
        if (radio.dataset.min) scoreInput.min = radio.dataset.min;
        if (radio.dataset.max) scoreInput.max = radio.dataset.max;
      });
    });
    // Bila halaman dibuka dengan level yang sudah tersimpan, terapkan
    // batas min/max-nya agar angka yang tampil konsisten dengan level.
    form.querySelectorAll('input[type="radio"][name^="level_"]:checked').forEach((radio) => {
      if (radio.value === "") return;
      const critId = radio.name.replace("level_", "");
      const scoreInput = form.querySelector(`input[data-rubric-score="${critId}"]`);
      if (!scoreInput) return;
      if (radio.dataset.min) scoreInput.min = radio.dataset.min;
      if (radio.dataset.max) scoreInput.max = radio.dataset.max;
    });
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
