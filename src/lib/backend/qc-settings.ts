// ============================================================
// qc-settings.ts — Pengaturan global QC (superadmin, menu Pengaturan)
//
// v9.44 — Dua pengaturan global baru yang hanya dapat diatur superadmin
// pada menu "Pengaturan" dan berlaku untuk SEMUA akun:
//
//   1. te_formula — Rumus TE% (Total Error %):
//        "196" → TE% = |Bias%| + 1,96 × CV%
//        "165" → TE% = |Bias%| + 1,65 × CV%   (default — perilaku lama)
//
//   2. westgard_rules — daftar aturan Westgard multirule yang AKTIF pada
//      Grafik Levey-Jennings & tabel Analisis Westgard Rules (menu
//      "Grafik & Analisis"), dipisah koma:
//        "1-2s,1-3s,2-2s,R-4s,4-1s,2of3-2s,6x,8x,10x,7T"
//      - Setting BELUM ADA / kosong → SEMUA aturan mesin tetap aktif
//        (perilaku lama tidak berubah sampai superadmin menyimpan ceklis).
//      - "none" → tidak ada aturan yang aktif (semua pelanggaran
//        disembunyikan pada menu Grafik & Analisis).
//
// Semua fungsi aman-gagal (fallback ke perilaku lama) supaya kesalahan DB
// tidak pernah mengubah hasil perhitungan secara diam-diam.
// ============================================================

import { db } from "@/lib/db";

export const TE_FORMULA_KEY = "te_formula";
export const WESTGARD_RULES_KEY = "westgard_rules";

// Semua kode aturan yang dikenali mesin Westgard (termasuk 7x yang tidak
// ditampilkan pada ceklis Pengaturan — 6x selalu mendeteksi lebih dini).
export const ALL_WESTGARD_RULE_CODES = [
  "1-2s",
  "1-3s",
  "2-2s",
  "R-4s",
  "4-1s",
  "2of3-2s",
  "6x",
  "7x",
  "8x",
  "10x",
  "7T",
];

// Faktor K pada rumus TE% = |Bias%| + K × CV%.
// Bila superadmin memilih rumus "Bias % + 1,96 CV %" → 1.96; selain itu
// 1.65 (default, perilaku lama semua menu).
export async function getTeKFactor(): Promise<number> {
  try {
    const row = await db.settings.findUnique({ where: { key: TE_FORMULA_KEY } });
    return row?.value === "196" ? 1.96 : 1.65;
  } catch {
    return 1.65;
  }
}

// Parse nilai setting westgard_rules → daftar kode aturan aktif.
//   null  → setting belum ada/tidak valid → SEMUA aturan aktif (perilaku lama)
//   []    → setting "none" → tidak ada aturan aktif
export function parseWestgardRulesSetting(
  raw: string | null | undefined
): string[] | null {
  if (raw === null || raw === undefined) return null;
  const s = String(raw).trim();
  if (!s) return null;
  if (s.toLowerCase() === "none") return [];
  const parts = s
    .split(",")
    .map((p) => p.trim())
    .filter(Boolean);
  const valid = parts.filter((p) => ALL_WESTGARD_RULE_CODES.includes(p));
  return valid.length ? valid : null;
}

// Daftar aturan Westgard aktif (global) — null berarti semua aturan mesin.
export async function getWestgardEnabledRules(): Promise<string[] | null> {
  try {
    const row = await db.settings.findUnique({
      where: { key: WESTGARD_RULES_KEY },
    });
    return parseWestgardRulesSetting(row?.value);
  } catch {
    return null;
  }
}

// ============================================================
// filterViolationsByEnabledRules — saring pelanggaran Westgard menurut
// ceklis superadmin (pure).
//
//   enabled === null  → semua aturan aktif, hasil tidak diubah (default).
//   enabled = [codes] → hanya pelanggaran dengan aturan dasar (sufiks
//                       kurung dilepas: "2-2s(across)" → "2-2s") yang ada
//                       pada daftar yang dipertahankan.
// ============================================================
export function filterViolationsByEnabledRules(
  violations: any[],
  enabled: string[] | null
): any[] {
  if (!violations || !violations.length) return violations || [];
  if (enabled === null) return violations;
  const set = new Set(enabled);
  return violations.filter((v) => {
    const base = String(v?.rule || "")
      .replace(/\s*\([^)]*\)\s*$/, "")
      .trim();
    return set.has(base);
  });
}

// Intersect daftar "aturan aktif berbasis sigma" dengan ceklis superadmin —
// untuk tampilan daftar aturan aktif di info box Sigma-Based QC Selection.
export function intersectActiveRules(
  sigmaRules: string[] | null | undefined,
  enabled: string[] | null
): string[] {
  const base = sigmaRules || [];
  if (enabled === null) return base;
  const set = new Set(enabled);
  return base.filter((r) => set.has(r));
}
