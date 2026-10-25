// Pembangun level tanpa JSON untuk formulir instrumen.
// Server tetap menerima dan menyimpan level sebagai JSON (format lama),
// hanya tampilannya yang berubah: guru mengisi baris per level, bukan
// menulis JSON. Nilai v = nomor urutan baris (1, 2, 3, ...), sehingga
// deskriptor kriteria yang memakai kunci posisi tetap cocok.
// Bila JavaScript mati, input tersembunyi tetap berisi JSON awal
// (default PAUD untuk instrumen baru, level tersimpan untuk edit),
// sehingga data tidak hilang.
document.addEventListener("DOMContentLoaded", () => {
  const PRESETS = {
    paud: [
      { label: "Belum muncul" },
      { label: "Mulai muncul" },
      { label: "Berkembang sesuai harapan" },
      { label: "Membudaya" },
    ],
    aspro: [
      { label: "Kurang", min: 0, max: 64, def: 50 },
      { label: "Cukup", min: 65, max: 77, def: 71 },
      { label: "Baik", min: 78, max: 89, def: 84 },
      { label: "Sangat baik", min: 90, max: 100, def: 95 },
    ],
  };

  document.querySelectorAll("[data-level-builder]").forEach((builder) => {
    const rowsEl = builder.querySelector("[data-level-rows]");
    const hidden = builder.querySelector('input[type="hidden"][name="levels"]');
    if (!rowsEl || !hidden) return;
    let initial = [];
    try { initial = JSON.parse(builder.dataset.levels || "[]"); } catch { initial = []; }
    if (!Array.isArray(initial)) initial = [];

    function rowHtml(lv) {
      const row = document.createElement("div");
      row.className = "level-row";
      row.innerHTML =
        '<input type="text" class="level-label" placeholder="Label level, mis. Kompak" value="">' +
        '<input type="number" class="level-min" placeholder="Rentang bawah (kosong = level biasa)">' +
        '<input type="number" class="level-max" placeholder="Rentang atas">' +
        '<input type="number" class="level-def" placeholder="Nilai awal">' +
        '<button type="button" class="btn secondary level-del">Hapus</button>';
      if (lv) {
        row.querySelector(".level-label").value = lv.label || "";
        if (lv.min !== undefined && lv.min !== null) row.querySelector(".level-min").value = lv.min;
        if (lv.max !== undefined && lv.max !== null) row.querySelector(".level-max").value = lv.max;
        if (lv.def !== undefined && lv.def !== null) row.querySelector(".level-def").value = lv.def;
      }
      row.querySelector(".level-del").addEventListener("click", () => {
        row.remove();
        sync();
      });
      row.querySelectorAll("input").forEach((inp) => inp.addEventListener("input", sync));
      return row;
    }

    function collect() {
      const out = [];
      rowsEl.querySelectorAll(".level-row").forEach((row) => {
        const label = row.querySelector(".level-label").value.trim();
        if (!label) return;
        const minRaw = row.querySelector(".level-min").value;
        const maxRaw = row.querySelector(".level-max").value;
        const defRaw = row.querySelector(".level-def").value;
        const lv = { v: out.length + 1, label };
        if (minRaw !== "") lv.min = Number(minRaw);
        if (maxRaw !== "") lv.max = Number(maxRaw);
        if (defRaw !== "") lv.def = Number(defRaw);
        out.push(lv);
      });
      return out;
    }

    function sync() {
      hidden.value = JSON.stringify(collect());
    }

    function render(levels) {
      rowsEl.innerHTML = "";
      (levels.length ? levels : [{ label: "" }]).forEach((lv) => rowsEl.appendChild(rowHtml(lv)));
      sync();
    }

    builder.querySelectorAll("[data-preset]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const preset = PRESETS[btn.dataset.preset];
        if (preset) render(preset);
      });
    });
    const addBtn = builder.querySelector("[data-add-level]");
    if (addBtn) addBtn.addEventListener("click", () => {
      rowsEl.appendChild(rowHtml(null));
      sync();
    });

    render(initial);
    const form = builder.closest("form");
    if (form) form.addEventListener("submit", sync);
  });
});
