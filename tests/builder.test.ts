import { describe, test, expect } from "bun:test";
import { descriptorsFromFields } from "../src/lib/validate";

describe("pembangun deskriptor per level (tanpa JSON)", () => {
  test("kolom desc_<posisi> dikumpulkan menjadi JSON deskriptor, yang kosong diabaikan", () => {
    expect(
      descriptorsFromFields({
        text: "Kekompakan & Sinkronisasi Gerakan",
        desc_1: "",
        desc_3: "Gerakan umumnya serentak, hanya 1–2 momen kurang seragam",
        desc_4: "Seluruh gerakan serentak dan seragam",
      }),
    ).toBe(
      JSON.stringify({
        "3": "Gerakan umumnya serentak, hanya 1–2 momen kurang seragam",
        "4": "Seluruh gerakan serentak dan seragam",
      }),
    );
  });
  test("tanpa kolom desc_ mengembalikan null (fallback ke kolom JSON lama)", () => {
    expect(descriptorsFromFields({ text: "K1", descriptors: '{"1":"a"}' })).toBeNull();
    expect(descriptorsFromFields({})).toBeNull();
  });
});
