// ============================================================
// peergroup.ts — Peer Group Analisis (v9.36)
//
// Fitur: menu superadmin "Peer Group Analisis" untuk merekap statistik
// QC semua level (N, Mean, SD, CV, TE, TEa, Bias, Sigma, kinerja sigma)
// dari SEMUA akun user yang terdaftar, lalu mengirim hasil rekap ke
// akun user terpilih (tenant: nama akun lain disembunyikan pada penerima,
// tetapi rekap statistik semua akun tetap tampil).
//
// Handler:
//   pgFilterOptions  — opsi filter: akun terdaftar + Parameter/Alat/No.Lot/
//                      Metode dari TABEL Lot QC semua akun (v9.42)
//   pgTabulasi       — rekap statistik lintas akun (superadmin)
//   pgAnalisa        — analisa otomatis (interpretasi, analisa, CAPA)
//   pgKirim          — kirim laporan ke akun terpilih (superadmin)
//   pgReportsSent    — daftar laporan terkirim + status ON/OFF (superadmin)
//   pgReportDetail   — detail payload laporan (superadmin, nama asli)
//   pgReportToggle   — tombol ON/OFF laporan (superadmin)
//   pgReportDelete   — hapus laporan (superadmin)
//   pgInbox          — daftar laporan aktif utk akun saya (blink merah)
//   pgInboxReport    — buka laporan di inbox (nama akun lain DIANONIMKAN)
//   pgUnreadCount    — polling ringan: total + unread utk menu blink
//   pgAnalytics      — dashboard kinerja peer group per akun (v9.39)
//   pgAnalyticsAnalisa — analisa per grafik analytics (v9.39)
//   pgDashboard      — "Dashboard PG Analisis" superadmin (v9.41):
//                      alat terbanyak dipakai, ranking KPI kinerja alat
//                      (CV/Bias/TE/Sigma), riwayat pendaftaran & persetujuan
//                      akun (timestamp), data tabel laporan formal cetak/PDF
//   pgZscoreIQC      — "PG Z-score IQC" superadmin (v9.43): rekap tabulasi
//                      otomatis Z-score & Bias% per akun × parameter × lot ×
//                      level terhadap 3 kelompok peer (Seluruh Peserta,
//                      Kelompok Metode, Kelompok Alat) memakai statistik
//                      robust ISO 13528:2022 (Algorithm A — target = median
//                      winsorized, SDPA = SD winsorized init 1.483×MAD)
//   pgZscoreAnalisa  — analisa otomatis (interpretasi/analisa/CAPA) dari
//                      rekap Z-score v9.43
//
// Keamanan: handler admin wajib session.role === "superadmin" && !isSecondary
// (role asli sesi, bukan argumen dari frontend). Tenant penerima hanya
// bisa membuka laporan yang dia jadi penerima dan laporan masih active.
// ============================================================

import { db } from "@/lib/db";
import type { SessionData } from "@/lib/session";
import { computeQCStats } from "@/lib/backend/calculations";
import { getTeKFactor } from "@/lib/backend/qc-settings";
import { parseNumSafe } from "@/lib/utils-server";

// ------------------------------------------------------------
// Guard helper — hanya superadmin asli (bukan password tambahan)
// ------------------------------------------------------------
function isRealSuperadmin(session: SessionData | null): boolean {
  return !!session && session.role === "superadmin" && !session.isSecondary;
}

function deny(): { ok: boolean; msg: string } {
  return { ok: false, msg: "Akses ditolak — menu ini hanya untuk superadmin" };
}

function activeUser(session: SessionData | null): string {
  if (!session) return "";
  return session.activeUsername || session.username;
}

// ID generator mengikuti konvensi aplikasi (PAR_/LOT_/EQ_ <ts>_<rand>)
function genId(prefix: string): string {
  const t = Date.now().toString(36);
  const r = Math.random().toString(36).slice(2, 8);
  return `${prefix}_${t}${r}`;
}

export interface PgTabulasiFilter {
  startDate?: string | null;
  endDate?: string | null;
  params?: string[] | null; // nama parameter
  accounts?: string[] | null; // username
  instruments?: string[] | null; // nama alat
  lots?: string[] | null; // no lot
  metode?: string[] | null; // metode (dari lotQC yang benar-benar dipakai data QC)
}

export interface PgRow {
  account: string; // username pemilik data
  fullName: string;
  parameter: string;
  noLot: string;
  namaAlat: string;
  nQC: number;
  stats: Record<string, any>;
}

// ------------------------------------------------------------
// pgFilterOptions — isi ceklis filter (superadmin)
// v9.42 — Parameter/Alat/Lot/Metode kini bersumber dari TABEL Lot QC
// (master lotQC semua akun) — persis kolom "Parameter", "No.Lot", "Alat",
// "Metode" pada tabel Lot QC submenu "Lot QC" (menu Daftar Parameter):
// Parameter = paramID lot → nama parameter (master Parameter), sama dengan
// getParamName() pada renderLotTable. Akun = semua user terdaftar.
// Checklist di 3 submenu PG (Dashboard PG Analisis, Tabulasi QC Analisis,
// PG QC Performance Analytics) dimuat ulang setiap submenu dibuka, sehingga
// setiap perubahan pada tabel Lot QC otomatis tercermin di ceklis filter.
// ------------------------------------------------------------
export async function pgFilterOptions(args: any[], session: SessionData | null) {
  if (!isRealSuperadmin(session)) return deny();
  try {
    const [users, lotRows, paramMasterRows] = await Promise.all([
      db.users.findMany({
        select: { username: true, fullName: true, role: true, status: true },
        orderBy: { username: "asc" },
      }),
      // v9.42: satu query lotQC (semua akun) utk Parameter/Alat/Lot/Metode
      db.lotQC.findMany({
        select: { paramID: true, noLot: true, namaAlat: true, methode: true },
      }),
      // master Parameter utk resolusi paramID → nama (kolom "Parameter")
      db.parameters.findMany({ select: { id: true, parameter: true } }),
    ]);
    const paramMap = new Map<string, string>();
    paramMasterRows.forEach((p: any) => {
      const nm = String(p.parameter || "").trim();
      if (nm) paramMap.set(String(p.id), nm);
    });
    const paramSet = new Set<string>();
    const alatSet = new Set<string>();
    const lotSet = new Set<string>();
    const metodeSet = new Set<string>();
    lotRows.forEach((l: any) => {
      const pn = paramMap.get(String(l.paramID || ""));
      if (pn) paramSet.add(pn);
      const al = String(l.namaAlat || "").trim();
      if (al) alatSet.add(al);
      const nl = String(l.noLot || "").trim();
      if (nl) lotSet.add(nl);
      const me = String(l.methode || "").trim();
      if (me) metodeSet.add(me);
    });
    const srt = (s: Set<string>) => Array.from(s).sort((a, b) => a.localeCompare(b));
    return {
      ok: true,
      accounts: users.map((u) => ({
        username: u.username,
        fullName: u.fullName,
        role: u.role,
        status: u.status,
      })),
      params: srt(paramSet),
      instruments: srt(alatSet),
      lots: srt(lotSet),
      metode: srt(metodeSet),
    };
  } catch (e: any) {
    return { ok: false, msg: e?.message || String(e) };
  }
}

// ------------------------------------------------------------
// pgTabulasi — rekap statistik QC lintas akun (superadmin)
// args[0] = filter { startDate, endDate, params[], accounts[], instruments[], lots[], metode[] }
// Satu query inputQC (kolom minimal) + satu query lotQC utk target.
// Statistik per (akun × lot) memakai computeQCStats — formula persis
// sama dengan menu Tabulasi Rekap (Mean, SD, CV, Bias vs target lot,
// TE = |Bias| + 1.65CV, Sigma = (TEa − |Bias|)/CV, TEa dari lot).
// ------------------------------------------------------------
export async function pgTabulasi(args: any[], session: SessionData | null) {
  if (!isRealSuperadmin(session)) return deny();
  try {
    const f: PgTabulasiFilter = args[0] || {};

    // Akun: dari filter, atau default semua akun terdaftar
    let accounts: string[] = Array.isArray(f.accounts) ? f.accounts.map(String).filter(Boolean) : [];
    if (!accounts.length) {
      const all = await db.users.findMany({ select: { username: true } });
      accounts = all.map((u) => u.username);
    }
    if (!accounts.length) return { ok: true, rows: [], accounts: [], filter: f };

    const where: any = { ownerUsername: { in: accounts } };
    if (Array.isArray(f.params) && f.params.length) where.parameter = { in: f.params.map(String) };
    if (Array.isArray(f.instruments) && f.instruments.length) where.namaAlat = { in: f.instruments.map(String) };
    if (Array.isArray(f.lots) && f.lots.length) where.noLot = { in: f.lots.map(String) };
    if (f.startDate || f.endDate) {
      // tanggal tersimpan String "YYYY-MM-DD" → perbandingan leksikografis aman
      const t: any = {};
      if (f.startDate) t.gte = String(f.startDate);
      if (f.endDate) t.lte = String(f.endDate);
      where.tanggal = t;
    }

    const [qcRows, lotRows, userRows] = await Promise.all([
      db.inputQC.findMany({
        where,
        select: {
          ownerUsername: true,
          lotID: true,
          parameter: true,
          noLot: true,
          namaAlat: true,
          level1: true,
          level2: true,
          level3: true,
        },
      }),
      db.lotQC.findMany({
        where: { ownerUsername: { in: accounts } },
        select: {
          id: true,
          ownerUsername: true,
          noLot: true,
          namaAlat: true,
          methode: true,
          satuan: true,
          meanL1: true,
          sdL1: true,
          meanL2: true,
          sdL2: true,
          meanL3: true,
          sdL3: true,
          tea: true,
        },
      }),
      db.users.findMany({
        where: { username: { in: accounts } },
        select: { username: true, fullName: true },
      }),
    ]);

    const lotMap = new Map<string, any>();
    lotRows.forEach((l: any) => lotMap.set(l.id, l));
    const nameMap = new Map<string, string>();
    userRows.forEach((u: any) => nameMap.set(u.username, u.fullName || u.username));

    // Kelompokkan baris QC per (akun × lotID)
    const groups = new Map<string, { owner: string; lotID: string; rows: any[]; parameter: string; noLot: string; namaAlat: string }>();
    for (const r of qcRows as any[]) {
      const key = r.ownerUsername + "|" + r.lotID;
      let g = groups.get(key);
      if (!g) {
        g = { owner: r.ownerUsername, lotID: r.lotID, rows: [], parameter: r.parameter || "", noLot: r.noLot || "", namaAlat: r.namaAlat || "" };
        groups.set(key, g);
      }
      g.rows.push(r);
    }

    // v9.38: filter metode — hanya grup yang lot-nya memiliki metode terpilih
    // (metode bersumber dari lotQC yang benar-benar dipakai data QC)
    const metodeFilter = Array.isArray(f.metode)
      ? f.metode.map((m) => String(m).trim()).filter(Boolean)
      : [];
    const metodeSet = new Set(metodeFilter);

    const rows: PgRow[] = [];
    // v9.44 — Rumus TE% global (Pengaturan superadmin): |Bias%| + K×CV%
    const teK = await getTeKFactor();
    for (const g of groups.values()) {
      const lot = lotMap.get(g.lotID) || null; // lot milik akun tsb (target mean/TEa)
      if (metodeSet.size) {
        const lm = String(lot?.methode || "").trim();
        if (!lm || !metodeSet.has(lm)) continue; // metode tidak dipilih / lot tanpa metode
      }
      const stats = computeQCStats(g.rows, lot, teK);
      const hasAny = [1, 2, 3].some((lv) => stats["L" + lv]);
      if (!hasAny) continue;
      rows.push({
        account: g.owner,
        fullName: nameMap.get(g.owner) || g.owner,
        parameter: g.parameter,
        noLot: g.noLot,
        namaAlat: g.namaAlat || (lot ? lot.namaAlat || "" : ""),
        nQC: g.rows.length,
        stats,
      });
    }

    rows.sort((a, b) =>
      a.account.localeCompare(b.account) ||
      a.parameter.localeCompare(b.parameter) ||
      String(a.noLot).localeCompare(String(b.noLot))
    );

    return { ok: true, rows, accounts, filter: f, generatedAt: new Date().toISOString() };
  } catch (e: any) {
    return { ok: false, msg: e?.message || String(e) };
  }
}

// ------------------------------------------------------------
// Kinerja sigma — label & urutan (konsisten dgn sigmaLabel app.html)
// ------------------------------------------------------------
function sigmaGrade(s: number | null): string {
  if (s === null || s === undefined || isNaN(s)) return "Tanpa Data";
  if (s >= 6) return "World Class";
  if (s >= 5) return "Excellent";
  if (s >= 4) return "Good";
  if (s >= 3) return "Marginal";
  if (s >= 2) return "Poor";
  return "Unacceptable";
}

function levelStats(rows: PgRow[]): { row: PgRow; lv: string; s: any }[] {
  const out: { row: PgRow; lv: string; s: any }[] = [];
  for (const r of rows) {
    for (const lv of ["L1", "L2", "L3"]) {
      const s = r.stats && r.stats[lv];
      if (s) out.push({ row: r, lv, s });
    }
  }
  return out;
}

// ------------------------------------------------------------
// pgAnalisa — analisa otomatis dari rekap tabulasi (superadmin)
// args[0] = { rows: PgRow[], filter }
// Rule-based (deterministik, mengikuti praktik QC laboratorium):
// distribusi kinerja sigma, identifikasi bias/imprecision, perbandingan
// antar akun utk parameter sama, interpretasi & CAPA terprioritas.
// ------------------------------------------------------------
export async function pgAnalisa(args: any[], session: SessionData | null) {
  if (!isRealSuperadmin(session)) return deny();
  try {
    const rows: PgRow[] = Array.isArray(args?.[0]?.rows) ? args[0].rows : [];
    const stats = levelStats(rows);
    const accNames = Array.from(new Set(rows.map((r) => r.account)));
    const paramNames = Array.from(new Set(rows.map((r) => r.parameter)));

    // Distribusi kinerja
    const dist: Record<string, number> = { "World Class": 0, Excellent: 0, Good: 0, Marginal: 0, Poor: 0, Unacceptable: 0, "Tanpa Data": 0 };
    let sumSigma = 0, nSigma = 0, sumCV = 0, nCV = 0;
    let teExceed = 0; // TE > TEa
    for (const { s } of stats) {
      const sig = s.sigma === null || s.sigma === undefined ? null : parseFloat(s.sigma);
      dist[sigmaGrade(sig)]++;
      if (sig !== null && !isNaN(sig)) { sumSigma += sig; nSigma++; }
      const cv = s.cv === null || s.cv === undefined ? null : parseFloat(s.cv);
      if (cv !== null && !isNaN(cv)) { sumCV += cv; nCV++; }
      const te = parseNumSafe(s.te); const tea = parseNumSafe(s.tea);
      if (te !== null && tea !== null && te > tea) teExceed++;
    }

    // Per akun
    const perAccount: any[] = [];
    for (const acc of accNames.sort()) {
      const accStats = stats.filter((x) => x.row.account === acc);
      const accRows = rows.filter((r) => r.account === acc);
      const graded = accStats.filter((x) => x.s.sigma !== null && x.s.sigma !== undefined && !isNaN(parseFloat(x.s.sigma)));
      const good = graded.filter((x) => parseFloat(x.s.sigma) >= 4).length;
      const worst = graded.slice().sort((a, b) => parseFloat(a.s.sigma) - parseFloat(b.s.sigma))[0] || null;
      const best = graded.slice().sort((a, b) => parseFloat(b.s.sigma) - parseFloat(a.s.sigma))[0] || null;
      const issues: string[] = [];
      for (const x of accStats) {
        const tea = parseNumSafe(x.s.tea);
        const bias = parseNumSafe(x.s.bias);
        const cv = parseNumSafe(x.s.cv);
        const te = parseNumSafe(x.s.te);
        if (te !== null && tea !== null && te > tea)
          issues.push(`${x.row.parameter} ${x.lv} (Lot ${x.row.noLot}): TE ${te}% > TEa ${tea}% — goal mutu tidak tercapai`);
        else if (bias !== null && tea !== null && Math.abs(bias) > tea * 0.25)
          issues.push(`${x.row.parameter} ${x.lv} (Lot ${x.row.noLot}): Bias ${bias}% tinggi (>25% TEa) — dominan inaccuracy`);
        else if (cv !== null && tea !== null && cv > tea * 0.25)
          issues.push(`${x.row.parameter} ${x.lv} (Lot ${x.row.noLot}): CV ${cv}% tinggi (>25% TEa) — dominan imprecision`);
      }
      perAccount.push({
        account: acc,
        fullName: accRows[0]?.fullName || acc,
        totalLevel: accStats.length,
        goodPct: accStats.length ? Math.round((good / accStats.length) * 100) : 0,
        avgSigma: graded.length ? parseFloat((graded.reduce((a, x) => a + parseFloat(x.s.sigma), 0) / graded.length).toFixed(2)) : null,
        worst: worst ? { parameter: worst.row.parameter, level: worst.lv, lot: worst.row.noLot, sigma: parseFloat(worst.s.sigma) } : null,
        best: best ? { parameter: best.row.parameter, level: best.lv, lot: best.row.noLot, sigma: parseFloat(best.s.sigma) } : null,
        issues: issues.slice(0, 8),
      });
    }

    // Perbandingan antar akun utk tiap parameter (peer comparison)
    const perParameter: any[] = [];
    for (const p of paramNames.sort()) {
      const pStats = stats.filter((x) => x.row.parameter === p && x.s.sigma !== null && x.s.sigma !== undefined && !isNaN(parseFloat(x.s.sigma)));
      if (pStats.length < 2) continue;
      const byAcc = new Map<string, number[]>();
      pStats.forEach((x) => {
        const arr = byAcc.get(x.row.account) || [];
        arr.push(parseFloat(x.s.sigma));
        byAcc.set(x.row.account, arr);
      });
      const accAvg = Array.from(byAcc.entries()).map(([acc, arr]) => ({
        account: acc,
        avgSigma: parseFloat((arr.reduce((a, b) => a + b, 0) / arr.length).toFixed(2)),
      }));
      accAvg.sort((a, b) => b.avgSigma - a.avgSigma);
      const top = accAvg[0];
      const bottom = accAvg[accAvg.length - 1];
      const gap = parseFloat((top.avgSigma - bottom.avgSigma).toFixed(2));
      perParameter.push({
        parameter: p,
        akunDibanding: accAvg.length,
        terbaik: top,
        terendah: bottom,
        gapSigma: gap,
        butuhStandardisasi: gap >= 1.5,
      });
    }

    const total = stats.length;
    const interpretasi: string[] = [];
    const analisa: string[] = [];
    const capa: string[] = [];

    interpretasi.push(`Rekap mencakup ${accNames.length} akun, ${paramNames.length} parameter, ${total} kombinasi statistik level QC.`);
    if (nSigma) interpretasi.push(`Rata-rata Sigma metric keseluruhan: ${(sumSigma / nSigma).toFixed(2)}.`);
    if (total) {
      const good = dist["World Class"] + dist["Excellent"] + dist["Good"];
      interpretasi.push(`${good} dari ${total} level (${Math.round((good / total) * 100)}%) mencapai kinerja Good ke atas (σ≥4); ${dist["Marginal"]} marginal (3≤σ<4); ${dist["Poor"] + dist["Unacceptable"]} di bawah σ<3.`);
    }
    if (teExceed) interpretasi.push(`${teExceed} level memiliki Total Error (TE) melebihi TEa — belum memenuhi goal mutu laboratorium.`);

    const worstAccounts = perAccount.filter((a) => a.avgSigma !== null).sort((a, b) => a.avgSigma - b.avgSigma).slice(0, 3);
    if (worstAccounts.length)
      analisa.push(`Akun dengan kinerja sigma terendah: ${worstAccounts.map((a) => `${a.fullName || a.account} (σ rata-rata ${a.avgSigma})`).join(", ")}. Perlu perhatian lebih pada kontrol imprecision & bias.`);
    const poorLevels = stats.filter((x) => x.s.sigma !== null && parseFloat(x.s.sigma) < 3);
    if (poorLevels.length) {
      const byReason = { bias: 0, cv: 0, both: 0 };
      poorLevels.forEach((x) => {
        const tea = parseNumSafe(x.s.tea) || 0;
        const bias = Math.abs(parseNumSafe(x.s.bias) || 0);
        const cv = parseNumSafe(x.s.cv) || 0;
        const biasDominan = bias > tea * 0.25;
        const cvDominan = cv > tea * 0.25;
        if (biasDominan && cvDominan) byReason.both++;
        else if (biasDominan) byReason.bias++;
        else if (cvDominan) byReason.cv++;
      });
      analisa.push(`Dari ${poorLevels.length} level dengan σ<3: ${byReason.bias} didominasi bias (inaccuracy), ${byReason.cv} didominasi CV (imprecision), ${byReason.both} keduanya.`);
      if (byReason.bias) analisa.push("Bias dominan umumnya berasal: kalibrasi yang tidak sesuai target, pergantian lot reagen/kalibrator tanpa verifikasi, atau degradasi reagen.");
      if (byReason.cv) analisa.push("CV dominan umumnya berasal: teknik pipetting, stabilitas suhu/inkubasi, campuran reagen tidak homogen, atau kondisi optik/mekanik alat yang perlu maintenance.");
    }
    const stdNeeded = perParameter.filter((p) => p.butuhStandardisasi);
    if (stdNeeded.length)
      analisa.push(`Terdapat selisih kinerja antar akun yang signifikan pada ${stdNeeded.length} parameter (${stdNeeded.map((p) => p.parameter).join(", ")}) — gap σ ≥ 1,5 antar laboratorium peserta.`);
    if (!poorLevels.length && !teExceed)
      analisa.push("Seluruh level QC yang direkap berada pada kinerja σ≥3 dan TE ≤ TEa — sistem QC berjalan sesuai goal mutu.");

    if (teExceed)
      capa.push(`SEGERA (prioritas 1): hentikan pelaporan hasil pada ${teExceed} level dengan TE > TEa; lakukan investigasi root cause (kalibrasi ulang, ganti reagen/kalibrator, verifikasi metode) sebelum hasil dirilis.`);
    const poorAcc = perAccount.filter((a) => a.avgSigma !== null && a.avgSigma < 3);
    if (poorAcc.length)
      capa.push(`PERBAIKAN (prioritas 2): akun ${poorAcc.map((a) => a.fullName || a.account).join(", ")} — jalankan kalibrasi ulang + evalorasi Westgard multi-rule, tingkatkan frekuensi QC hingga kinerja pulih.`);
    if (stdNeeded.length)
      capa.push(`STANDARDISASI (prioritas 3): selenggarakan perbandingan antar laboratorium (training/SOP seragam) untuk parameter: ${stdNeeded.map((p) => p.parameter).join(", ")}.`);
    const marginalCount = dist["Marginal"];
    if (marginalCount)
      capa.push(`PEMANTAUAN (prioritas 4): ${marginalCount} level marginal (3≤σ<4) — gunakan aturan Westgard multi-rule (1-3s/2-2s/R-4s/4-1s) dan pertimbangkan penambahan jumlah pengukuran QC harian.`);
    const goodCount = dist["World Class"] + dist["Excellent"];
    if (goodCount)
      capa.push(`PERTAHANKAN: ${goodCount} level dengan σ≥5 — dokumentasikan sebagai praktik baik (best practice) referensi akun lain.`);
    capa.push("PREVENTIF: jadwalkan maintenance alat rutin, verifikasi setiap lot reagen baru dengan QC before-use, dan review kembali penetapan TEa minimal 1×/tahun.");

    return {
      ok: true,
      analisa: {
        ringkasan: { akun: accNames.length, parameter: paramNames.length, totalLevel: total, avgSigma: nSigma ? parseFloat((sumSigma / nSigma).toFixed(2)) : null, avgCV: nCV ? parseFloat((sumCV / nCV).toFixed(2)) : null, teExceed },
        distribusi: dist,
        perAccount,
        perParameter,
        interpretasi,
        analisa,
        capa,
        dibuatPada: new Date().toISOString(),
      },
    };
  } catch (e: any) {
    return { ok: false, msg: e?.message || String(e) };
  }
}

// ------------------------------------------------------------
// pgKirim — kirim laporan ke akun terpilih (superadmin)
// args[0] = { title, filter, rows, analisa, recipients[], zrows? }
// Snapshot lengkap disimpan di payloadJson; database penerima hanya
// referensi (tanpa duplikasi isi laporan).
// v9.43 — zrows opsional: rekap Z-score ISO 13528 (PG Z-score IQC)
// disertakan di payload bila dikirim dari submenu tsb; laporan dari
// submenu lain tidak berubah (tanpa zrows).
// ------------------------------------------------------------
export async function pgKirim(args: any[], session: SessionData | null) {
  if (!isRealSuperadmin(session)) return deny();
  try {
    const p = args[0] || {};
    const rows: PgRow[] = Array.isArray(p.rows) ? p.rows : [];
    const analisa = p.analisa || null;
    const filter = p.filter || {};
    const recipients: string[] = Array.isArray(p.recipients) ? Array.from(new Set(p.recipients.map(String).filter(Boolean))) : [];
    if (!rows.length) return { ok: false, msg: "Tidak ada data tabulasi untuk dikirim" };
    if (!recipients.length) return { ok: false, msg: "Pilih minimal 1 akun penerima" };

    const exist = await db.users.findMany({ where: { username: { in: recipients } }, select: { username: true } });
    const valid = exist.map((u: any) => u.username);
    if (!valid.length) return { ok: false, msg: "Akun penerima tidak ditemukan" };

    const accNames = Array.from(new Set(rows.map((r) => r.account)));
    const paramNames = Array.from(new Set(rows.map((r) => r.parameter)));
    const summary = {
      akun: accNames.length,
      parameter: paramNames.length,
      baris: rows.length,
      periode: (filter.startDate || "awal") + " s/d " + (filter.endDate || "sekarang"),
      penerima: valid.length,
      denganAnalisa: !!analisa,
    };

    const id = genId("PGR");
    const payload: any = { rows, analisa };
    if (Array.isArray(p.zrows) && p.zrows.length) payload.zrows = p.zrows;
    await db.pgReport.create({
      data: {
        id,
        ownerUsername: String(session!.username),
        title: String(p.title || "Laporan Tabulasi QC Analisis — Peer Group").slice(0, 180),
        filtersJson: JSON.stringify(filter),
        summaryJson: JSON.stringify(summary),
        payloadJson: JSON.stringify(payload),
        active: true,
        recipients: {
          create: valid.map((u) => ({ id: genId("PGRR"), username: u })),
        },
      },
    });
    return { ok: true, id, sentTo: valid.length };
  } catch (e: any) {
    return { ok: false, msg: e?.message || String(e) };
  }
}

// ------------------------------------------------------------
// pgReportsSent — daftar laporan terkirim (superadmin)
// ------------------------------------------------------------
export async function pgReportsSent(args: any[], session: SessionData | null) {
  if (!isRealSuperadmin(session)) return deny();
  try {
    const rows = await db.pgReport.findMany({
      where: { ownerUsername: String(session!.username) },
      orderBy: { sentAt: "desc" },
      include: { recipients: { select: { username: true, readAt: true } } },
    });
    return {
      ok: true,
      data: rows.map((r: any) => ({
        id: r.id,
        title: r.title,
        sentAt: r.sentAt ? r.sentAt.toISOString() : null,
        active: r.active,
        summary: safeParse(r.summaryJson),
        recipients: (r.recipients || []).map((x: any) => ({ username: x.username, read: !!x.readAt })),
      })),
    };
  } catch (e: any) {
    return { ok: false, msg: e?.message || String(e) };
  }
}

// ------------------------------------------------------------
// pgReportDetail — payload penuh utk preview superadmin (nama asli)
// args[0] = id
// ------------------------------------------------------------
export async function pgReportDetail(args: any[], session: SessionData | null) {
  if (!isRealSuperadmin(session)) return deny();
  try {
    const id = String(args?.[0] || "");
    const r = await db.pgReport.findFirst({ where: { id, ownerUsername: String(session!.username) } });
    if (!r) return { ok: false, msg: "Laporan tidak ditemukan" };
    const payload = safeParse(r.payloadJson) || {};
    return {
      ok: true,
      report: { id: r.id, title: r.title, sentAt: r.sentAt ? r.sentAt.toISOString() : null, active: r.active, filter: safeParse(r.filtersJson) },
      rows: payload.rows || [],
      zrows: Array.isArray(payload.zrows) ? payload.zrows : [], // v9.43 — rekap Z-score (PG Z-score IQC), kosong utk laporan lama
      analisa: payload.analisa || null,
    };
  } catch (e: any) {
    return { ok: false, msg: e?.message || String(e) };
  }
}

// ------------------------------------------------------------
// pgReportToggle — tombol ON/OFF (superadmin): OFF menyembunyikan
// laporan dari semua penerima (menu "Laporan PG Analisis" hilang).
// args[0] = { id, active }
// ------------------------------------------------------------
export async function pgReportToggle(args: any[], session: SessionData | null) {
  if (!isRealSuperadmin(session)) return deny();
  try {
    const { id, active } = args[0] || {};
    const r = await db.pgReport.findFirst({ where: { id: String(id || ""), ownerUsername: String(session!.username) } });
    if (!r) return { ok: false, msg: "Laporan tidak ditemukan" };
    await db.pgReport.update({ where: { id: r.id }, data: { active: !!active } });
    return { ok: true, id: r.id, active: !!active };
  } catch (e: any) {
    return { ok: false, msg: e?.message || String(e) };
  }
}

// ------------------------------------------------------------
// pgReportDelete — hapus laporan (superadmin, cascade penerima)
// args[0] = id
// ------------------------------------------------------------
export async function pgReportDelete(args: any[], session: SessionData | null) {
  if (!isRealSuperadmin(session)) return deny();
  try {
    const id = String(args?.[0] || "");
    const r = await db.pgReport.findFirst({ where: { id, ownerUsername: String(session!.username) } });
    if (!r) return { ok: false, msg: "Laporan tidak ditemukan" };
    await db.pgReport.delete({ where: { id: r.id } });
    return { ok: true };
  } catch (e: any) {
    return { ok: false, msg: e?.message || String(e) };
  }
}

// ------------------------------------------------------------
// pgInbox — daftar laporan aktif utk akun sesi (semua role)
// Tenant: penerima = session.activeUsername || session.username
// (superadmin View-As ikut melihat inbox akun yang disimulasikan).
// ------------------------------------------------------------
export async function pgInbox(args: any[], session: SessionData | null) {
  if (!session) return { ok: false, msg: "Unauthorized" };
  try {
    const me = activeUser(session);
    if (!me) return { ok: true, data: [], unread: 0 };
    const recips = await db.pgReportRecipient.findMany({
      where: { username: me },
      include: { report: { select: { id: true, title: true, sentAt: true, active: true, summaryJson: true } } },
      orderBy: { id: "desc" },
    });
    const data = recips
      .filter((x: any) => x.report && x.report.active)
      .map((x: any) => ({
        id: x.report.id,
        title: x.report.title,
        sentAt: x.report.sentAt ? x.report.sentAt.toISOString() : null,
        summary: safeParse(x.report.summaryJson),
        read: !!x.readAt,
      }));
    return { ok: true, data, unread: data.filter((d: any) => !d.read).length };
  } catch (e: any) {
    return { ok: false, msg: e?.message || String(e) };
  }
}

// ------------------------------------------------------------
// pgInboxReport — buka laporan di inbox (penerima)
// Nama akun LAIN dianonimkan (Peer 1, Peer 2, …) — statistik semua
// akun tetap tampil; hanya akun sendiri yang terlihat namanya.
// Membuka laporan menandai readAt (blink berhenti).
// args[0] = id
// ------------------------------------------------------------
export async function pgInboxReport(args: any[], session: SessionData | null) {
  if (!session) return { ok: false, msg: "Unauthorized" };
  try {
    const id = String(args?.[0] || "");
    const me = activeUser(session);
    const r = await db.pgReport.findUnique({ where: { id }, include: { recipients: true } });
    if (!r) return { ok: false, msg: "Laporan tidak ditemukan" };
    const asRecipient = r.recipients.find((x: any) => x.username === me);
    const isSA = isRealSuperadmin(session);
    if (!r.active && !isSA) return { ok: false, msg: "Laporan sudah dimatikan oleh superadmin" };
    if (!asRecipient && !isSA) return { ok: false, msg: "Akses ditolak — Anda bukan penerima laporan ini" };

    const payload = safeParse(r.payloadJson) || {};
    const rows: PgRow[] = payload.rows || [];
    // Anonimisasi: akun lain → Peer 1..N (urut abjad, stabil)
    const others = Array.from(new Set(rows.map((x) => x.account))).filter((a) => a !== me).sort((a, b) => a.localeCompare(b));
    const labelMap = new Map<string, string>();
    others.forEach((a, i) => labelMap.set(a, "Peer " + (i + 1)));
    const anonRows = rows.map((x) => {
      if (x.account === me) return { ...x, account: x.account + " (Anda)", isOwn: true };
      // Nama asli akun lain dihapus total (tenant) — hanya label Peer N
      return { ...x, account: labelMap.get(x.account) || "Peer", fullName: "", isOwn: false };
    });
    // Analisa ikut dianonimkan (termasuk teks yang menyebut nama akun)
    const analisa = payload.analisa ? anonymizeAnalisa(payload.analisa, me, labelMap, rows) : null;

    // v9.43 — rekap Z-score ikut dianonimkan (PG Z-score IQC)
    const anonZrows = Array.isArray(payload.zrows)
      ? (payload.zrows as any[]).map((z) => {
          if (z.account === me) return { ...z, account: z.account + " (Anda)", isOwn: true };
          return { ...z, account: labelMap.get(z.account) || "Peer", fullName: "", isOwn: false };
        })
      : [];

    if (asRecipient && !asRecipient.readAt) {
      await db.pgReportRecipient.update({ where: { id: asRecipient.id }, data: { readAt: new Date() } });
    }
    return {
      ok: true,
      report: { id: r.id, title: r.title, sentAt: r.sentAt ? r.sentAt.toISOString() : null, active: r.active },
      filter: safeParse(r.filtersJson),
      rows: anonRows,
      zrows: anonZrows, // v9.43
      analisa,
      me,
      isSuperadminPreview: isSA && !asRecipient,
    };
  } catch (e: any) {
    return { ok: false, msg: e?.message || String(e) };
  }
}

function anonymizeAnalisa(a: any, me: string, labelMap: Map<string, string>, rows: PgRow[]): any {
  const lbl = (acc: string) => (acc === me ? acc + " (Anda)" : labelMap.get(acc) || "Peer");
  const out = JSON.parse(JSON.stringify(a));
  if (Array.isArray(out.perAccount)) {
    out.perAccount = out.perAccount.map((p: any) => ({ ...p, account: labelMap.has(p.account) || p.account === me ? lbl(p.account) : p.account, fullName: p.account === me ? p.fullName : "" }));
  }
  if (Array.isArray(out.perParameter)) {
    out.perParameter = out.perParameter.map((p: any) => ({
      ...p,
      terbaik: p.terbaik ? { ...p.terbaik, account: lbl(p.terbaik.account) } : p.terbaik,
      terendah: p.terendah ? { ...p.terendah, account: lbl(p.terendah.account) } : p.terendah,
    }));
  }
  // Teks bebas (interpretasi/analisa/capa) boleh saja menyebut nama akun —
  // SEMUA kemunculan nama asli (username & fullName) akun lain diganti label Peer.
  const reps: { from: string; to: string }[] = [];
  const fullNameMap = new Map<string, string>();
  rows.forEach((x) => { if (x.account && !fullNameMap.has(x.account)) fullNameMap.set(x.account, String(x.fullName || "")); });
  labelMap.forEach((lblVal, acc) => {
    const fn = (fullNameMap.get(acc) || "").trim();
    if (fn && fn.toLowerCase() !== acc.toLowerCase()) reps.push({ from: fn, to: lblVal });
    reps.push({ from: acc, to: lblVal });
  });
  reps.sort((x, y) => y.from.length - x.from.length); // nama terpanjang dulu (hindari ganti parsial)
  const scrub = (s: string): string => {
    let t = String(s);
    let lower = t.toLowerCase();
    for (const r of reps) {
      if (!r.from) continue;
      let idx = lower.indexOf(r.from.toLowerCase());
      while (idx >= 0) {
        t = t.slice(0, idx) + r.to + t.slice(idx + r.from.length);
        lower = t.toLowerCase();
        idx = lower.indexOf(r.from.toLowerCase(), idx + r.to.length);
      }
    }
    return t;
  };
  ["interpretasi", "analisa", "capa"].forEach((k) => {
    if (Array.isArray(out[k])) out[k] = out[k].map((s: any) => scrub(s));
  });
  if (out.ringkasan) delete out.ringkasan; // ringkasan tak memuat nama, hapus utk aman
  return out;
}

// ------------------------------------------------------------
// pgUnreadCount — polling ringan utk blink merah menu
// ------------------------------------------------------------
export async function pgUnreadCount(args: any[], session: SessionData | null) {
  if (!session) return { ok: false, msg: "Unauthorized" };
  try {
    const me = activeUser(session);
    if (!me) return { ok: true, total: 0, unread: 0 };
    const recips = await db.pgReportRecipient.findMany({
      where: { username: me },
      select: { readAt: true, report: { select: { active: true } } },
    });
    const active = recips.filter((x: any) => x.report && x.report.active);
    return { ok: true, total: active.length, unread: active.filter((x: any) => !x.readAt).length };
  } catch (e: any) {
    return { ok: false, msg: e?.message || String(e) };
  }
}

function safeParse(s: string | null): any {
  if (!s) return null;
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
}

// ============================================================
// v9.39 — pgAnalytics: dashboard "PG QC Performance Analytics"
//
// Menghitung 4 metrik kinerja per akun dari data tabulasi peer group
// (formula statistik identik dengan menu Tabulasi Rekap):
//   • Sigma  — rata-rata Sigma metric (TEa−|Bias|)/CV per akun
//   • CV     — rata-rata CV% (imprecision) per akun
//   • TE     — rata-rata Total Error |Bias|+1.65·CV, dinormalisasi ke TEa
//   • Bias%  — rata-rata |Bias| semua level (L1–L3), dinormalisasi ke TEa
// Kriteria zona kinerja (hijau/kuning/merah):
//   Sigma : hijau σ≥6 · kuning 4≤σ<6 · merah σ<4
//   CV    : hijau ≤2% · kuning 2–5%  · merah >5%
//   TE    : hijau TE≤TEa · kuning ≤1.2×TEa · merah >1.2×TEa
//   Bias% : hijau |Bias|≤25% TEa · kuning 25–50% TEa · merah >50% TEa
// ============================================================

function zoneOf(kind: string, v: number | null): "green" | "yellow" | "red" | "none" {
  if (v === null || v === undefined || isNaN(v)) return "none";
  if (kind === "sigma") {
    if (v >= 6) return "green";
    if (v >= 4) return "yellow";
    return "red";
  }
  if (kind === "cv") {
    if (v <= 2) return "green";
    if (v <= 5) return "yellow";
    return "red";
  }
  if (kind === "te") {
    if (v <= 1) return "green";
    if (v <= 1.2) return "yellow";
    return "red";
  }
  if (kind === "bias") {
    if (v <= 25) return "green";
    if (v <= 50) return "yellow";
    return "red";
  }
  return "none";
}

function fmtN(x: number | null | undefined, d = 2): string {
  if (x === null || x === undefined || isNaN(x)) return "-";
  return x.toFixed(d);
}

export async function pgAnalytics(args: any[], session: SessionData | null) {
  if (!isRealSuperadmin(session)) return deny();
  try {
    const res: any = await pgTabulasi(args, session);
    if (!res || !res.ok) return res || { ok: false, msg: "Gagal menghitung tabulasi" };
    const rows: PgRow[] = res.rows || [];

    // ---- kumpulkan poin level (rata-rata SEMUA level L1–L3 per akun) ----
    type Pt = { account: string; fullName: string; parameter: string; noLot: string; namaAlat: string; lv: string; s: any };
    const pts: Pt[] = [];
    for (const r of rows) {
      for (const lv of ["L1", "L2", "L3"]) {
        const s = r.stats && r.stats[lv];
        if (!s) continue;
        pts.push({ account: r.account, fullName: r.fullName, parameter: r.parameter, noLot: r.noLot, namaAlat: r.namaAlat, lv, s });
      }
    }
    // jumlah kombinasi (parameter×lot×level) yang dimiliki ≥2 akun (informasi KPI)
    const peerGroups = new Map<string, number>();
    for (const p of pts) {
      const key = p.parameter + "|" + p.noLot + "|" + p.lv;
      peerGroups.set(key, (peerGroups.get(key) || 0) + 1);
    }
    let peerCombos = 0;
    peerGroups.forEach((n) => {
      if (n >= 2) peerCombos++;
    });

    // ---- agregasi per akun ----
    const accNames = Array.from(new Set(pts.map((p) => p.account))).sort((a, b) => a.localeCompare(b));
    const accounts: any[] = [];
    for (const acc of accNames) {
      const ap = pts.filter((p) => p.account === acc);
      const sigmas: number[] = [];
      const cvs: number[] = [];
      const biases: number[] = [];
      let teSum = 0,
        teN = 0,
        teaSum = 0,
        teaN = 0,
        teExceed = 0;
      let worstSigma: { v: number; parameter: string; lv: string; lot: string; cause: string } | null = null;
      let worstCv: { v: number; parameter: string; lv: string; lot: string } | null = null;
      for (const p of ap) {
        const cv = parseNumSafe(p.s.cv);
        const tea = parseNumSafe(p.s.tea);
        const te = parseNumSafe(p.s.te);
        const bias = parseNumSafe(p.s.bias);
        const sig = p.s.sigma === null || p.s.sigma === undefined ? null : parseFloat(p.s.sigma);
        if (bias !== null) biases.push(bias); // v9.40 — kumpulkan bias semua level
        if (cv !== null) {
          cvs.push(cv);
          if (!worstCv || cv > worstCv.v) worstCv = { v: cv, parameter: p.parameter, lv: p.lv, lot: p.noLot };
        }
        if (te !== null) {
          teSum += te;
          teN++;
        }
        if (tea !== null) {
          teaSum += tea;
          teaN++;
        }
        if (te !== null && tea !== null && tea > 0 && te > tea) teExceed++;
        if (sig !== null && !isNaN(sig)) {
          sigmas.push(sig);
          if (!worstSigma || sig < worstSigma.v) {
            let cause = "kombinasi";
            if (tea !== null && tea > 0) {
              const b = Math.abs(bias || 0);
              const c = cv || 0;
              const bD = b > tea * 0.25;
              const cD = c > tea * 0.25;
              if (bD && cD) cause = "kombinasi bias & imprecision";
              else if (bD) cause = "bias (inaccuracy)";
              else if (cD) cause = "imprecision";
            }
            worstSigma = { v: sig, parameter: p.parameter, lv: p.lv, lot: p.noLot, cause };
          }
        }
      }
      const totalLevels = ap.length;
      const sigmaAvg = sigmas.length ? sigmas.reduce((a, b) => a + b, 0) / sigmas.length : null;
      const cvAvg = cvs.length ? cvs.reduce((a, b) => a + b, 0) / cvs.length : null;
      const teAvg = teN ? teSum / teN : null;
      const teaAvg = teaN ? teaSum / teaN : null;
      const teRatio = teAvg !== null && teaAvg !== null && teaAvg > 0 ? teAvg / teaAvg : null;
      // v9.40 — Bias% Position: rata-rata SEMUA level (L1–L3); nilai plotted =
      // |Bias| rata-rata dinormalisasi ke TEa (% dari TEa); biasAvg = signed utk tooltip
      const biasAvg = biases.length ? biases.reduce((a, b) => a + b, 0) / biases.length : null;
      const biasAbsAvg = biases.length ? biases.reduce((a, b) => a + Math.abs(b), 0) / biases.length : null;
      const biasRatio = biasAbsAvg !== null && teaAvg !== null && teaAvg > 0 ? (biasAbsAvg / teaAvg) * 100 : null;
      const zS = zoneOf("sigma", sigmaAvg);
      const zC = zoneOf("cv", cvAvg);
      const zT = zoneOf("te", teRatio);
      const zB = zoneOf("bias", biasRatio);
      const zones = { sigma: zS, cv: zC, te: zT, bias: zB };
      const reds = [zS, zC, zT, zB].filter((z) => z === "red").length;
      const yellows = [zS, zC, zT, zB].filter((z) => z === "yellow").length;
      const status =
        totalLevels === 0 ? "Tanpa Data" : reds > 0 ? "Kritis" : yellows > 0 ? "Waspada" : "Baik";
      const goodN = sigmas.filter((s) => s >= 4).length;
      accounts.push({
        account: acc,
        fullName: ap[0] ? ap[0].fullName : acc,
        totalLevels,
        sigmaAvg: sigmaAvg === null ? null : parseFloat(sigmaAvg.toFixed(2)),
        sigmaMin: sigmas.length ? parseFloat(Math.min.apply(null, sigmas).toFixed(2)) : null,
        sigmaMax: sigmas.length ? parseFloat(Math.max.apply(null, sigmas).toFixed(2)) : null,
        sigmaWorst: worstSigma,
        cvAvg: cvAvg === null ? null : parseFloat(cvAvg.toFixed(2)),
        cvMax: cvs.length ? parseFloat(Math.max.apply(null, cvs).toFixed(2)) : null,
        cvWorst: worstCv,
        teAvg: teAvg === null ? null : parseFloat(teAvg.toFixed(2)),
        teaAvg: teaAvg === null ? null : parseFloat(teaAvg.toFixed(2)),
        teRatio: teRatio === null ? null : parseFloat((teRatio * 100).toFixed(1)),
        teExceed,
        biasAvg: biasAvg === null ? null : parseFloat(biasAvg.toFixed(2)),
        biasAbsAvg: biasAbsAvg === null ? null : parseFloat(biasAbsAvg.toFixed(2)),
        biasRatio: biasRatio === null ? null : parseFloat(biasRatio.toFixed(1)),
        goodPct: totalLevels ? Math.round((goodN / totalLevels) * 100) : 0,
        zones,
        status,
      });
    }

    return {
      ok: true,
      rows, // dipakai tombol Kirim Laporan (payload identik dgn Tabulasi)
      accounts,
      meta: {
        akun: accounts.length,
        parameter: Array.from(new Set(rows.map((r) => r.parameter))).length,
        totalLevels: pts.length,
        peerCombos,
        periode: (res.filter && res.filter.startDate ? res.filter.startDate : "awal") + " s/d " + (res.filter && res.filter.endDate ? res.filter.endDate : "sekarang"),
      },
      zones: {
        sigma: { green: "σ ≥ 6", yellow: "4 ≤ σ < 6", red: "σ < 4" },
        cv: { green: "CV ≤ 2%", yellow: "2% < CV ≤ 5%", red: "CV > 5%" },
        te: { green: "TE ≤ TEa", yellow: "TE ≤ 1.2×TEa", red: "TE > 1.2×TEa" },
        bias: { green: "|Bias| ≤ 25% TEa", yellow: "25–50% TEa", red: "|Bias| > 50% TEa" },
      },
      filter: res.filter,
      generatedAt: new Date().toISOString(),
    };
  } catch (e: any) {
    return { ok: false, msg: e?.message || String(e) };
  }
}

// ------------------------------------------------------------
// v9.39 — pgAnalyticsAnalisa: interpretasi + analisa + CAPA per grafik
// args[0] = { accounts: hasil pgAnalytics.accounts, filter }
// Rule-based deterministik (superadmin — nama akun boleh tampil).
// ------------------------------------------------------------
export async function pgAnalyticsAnalisa(args: any[], session: SessionData | null) {
  if (!isRealSuperadmin(session)) return deny();
  try {
    const accs: any[] = Array.isArray(args?.[0]?.accounts) ? args[0].accounts : [];
    if (!accs.length) return { ok: false, msg: "Tampilkan data terlebih dulu" };
    const nm = (a: any) => a.fullName || a.account;

    // ---------- 1) SIGMA ----------
    const gS = accs.filter((a) => a.zones && a.zones.sigma === "green");
    const yS = accs.filter((a) => a.zones && a.zones.sigma === "yellow");
    const rS = accs.filter((a) => a.zones && a.zones.sigma === "red");
    const rankedS = accs.filter((a) => a.sigmaAvg !== null).sort((a, b) => b.sigmaAvg - a.sigmaAvg);
    const si: string[] = [];
    const sa: string[] = [];
    const sc: string[] = [];
    const sigAll = accs.filter((a) => a.sigmaAvg !== null);
    if (!sigAll.length) {
      si.push("Tidak ada data Sigma yang dapat dihitung (TEa atau CV tidak tersedia pada kombinasi filter ini).");
    } else {
      const avg = sigAll.reduce((a, b) => a + b.sigmaAvg, 0) / sigAll.length;
      si.push(`Rata-rata Sigma metric keseluruhan: ${avg.toFixed(2)} dari ${sigAll.length} akun yang dievaluasi.`);
      si.push(`Distribusi zona kinerja sigma: ${gS.length} akun hijau (σ≥6), ${yS.length} akun kuning (4≤σ<6), ${rS.length} akun merah (σ<4).`);
      if (rankedS.length >= 2) {
        const top = rankedS[0];
        const bot = rankedS[rankedS.length - 1];
        si.push(`Kinerja sigma tertinggi: ${nm(top)} (σ ${fmtN(top.sigmaAvg)}); terendah: ${nm(bot)} (σ ${fmtN(bot.sigmaAvg)}); gap ${fmtN(top.sigmaAvg - bot.sigmaAvg)}.`);
      }
      const gap = rankedS.length >= 2 ? rankedS[0].sigmaAvg - rankedS[rankedS.length - 1].sigmaAvg : 0;
      if (gap >= 1.5)
        sa.push(`Selisih kinerja sigma antar akun signifikan (gap ${gap.toFixed(2)} ≥ 1,5) — terindikasi perbedaan praktik operasional (kalibrasi, penanganan reagen, atau teknik analisis) yang perlu distandardisasi.`);
      for (const a of rS.slice(0, 6)) {
        const w = a.sigmaWorst;
        sa.push(`${nm(a)} berada di zona merah (σ rata-rata ${fmtN(a.sigmaAvg)}; minimum ${fmtN(a.sigmaMin)})${w ? ` — level terlemah: ${w.parameter} ${w.lv} lot ${w.lot} (σ ${fmtN(w.v)}), dominan ${w.cause}` : ""}.`);
      }
      if (!rS.length && yS.length)
        sa.push("Tidak ada akun di zona merah; namun akun zona kuning (4≤σ<6) masih rentan terhadap gangguan analitik — margin terhadap goal mutu tipis.");
      if (!rS.length && !yS.length && gS.length)
        sa.push("Seluruh akun mencapai σ≥6 (world class) — kapabilitas analitik sangat baik terhadap goal mutu yang ditetapkan.");
      if (rS.length)
        sc.push(`SEGERA (prioritas 1): ${rS.map(nm).join(", ")} — hentikan sementara pelaporan hasil pada level dengan TE>TEa, lakukan kalibrasi ulang terhadap nilai target lot, investigasi root cause (reagen/kalibrator, kondisi alat), verifikasi metode, lalu evaluasi ulang sigma sebelum hasil dirilis.`);
      if (yS.length)
        sc.push(`PERBAIKAN (prioritas 2): ${yS.map(nm).join(", ")} — tingkatkan frekuensi QC, terapkan Westgard multi-rule (1-3s/2-2s/R-4s/4-1s), dan optimalkan kalibrasi untuk menaikkan sigma ke zona hijau (σ≥6).`);
      if (gS.length)
        sc.push(`PERTAHANKAN (prioritas 3): ${gS.map(nm).join(", ")} — dokumentasikan praktik baik (best practice) sebagai referensi standardisasi akun lain.`);
      sc.push("PREVENTIF: tinjau penetapan TEa minimal 1×/tahun dan verifikasi setiap pergantian lot reagen/kalibrator dengan QC sebelum digunakan.");
    }

    // ---------- 2) CV ----------
    const gC = accs.filter((a) => a.zones && a.zones.cv === "green");
    const yC = accs.filter((a) => a.zones && a.zones.cv === "yellow");
    const rC = accs.filter((a) => a.zones && a.zones.cv === "red");
    const rankedC = accs.filter((a) => a.cvAvg !== null).sort((a, b) => a.cvAvg - b.cvAvg);
    const ci: string[] = [];
    const ca: string[] = [];
    const cc: string[] = [];
    const cvAll = accs.filter((a) => a.cvAvg !== null);
    if (!cvAll.length) {
      ci.push("Tidak ada data CV yang dapat dihitung pada kombinasi filter ini.");
    } else {
      const avg = cvAll.reduce((a, b) => a + b.cvAvg, 0) / cvAll.length;
      ci.push(`Rata-rata CV (imprecision) keseluruhan: ${avg.toFixed(2)}% dari ${cvAll.length} akun.`);
      ci.push(`Distribusi zona CV: ${gC.length} akun hijau (≤2%), ${yC.length} kuning (2–5%), ${rC.length} merah (>5%).`);
      if (rankedC.length) ci.push(`Presisi terbaik: ${nm(rankedC[0])} (CV ${fmtN(rankedC[0].cvAvg)}%); terendah: ${nm(rankedC[rankedC.length - 1])} (CV ${fmtN(rankedC[rankedC.length - 1].cvAvg)}%).`);
      for (const a of rC.slice(0, 6)) {
        const w = a.cvWorst;
        ca.push(`${nm(a)} di zona merah (CV rata-rata ${fmtN(a.cvAvg)}%, maksimum ${fmtN(a.cvMax)}%)${w ? ` — imprecision terburuk: ${w.parameter} ${w.lv} lot ${w.lot} (CV ${fmtN(w.v)}%)` : ""}. Indikasi masalah presisi sistematis: variabilitas alat/reagen/teknik pipetting.`);
      }
      if (!rC.length && yC.length)
        ca.push("Semua akun CV ≤5%; akun zona kuning (CV 2–5%) masih perlu optimasi presisi untuk menopang sigma metric yang lebih tinggi.");
      if (!rC.length && !yC.length)
        ca.push("Seluruh akun mencapai CV ≤2% — imprecision terkendali sangat baik di seluruh peer group.");
      if (rC.length)
        cc.push(`SEGERA (prioritas 1): ${rC.map(nm).join(", ")} — jalankan maintenance alat (optik, mekanik, inkubasi/suhu), cek homogenitas & daya simpan reagen, evaluasi teknik pipetting/dispensasi, dan ulangi kalibrasi; pantau CV harian hingga ≤ TEa/3.`);
      if (yC.length)
        cc.push(`PERBAIKAN (prioritas 2): ${yC.map(nm).join(", ")} — gunakan Westgard multi-rule, tingkatkan jumlah pengukuran QC harian (n), dan stabilkan suhu inkubasi/mixing reagen.`);
      if (gC.length)
        cc.push(`PERTAHANKAN: ${gC.map(nm).join(", ")} — presisi terbaik peer group; jadikan acuan SOP & jadwal maintenance.`);
      cc.push("PREVENTIF: jadwalkan maintenance preventif rutin sesuai rekomendasi pabrikan dan verifikasi performa alat setelah servis (calibration verification).");
    }

    // ---------- 3) TE ----------
    const gT = accs.filter((a) => a.zones && a.zones.te === "green");
    const yT = accs.filter((a) => a.zones && a.zones.te === "yellow");
    const rT = accs.filter((a) => a.zones && a.zones.te === "red");
    const ti: string[] = [];
    const ta: string[] = [];
    const tc: string[] = [];
    const teAll = accs.filter((a) => a.teRatio !== null);
    if (!teAll.length) {
      ti.push("Tidak ada data TE/TEa yang dapat dihitung (TEa tidak tersedia pada lot terpilih).");
    } else {
      const avg = teAll.reduce((a, b) => a + (b.teRatio || 0), 0) / teAll.length;
      ci.push(`Rata-rata Total Error relatif terhadap TEa: ${avg.toFixed(1)}% dari TEa pada ${teAll.length} akun.`);
      ci.push(`Distribusi zona TE: ${gT.length} akun hijau (TE≤TEa), ${yT.length} kuning (TE≤1.2×TEa), ${rT.length} merah (TE>1.2×TEa).`);
      const exceed = accs.reduce((a, b) => a + (b.teExceed || 0), 0);
      if (exceed) ti.push(`Terdapat ${exceed} kombinasi level QC dengan TE melebihi TEa — goal mutu belum tercapai pada level tersebut.`);
      else ti.push("Seluruh level QC yang dievaluasi mencapai TE ≤ TEa — goal mutu terpenuhi.");
      for (const a of rT.slice(0, 6))
        ta.push(`${nm(a)} di zona merah (TE ${fmtN(a.teAvg)}% vs TEa ${fmtN(a.teaAvg)}%; ${a.teExceed} level melewati TEa) — kombinasi bias & imprecision menggerus kapabilitas; hasil pada level bermasalah tidak memenuhi requirement mutu.`);
      if (!rT.length && yT.length)
        ta.push("Tidak ada akun melewati 1.2×TEa, namun akun zona kuning (TE>TEa) sudah melanggar goal mutu dasar — perlu tindakan sebelum memburuk.");
      if (!rT.length && !yT.length)
        ta.push("TE seluruh akun berada di bawah TEa — sistem pengukuran berjalan sesuai goal mutu laboratorium.");
      if (rT.length)
        tc.push(`SEGERA (prioritas 1): ${rT.map(nm).join(", ")} — hentikan pelaporan hasil pada level dengan TE>TEa sampai tindakan koreksi selesai: kalibrasi ulang, ganti reagen/kalibrator bila degradasi, verifikasi metode, dan evaluasi komutabilitas lot QC.`);
      if (yT.length)
        tc.push(`PERBAIKAN (prioritas 2): ${yT.map(nm).join(", ")} — turunkan TE (prioritaskan komponen terbesar: bias atau CV) hingga kembali ≤ TEa sebelum periode berikutnya.`);
      if (gT.length)
        tc.push(`PERTAHANKAN: ${gT.map(nm).join(", ")} — TE terkendali di bawah TEa; pertahankan frekuensi QC dan kalibrasi berkala.`);
      tc.push("PREVENTIF: definisikan TEa berbasis biologis (desirable quality goal) dan pantau TE dengan chart Levey-Jennings harian agar pelanggaran terdeteksi dini.");
    }

    // ---------- 4) Bias% (v9.40 — menggantikan SD/SDI) ----------
    const gD = accs.filter((a) => a.zones && a.zones.bias === "green");
    const yD = accs.filter((a) => a.zones && a.zones.bias === "yellow");
    const rD = accs.filter((a) => a.zones && a.zones.bias === "red");
    const di: string[] = [];
    const da: string[] = [];
    const dc: string[] = [];
    const biasAll = accs.filter((a) => a.biasRatio !== null);
    if (!biasAll.length) {
      di.push("Bias% relatif TEa tidak dapat dihitung — TEa tidak tersedia pada lot/parameter terpilih.");
      da.push("Lengkapi nilai TEa pada lot QC yang dipakai agar posisi inaccuracy tiap akun dapat dibandingkan.");
    } else {
      const rankedD = biasAll.slice().sort((a, b) => (b.biasRatio || 0) - (a.biasRatio || 0));
      const avgB = biasAll.reduce((s, a) => s + (a.biasRatio || 0), 0) / biasAll.length;
      di.push(`Rata-rata |Bias| keseluruhan: ${avgB.toFixed(1)}% dari TEa pada ${biasAll.length} akun (dihitung dari rata-rata SEMUA level QC L1–L3 tiap akun).`);
      di.push(`Distribusi zona Bias%: ${gD.length} akun hijau (|Bias| ≤ 25% TEa), ${yD.length} kuning (25–50% TEa), ${rD.length} merah (> 50% TEa).`);
      const dev = rankedD[0];
      di.push(`Inaccuracy paling tinggi: ${nm(dev)} (|Bias| rata-rata ${fmtN(dev.biasAbsAvg)}% = ${fmtN(dev.biasRatio, 1)}% dari TEa; bias bertanda ${fmtN(dev.biasAvg)}%).`);
      for (const a of rD.slice(0, 6))
        da.push(`${nm(a)} di zona merah (|Bias| rata-rata ${fmtN(a.biasAbsAvg)}% = ${fmtN(a.biasRatio, 1)}% dari TEa; bias bertanda ${fmtN(a.biasAvg)}%) — inaccuracy dominan; indikasi kalibrasi bergeser dari nilai target lot, pergantian lot reagen/kalibrator tanpa verifikasi, atau degradasi reagen.`);
      if (!rD.length && yD.length)
        da.push("Tidak ada akun dengan |Bias| > 50% TEa; akun zona kuning (25–50% TEa) masih perlu diturunkan ke arah ≤ 25% TEa agar sigma metric meningkat.");
      if (!rD.length && !yD.length)
        da.push("Seluruh akun mencapai |Bias| ≤ 25% TEa — inaccuracy terkendali sangat baik di seluruh peer group.");
      if (rD.length)
        dc.push(`SEGERA (prioritas 1): ${rD.map(nm).join(", ")} — lakukan kalibrasi ulang terhadap nilai target lot, verifikasi lot reagen/kalibrator baru dengan QC sebelum dipakai, dan periksa komutabilitas material QC.`);
      if (yD.length)
        dc.push(`PERBAIKAN (prioritas 2): ${yD.map(nm).join(", ")} — turunkan bias (kalibrasi terkontrol, review penetapan mean target lot) hingga kembali ≤ 25% TEa.`);
      if (gD.length)
        dc.push(`PERTAHANKAN: ${gD.map(nm).join(", ")} — bias terkendali di bawah 25% TEa; pertahankan disiplin verifikasi lot & kalibrasi berkala.`);
      dc.push("PREVENTIF: verifikasi setiap pergantian lot reagen/kalibrator dengan QC before-use dan tinjau kembali penetapan nilai target lot minimal setiap pergantian lot.");
    }

    return {
      ok: true,
      analisa: {
        sigma: { interpretasi: si, analisa: sa, capa: sc },
        cv: { interpretasi: ci, analisa: ca, capa: cc },
        te: { interpretasi: ti, analisa: ta, capa: tc },
        bias: { interpretasi: di, analisa: da, capa: dc },
        dibuatPada: new Date().toISOString(),
      },
    };
  } catch (e: any) {
    return { ok: false, msg: e?.message || String(e) };
  }
}

// ============================================================
// v9.41 — pgDashboard: "Dashboard PG Analisis" (superadmin only)
//
// Dashboard informasi lengkap peer group lintas akun, dengan filter
// identik dgn Tabulasi QC Analisis (rentang tanggal, akun, parameter,
// alat, lot, metode). Menghasilkan:
//   a) mostUsed  — alat terbanyak digunakan semua akun terdaftar
//                  (jumlah akun pemakai, N data QC, lot, parameter)
//   b) ranking   — ranking KPI kinerja semua alat berdasar CV, Bias,
//                  TE, dan Sigma (skor komposit 0–100; kriteria zona
//                  identik dgn PG QC Performance Analytics):
//                    CV    : 100 poin pada CV≤2%, 0 pada CV≥5%
//                    Bias  : 100 poin pada |Bias|≤25% TEa, 0 pada ≥50%
//                    TE    : 100 poin pada TE≤TEa, 0 pada TE≥1.2×TEa
//                    Sigma : 100 poin pada σ≥6, 0 pada σ≤4
//                  Skor alat = rata-rata komponen yang tersedia.
//   c) accountsInfo — riwayat pendaftaran & persetujuan akun:
//                  createdDate (terdaftar), approvedDate + approvedBy
//                  (disetujui superadmin), status, login terakhir.
//   d) meta + filter — data tabel laporan formal utk cetak/PDF.
// ============================================================

function clamp01(x: number): number {
  return x < 0 ? 0 : x > 1 ? 1 : x;
}

function avgOf(arr: number[], d = 2): number | null {
  if (!arr.length) return null;
  return parseFloat((arr.reduce((a, b) => a + b, 0) / arr.length).toFixed(d));
}

export async function pgDashboard(args: any[], session: SessionData | null) {
  if (!isRealSuperadmin(session)) return deny();
  try {
    const res: any = await pgTabulasi(args, session);
    if (!res || !res.ok) return res || { ok: false, msg: "Gagal menghitung tabulasi" };
    const rows: PgRow[] = res.rows || [];
    const filter = res.filter || args?.[0] || {};

    // ---- (a+b) agregasi per alat (namaAlat) dari semua level QC ----
    type InstAgg = {
      namaAlat: string;
      nQC: number;
      accSet: Set<string>;
      lotSet: Set<string>;
      paramSet: Set<string>;
      cvs: number[];
      biases: number[]; // |bias| per level
      biasRatios: number[]; // |bias|/TEa × 100 per level
      teRatios: number[]; // TE/TEa × 100 per level
      teas: number[];
      sigmas: number[];
    };
    const instMap = new Map<string, InstAgg>();
    for (const r of rows) {
      const alat = String(r.namaAlat || "").trim();
      if (!alat) continue;
      let agg = instMap.get(alat);
      if (!agg) {
        agg = { namaAlat: alat, nQC: 0, accSet: new Set(), lotSet: new Set(), paramSet: new Set(), cvs: [], biases: [], biasRatios: [], teRatios: [], teas: [], sigmas: [] };
        instMap.set(alat, agg);
      }
      agg.nQC += r.nQC || 0;
      agg.accSet.add(r.account);
      if (r.noLot) agg.lotSet.add(r.noLot);
      if (r.parameter) agg.paramSet.add(r.parameter);
      for (const lv of ["L1", "L2", "L3"]) {
        const s = r.stats && r.stats[lv];
        if (!s) continue;
        const cv = parseNumSafe(s.cv);
        const tea = parseNumSafe(s.tea);
        const te = parseNumSafe(s.te);
        const bias = parseNumSafe(s.bias);
        const sig = s.sigma === null || s.sigma === undefined ? null : parseFloat(s.sigma);
        if (cv !== null) agg.cvs.push(cv);
        if (bias !== null) agg.biases.push(Math.abs(bias));
        if (tea !== null) agg.teas.push(tea);
        if (te !== null && tea !== null && tea > 0) agg.teRatios.push((te / tea) * 100);
        if (bias !== null && tea !== null && tea > 0) agg.biasRatios.push((Math.abs(bias) / tea) * 100);
        if (sig !== null && !isNaN(sig)) agg.sigmas.push(sig);
      }
    }

    const instruments = Array.from(instMap.values()).map((g) => {
      const cvAvg = avgOf(g.cvs);
      const biasAbsAvg = avgOf(g.biases);
      const biasRatio = avgOf(g.biasRatios, 1);
      const teRatio = avgOf(g.teRatios, 1);
      const teaAvg = avgOf(g.teas);
      const sigmaAvg = avgOf(g.sigmas);
      // Skor komponen 0–100 (kriteria zona identik dgn pgAnalytics)
      const cvScore = cvAvg === null ? null : Math.round(clamp01((5 - cvAvg) / 3) * 100);
      const biasScore = biasRatio === null ? null : Math.round(clamp01((50 - biasRatio) / 25) * 100);
      const teScore = teRatio === null ? null : Math.round(clamp01((1.2 - teRatio) / 0.2) * 100);
      const sigmaScore = sigmaAvg === null ? null : Math.round(clamp01((sigmaAvg - 4) / 2) * 100);
      const parts = [cvScore, biasScore, teScore, sigmaScore].filter((x) => x !== null) as number[];
      const score = parts.length ? Math.round(parts.reduce((a, b) => a + b, 0) / parts.length) : null;
      const status =
        score === null ? "Tanpa Data" : score >= 75 ? "Sangat Baik" : score >= 50 ? "Baik" : score >= 30 ? "Perlu Perbaikan" : "Kritis";
      return {
        namaAlat: g.namaAlat,
        nQC: g.nQC,
        lots: g.lotSet.size,
        params: g.paramSet.size,
        accounts: Array.from(g.accSet).sort((a, b) => a.localeCompare(b)),
        accountCount: g.accSet.size,
        cvAvg,
        biasAbsAvg,
        biasRatio,
        teRatio,
        teaAvg,
        sigmaAvg,
        scores: { cv: cvScore, bias: biasScore, te: teScore, sigma: sigmaScore },
        score,
        status,
      };
    });

    // Ranking kinerja: skor komposit tertinggi dulu (tanpa data di akhir)
    const ranking = instruments
      .slice()
      .sort((a, b) => (b.score ?? -1) - (a.score ?? -1) || a.namaAlat.localeCompare(b.namaAlat));
    // Alat terbanyak dipakai: jumlah akun pemakai → N data QC
    const mostUsed = instruments
      .slice()
      .sort((a, b) => b.accountCount - a.accountCount || b.nQC - a.nQC || a.namaAlat.localeCompare(b.namaAlat));

    // ---- (c) riwayat pendaftaran & persetujuan akun ----
    const accFilter: any = {};
    if (Array.isArray(filter.accounts) && filter.accounts.length) {
      accFilter.username = { in: (filter.accounts as string[]).map(String) };
    }
    const users = await db.users.findMany({
      where: accFilter,
      select: {
        username: true,
        fullName: true,
        role: true,
        status: true,
        createdDate: true,
        approvedDate: true,
        approvedBy: true,
        lastLogin: true,
      },
      orderBy: { createdDate: "asc" },
    });
    const accountsInfo = users.map((u: any) => ({
      username: u.username,
      fullName: u.fullName,
      role: u.role,
      status: u.status,
      createdDate: u.createdDate ? u.createdDate.toISOString() : null,
      approvedDate: u.approvedDate ? u.approvedDate.toISOString() : null,
      approvedBy: u.approvedBy || null,
      lastLogin: u.lastLogin ? u.lastLogin.toISOString() : null,
    }));

    // ---- meta utk KPI & laporan formal ----
    const lotSetAll = new Set<string>();
    const paramSetAll = new Set<string>();
    let nQCTotal = 0;
    rows.forEach((r) => {
      if (r.noLot) lotSetAll.add(r.noLot);
      if (r.parameter) paramSetAll.add(r.parameter);
      nQCTotal += r.nQC || 0;
    });
    const meta = {
      akun: accountsInfo.length,
      akunAktif: accountsInfo.filter((u) => u.status === "active").length,
      akunPending: accountsInfo.filter((u) => u.status === "pending").length,
      alat: instruments.length,
      qcRows: rows.length,
      nQC: nQCTotal,
      parameter: paramSetAll.size,
      lot: lotSetAll.size,
      periode:
        (filter.startDate || "awal") + " s/d " + (filter.endDate || "sekarang"),
    };

    return {
      ok: true,
      instruments,
      ranking,
      mostUsed,
      accountsInfo,
      meta,
      filter,
      criteria: {
        cv: "100 poin pada CV ≤ 2% · 0 pada CV ≥ 5%",
        bias: "100 poin pada |Bias| ≤ 25% TEa · 0 pada ≥ 50% TEa",
        te: "100 poin pada TE ≤ TEa · 0 pada TE ≥ 1.2×TEa",
        sigma: "100 poin pada σ ≥ 6 · 0 pada σ ≤ 4",
        komposit: "Skor alat = rata-rata komponen CV, Bias, TE, Sigma yang tersedia",
      },
      generatedAt: new Date().toISOString(),
    };
  } catch (e: any) {
    return { ok: false, msg: e?.message || String(e) };
  }
}

// ============================================================
// v9.43 — PG Z-score IQC (superadmin only)
//
// Rekap tabulasi otomatis Z-score & Bias% per akun × parameter ×
// lot × level QC terhadap 3 kelompok peer (sesuai laporan PME):
//   • Seluruh Peserta — semua akun (dalam populasi filter) pada
//     kombinasi (parameter, level) yang sama
//   • Kelompok Metode — akun yang lot-nya memakai metode sama
//   • Kelompok Alat   — akun yang memakai nama alat sama
//
// Statistik robust ISO 13528:2022 — Algorithm A:
//   est awal  : target = median(x), SDPA = 1.483 × MAD
//   iterasi   : winsorize φ = 1.5 → recompute mean & SD sampai
//               perubahan SD konvergen (rel. 1e-4, maks 50 iterasi)
//   Z-score   : Z = (x − target) / SDPA
//   Bias%     : Bias% = (x − target) / target × 100
//   Kategori  : |Z| ≤ 2 → OK/Memuaskan · 2 < |Z| < 3 → Warning/
//               Perlu perhatian · |Z| ≥ 3 → Action/Tidak memuaskan
// Kelompok dengan n < 3 atau SDPA = 0 → "Tidak dianalisa" (Z null).
//
// Filter identik dengan Tabulasi QC Analisis (startDate, endDate,
// params, accounts, instruments, lots, metode) — populasi peer =
// akun-akun dalam filter. Handler juga mengembalikan `rows` dalam
// format pgTabulasi agar payload pgKirim/inbox kompatibel penuh.
// ============================================================

function medianOf(sorted: number[]): number {
  const n = sorted.length;
  if (!n) return NaN;
  const mid = n >> 1;
  return n % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

// Algorithm A — ISO 13528:2022 (robust mean & SD)
function robustAlgoA(vals: number[]): { target: number; sdpa: number; n: number } {
  const n = vals.length;
  const sorted = vals.slice().sort((a, b) => a - b);
  let x = medianOf(sorted);
  let s = 1.483 * medianOf(vals.map((v) => Math.abs(v - x)).sort((a, b) => a - b));
  if (n < 3 || !(s > 0)) return { target: x, sdpa: s, n };
  const PHI = 1.5;
  for (let it = 0; it < 50; it++) {
    const sPrev = s;
    const xw = vals.map((v) => {
      const d = (v - x) / s;
      return Math.abs(d) > PHI ? x + PHI * s * (d < 0 ? -1 : 1) : v;
    });
    const m1 = xw.reduce((a, b) => a + b, 0) / n;
    const ss = xw.reduce((a, b) => a + (b - m1) * (b - m1), 0) / (n - 1);
    const s1 = Math.sqrt(Math.max(ss, 0));
    x = m1;
    s = s1;
    if (Math.abs(s1 - sPrev) <= 1e-4 * Math.max(sPrev, 1e-12)) break;
  }
  return { target: x, sdpa: s, n };
}

function rr(x: number | null | undefined, d: number): number | null {
  if (x === null || x === undefined || !isFinite(x as number)) return null;
  return parseFloat(Number(x).toFixed(d));
}

function zCat(z: number | null): { kategori: string; ket: string } {
  if (z === null) return { kategori: "-", ket: "" };
  const a = Math.abs(z);
  if (a <= 2) return { kategori: "OK", ket: "Memuaskan" };
  if (a < 3) return { kategori: "Warning", ket: "Perlu perhatian" };
  return { kategori: "Action", ket: "Tidak memuaskan" };
}

export interface PgZGroup {
  n: number;
  target: number | null;
  sdpa: number | null;
  biasPct: number | null;
  z: number | null;
  kategori: string;
  ket: string;
}

export interface PgZrow {
  account: string;
  fullName: string;
  parameter: string;
  noLot: string;
  namaAlat: string;
  metode: string;
  level: string; // L1/L2/L3
  x: number; // hasil saudara (rata-rata level akun tsb)
  nOwn: number; // jumlah pengukuran akun sendiri
  gPeserta: PgZGroup;
  gMetode: PgZGroup;
  gAlat: PgZGroup;
}

// ------------------------------------------------------------
// pgZscoreIQC — rekap tabulasi Z-score & Bias% (superadmin)
// args[0] = filter { startDate, endDate, params[], accounts[], instruments[], lots[], metode[] }
// v9.43b — pencocokan filter TOLERAN VARIAN NAMA: ceklis filter bersumber
// dari tabel Lot QC (master), sedangkan baris inputQC dapat memakai varian
// nama (beda kapital/spasi/hubung, mis. "DIALAB" vs "DIALAB AUTOLYZER",
// "ASAM URAT" vs "Asam Urat"). Pencocokan literal eksak di level SQL membuat
// akun dengan varian nama hilang SELURUHNYA dari rekap (zscore akun tidak
// tampil padahal ceklist dicentang). Kini filter params/alat/lot/metode
// dilakukan di sisi JS dengan: (1) normalisasi nama (kapital, spasi tunggal,
// tanda hubung/dot = spasi); (2) pencocokan ganda terhadap nama di inputQC
// DAN di master Lot QC milik akun; (3) alias awalan utk nama alat ("DIALAB"
// ↔ "DIALAB AUTOLYZER"). Nama tampil & kunci kelompok peer (parameter,
// metode, alat) memprioritaskan master Lot QC sehingga konsisten dgn ceklis
// dan varian nama satu alat tetap satu kelompok peer.
// ------------------------------------------------------------
export async function pgZscoreIQC(args: any[], session: SessionData | null) {
  if (!isRealSuperadmin(session)) return deny();
  try {
    const f: PgTabulasiFilter = args[0] || {};

    let accounts: string[] = Array.isArray(f.accounts) ? f.accounts.map(String).filter(Boolean) : [];
    if (!accounts.length) {
      const all = await db.users.findMany({ select: { username: true } });
      accounts = all.map((u) => u.username);
    }
    if (!accounts.length) return { ok: true, rows: [], zrows: [], meta: { akun: 0, parameter: 0, level: 0, peerCombos: 0, periode: "" }, filter: f };

    const norm = (s: any): string =>
      String(s ?? "")
        .trim()
        .toUpperCase()
        .replace(/[-_.]+/g, " ")
        .replace(/\s+/g, " ");

    const where: any = { ownerUsername: { in: accounts } };
    if (f.startDate || f.endDate) {
      const t: any = {};
      if (f.startDate) t.gte = String(f.startDate);
      if (f.endDate) t.lte = String(f.endDate);
      where.tanggal = t;
    }

    const [qcRows, lotRows, userRows, paramMasterRows] = await Promise.all([
      db.inputQC.findMany({
        where,
        select: {
          ownerUsername: true,
          lotID: true,
          paramID: true,
          parameter: true,
          noLot: true,
          namaAlat: true,
          level1: true,
          level2: true,
          level3: true,
        },
      }),
      db.lotQC.findMany({
        where: { ownerUsername: { in: accounts } },
        select: {
          id: true,
          ownerUsername: true,
          paramID: true,
          noLot: true,
          namaAlat: true,
          methode: true,
          satuan: true,
          meanL1: true,
          sdL1: true,
          meanL2: true,
          sdL2: true,
          meanL3: true,
          sdL3: true,
          tea: true,
        },
      }),
      db.users.findMany({
        where: { username: { in: accounts } },
        select: { username: true, fullName: true },
      }),
      db.parameters.findMany({ select: { id: true, parameter: true } }),
    ]);

    const lotMap = new Map<string, any>();
    lotRows.forEach((l: any) => lotMap.set(l.id, l));
    const nameMap = new Map<string, string>();
    userRows.forEach((u: any) => nameMap.set(u.username, u.fullName || u.username));
    const paramMaster = new Map<string, string>();
    paramMasterRows.forEach((p: any) => {
      const nm = String(p.parameter || "").trim();
      if (nm) paramMaster.set(String(p.id), nm);
    });

    // Set filter ternormalisasi
    const selP = new Set((Array.isArray(f.params) ? f.params : []).map(norm).filter(Boolean));
    const selI = new Set((Array.isArray(f.instruments) ? f.instruments : []).map(norm).filter(Boolean));
    const selL = new Set((Array.isArray(f.lots) ? f.lots : []).map(norm).filter(Boolean));
    const selM = new Set((Array.isArray(f.metode) ? f.metode : []).map(norm).filter(Boolean));

    // Alias alat — varian penamaan alat yang sama: satu nama merupakan awalan
    // utuh (pada batas kata) dari yang lain, sisi pendek >= 4 huruf, dan
    // selisih tepat satu kata ("DIALAB" ↔ "DIALAB AUTOLYZER" cocok;
    // "MINDRAY" vs "MINDRAY BC 720"/"MINDRAY BS 480" TIDAK digabung agar
    // model alat berbeda tidak tercampur dalam satu kelompok).
    const alatAlias = (a: string, b: string): boolean => {
      if (!a || !b || a === b) return false;
      const s = a.length <= b.length ? a : b;
      const l = a.length <= b.length ? b : a;
      if (s.length < 4) return false;
      if (!l.startsWith(s) || (l.length > s.length && l[s.length] !== " ")) return false;
      return l.split(" ").length - s.split(" ").length === 1;
    };
    const alatMatch = (rowA: string, lotA: string): boolean => {
      if (!selI.size) return true;
      for (const s of selI) {
        if ((rowA && s === rowA) || (lotA && s === lotA)) return true;
        if (rowA && alatAlias(s, rowA)) return true;
        if (lotA && alatAlias(s, lotA)) return true;
      }
      return false;
    };

    const groups = new Map<string, {
      owner: string; lotID: string; rows: any[];
      parameter: string; noLot: string; namaAlat: string; metode: string;
      nParam: string; nAlat: string; nMet: string;
    }>();
    for (const r of qcRows as any[]) {
      const lot = lotMap.get(r.lotID) || null;
      const dispParam = (r.paramID && paramMaster.get(String(r.paramID))) || String(r.parameter || "").trim();
      const dispLot = String(lot?.noLot || r.noLot || "").trim();
      const dispAlat = String(lot?.namaAlat || r.namaAlat || "").trim();
      const dispMet = String(lot?.methode || "").trim();
      const nParam = norm(dispParam);
      const nAlat = norm(dispAlat);
      const nMet = norm(dispMet);
      const nRowAlat = norm(r.namaAlat);
      const nRowLot = norm(r.noLot);
      const nRowParam = norm(r.parameter);
      const nRowParamM = norm(r.paramID && paramMaster.get(String(r.paramID)));
      // ---- pass filter (JS, toleran varian nama) ----
      if (selP.size && !(selP.has(nParam) || (nRowParam && selP.has(nRowParam)) || (nRowParamM && selP.has(nRowParamM)))) continue;
      if (selL.size && !((nRowLot && selL.has(nRowLot)) || (norm(dispLot) && selL.has(norm(dispLot))))) continue;
      if (selI.size && !alatMatch(nRowAlat, nAlat)) continue;
      if (selM.size && !(nMet && selM.has(nMet))) continue;

      const key = r.ownerUsername + "|" + r.lotID;
      let g = groups.get(key);
      if (!g) {
        g = { owner: r.ownerUsername, lotID: r.lotID, rows: [], parameter: dispParam, noLot: dispLot, namaAlat: dispAlat, metode: dispMet, nParam, nAlat, nMet };
        groups.set(key, g);
      }
      g.rows.push(r);
    }

    // Kunci kanonik kelompok alat — union-find atas semua nama alat
    // ternormalisasi dgn aturan alias yang sama, sehingga varian nama
    // satu alat ("DIALAB" & "DIALAB AUTOLYZER") masuk kelompok peer alat
    // yang sama. Nama kanonik = nama terpanjang (paling spesifik).
    const alatNameSet = new Set<string>();
    groups.forEach((g) => { if (g.nAlat) alatNameSet.add(g.nAlat); });
    const alatNames = Array.from(alatNameSet);
    const ufParent = new Map<string, string>();
    alatNames.forEach((n) => ufParent.set(n, n));
    const ufFind = (x: string): string => {
      let r = ufParent.get(x) || x;
      while (r !== (ufParent.get(r) || r)) r = ufParent.get(r) || r;
      return r;
    };
    const ufUnion = (a: string, b: string) => {
      const ra = ufFind(a), rb = ufFind(b);
      if (ra !== rb) ufParent.set(ra, rb);
    };
    for (let i = 0; i < alatNames.length; i++)
      for (let j = i + 1; j < alatNames.length; j++)
        if (alatAlias(alatNames[i], alatNames[j])) ufUnion(alatNames[i], alatNames[j]);
    const alatCanon = new Map<string, string>();
    const ufRoot = new Map<string, string>();
    alatNames.forEach((n) => {
      const r = ufFind(n);
      const cur = ufRoot.get(r);
      if (!cur || n.split(" ").length > cur.split(" ").length || (n.split(" ").length === cur.split(" ").length && n.length > cur.length)) ufRoot.set(r, n);
    });
    alatNames.forEach((n) => alatCanon.set(n, ufRoot.get(ufFind(n)) || n));

    // Observasi peer per (parameter, level): satu poin = mean level
    // satu akun pada satu lot (Hasil Saudara). Kunci kelompok memakai
    // nama ternormalisasi agar varian nama tidak memecah peer.
    type Obs = { account: string; fullName: string; parameter: string; noLot: string; namaAlat: string; metode: string; level: string; x: number; n: number; kMet: string; kAlat: string };
    const obsByKey = new Map<string, Obs[]>();
    const rows: PgRow[] = [];
    // v9.44 — Rumus TE% global (Pengaturan superadmin): |Bias%| + K×CV%
    const teK = await getTeKFactor();

    for (const g of groups.values()) {
      const lot = lotMap.get(g.lotID) || null;
      const stats = computeQCStats(g.rows, lot, teK);
      const hasAny = [1, 2, 3].some((lv) => stats["L" + lv]);
      if (!hasAny) continue;
      const fullName = nameMap.get(g.owner) || g.owner;
      rows.push({
        account: g.owner,
        fullName,
        parameter: g.parameter,
        noLot: g.noLot,
        namaAlat: g.namaAlat,
        nQC: g.rows.length,
        stats,
      });
      for (const lv of ["L1", "L2", "L3"]) {
        const s = stats[lv];
        if (!s) continue;
        const key = g.nParam + "||" + lv;
        let arr = obsByKey.get(key);
        if (!arr) {
          arr = [];
          obsByKey.set(key, arr);
        }
        arr.push({
          account: g.owner,
          fullName,
          parameter: g.parameter,
          noLot: g.noLot,
          namaAlat: g.namaAlat,
          metode: g.metode,
          level: lv,
          x: Number(s.mean),
          n: Number(s.n) || 0,
          kMet: g.nMet,
          kAlat: g.nAlat ? (alatCanon.get(g.nAlat) || g.nAlat) : "",
        });
      }
    }

    // Hitung Z-score & Bias% robust per observasi per kelompok
    const zrows: PgZrow[] = [];
    const noGroup: PgZGroup = { n: 0, target: null, sdpa: null, biasPct: null, z: null, kategori: "-", ket: "Tidak dianalisa (n < 3 peserta)" };
    for (const [, arr] of obsByKey) {
      for (const o of arr) {
        const calc = (vals: number[]): PgZGroup => {
          const n = vals.length;
          if (n < 3) return { n, target: null, sdpa: null, biasPct: null, z: null, kategori: "-", ket: "Tidak dianalisa (n < 3 peserta)" };
          const ra = robustAlgoA(vals);
          const target = rr(ra.target, 4);
          const sdpa = rr(ra.sdpa, 4);
          const biasPct = ra.target !== 0 ? rr(((o.x - ra.target) / ra.target) * 100, 2) : null;
          if (ra.sdpa > 0) {
            const z = rr(((o.x - ra.target) / ra.sdpa), 2);
            const c = zCat(z);
            return { n, target, sdpa, biasPct, z, kategori: c.kategori, ket: c.ket };
          }
          return { n, target, sdpa, biasPct, z: null, kategori: "-", ket: "Tidak dianalisa (SDPA = 0)" };
        };
        const peserta = arr.map((p) => p.x);
        const metodeArr = o.kMet ? arr.filter((p) => p.kMet === o.kMet).map((p) => p.x) : [];
        const alatArr = o.kAlat ? arr.filter((p) => p.kAlat === o.kAlat).map((p) => p.x) : [];
        zrows.push({
          account: o.account,
          fullName: o.fullName,
          parameter: o.parameter,
          noLot: o.noLot,
          namaAlat: o.namaAlat,
          metode: o.metode,
          level: o.level,
          x: rr(o.x, 4) || 0,
          nOwn: o.n,
          gPeserta: calc(peserta),
          gMetode: metodeArr.length ? calc(metodeArr) : noGroup,
          gAlat: alatArr.length ? calc(alatArr) : noGroup,
        });
      }
    }

    zrows.sort(
      (a, b) =>
        a.account.localeCompare(b.account) ||
        a.parameter.localeCompare(b.parameter) ||
        String(a.noLot).localeCompare(String(b.noLot)) ||
        a.level.localeCompare(b.level)
    );
    rows.sort(
      (a, b) =>
        a.account.localeCompare(b.account) ||
        a.parameter.localeCompare(b.parameter) ||
        String(a.noLot).localeCompare(String(b.noLot))
    );

    let peerCombos = 0;
    obsByKey.forEach((arr) => {
      if (arr.length >= 3) peerCombos++;
    });
    const meta = {
      akun: Array.from(new Set(zrows.map((z) => z.account))).length,
      parameter: Array.from(new Set(zrows.map((z) => z.parameter))).length,
      level: zrows.length,
      peerCombos,
      periode: (f.startDate || "awal") + " s/d " + (f.endDate || "sekarang"),
    };

    return { ok: true, rows, zrows, meta, filter: f, generatedAt: new Date().toISOString() };
  } catch (e: any) {
    return { ok: false, msg: e?.message || String(e) };
  }
}

// ------------------------------------------------------------
// pgZscoreAnalisa — analisa otomatis dari rekap Z-score (superadmin)
// args[0] = { zrows: hasil pgZscoreIQC.zrows, filter }
// Rule-based deterministik; bentuk output mengikuti pgAnalisa
// (interpretasi/analisa/capa) agar renderer laporan formal/inbox
// dapat memakainya; distribusi memakai kategori ISO 13528.
// ------------------------------------------------------------
export async function pgZscoreAnalisa(args: any[], session: SessionData | null) {
  if (!isRealSuperadmin(session)) return deny();
  try {
    const zrows: PgZrow[] = Array.isArray(args?.[0]?.zrows) ? args[0].zrows : [];
    if (!zrows.length) return { ok: false, msg: "Tampilkan rekap Z-score terlebih dulu" };
    const nm = (a: any) => a.fullName || a.account;

    const distOf = (pick: (z: PgZrow) => PgZGroup) => {
      const d = { memuaskan: 0, perluPerhatian: 0, tidakMemuaskan: 0, tidakDianalisa: 0 };
      zrows.forEach((z) => {
        const g = pick(z);
        if (g.z === null) d.tidakDianalisa++;
        else if (g.kategori === "OK") d.memuaskan++;
        else if (g.kategori === "Warning") d.perluPerhatian++;
        else d.tidakMemuaskan++;
      });
      return d;
    };
    const dP = distOf((z) => z.gPeserta);
    const dM = distOf((z) => z.gMetode);
    const dA = distOf((z) => z.gAlat);

    // per akun (basis grup Seluruh Peserta)
    const accNames = Array.from(new Set(zrows.map((z) => z.account))).sort((a, b) => a.localeCompare(b));
    const perAccount: any[] = [];
    let worstAll: { account: string; fullName: string; parameter: string; level: string; lot: string; z: number; biasPct: number | null } | null = null;
    for (const acc of accNames) {
      const zs = zrows.filter((z) => z.account === acc);
      const nOk = zs.filter((z) => z.gPeserta.kategori === "OK").length;
      const nWarn = zs.filter((z) => z.gPeserta.kategori === "Warning").length;
      const nAct = zs.filter((z) => z.gPeserta.kategori === "Action").length;
      const nNa = zs.filter((z) => z.gPeserta.z === null).length;
      const abs = zs.filter((z) => z.gPeserta.z !== null).map((z) => ({ v: Math.abs(z.gPeserta.z as number), z }));
      const avgAbsZ = abs.length ? parseFloat((abs.reduce((a, b) => a + b.v, 0) / abs.length).toFixed(2)) : null;
      let worst: any = null;
      if (abs.length) {
        abs.sort((a, b) => b.v - a.v);
        const w = abs[0].z;
        worst = { parameter: w.parameter, level: w.level, lot: w.noLot, z: w.gPeserta.z, biasPct: w.gPeserta.biasPct, sumber: "Seluruh Peserta" };
        if (!worstAll || Math.abs(worst.z) > Math.abs(worstAll.z))
          worstAll = { account: acc, fullName: zs[0].fullName || acc, parameter: w.parameter, level: w.level, lot: w.noLot, z: w.gPeserta.z as number, biasPct: w.gPeserta.biasPct };
      }
      const issues: string[] = [];
      for (const z of zs) {
        const g = z.gPeserta;
        if (g.kategori === "Action")
          issues.push(`${z.parameter} ${z.level} (Lot ${z.noLot || "-"}): Z ${g.z} — ${g.ket}; Bias% ${g.biasPct === null ? "-" : g.biasPct} vs target ${g.target === null ? "-" : g.target}`);
        else if (g.kategori === "Warning")
          issues.push(`${z.parameter} ${z.level} (Lot ${z.noLot || "-"}): Z ${g.z} — ${g.ket}`);
        if (issues.length >= 8) break;
      }
      perAccount.push({
        account: acc,
        fullName: zs[0]?.fullName || acc,
        totalLevel: zs.length,
        nOk,
        nWarn,
        nAction: nAct,
        nTidakDianalisa: nNa,
        avgAbsZ,
        worst,
        issues,
      });
    }

    // per parameter (basis Seluruh Peserta)
    const paramNames = Array.from(new Set(zrows.map((z) => z.parameter))).sort((a, b) => a.localeCompare(b));
    const perParameter: any[] = [];
    for (const p of paramNames) {
      const zs = zrows.filter((z) => z.parameter === p && z.gPeserta.z !== null);
      if (!zs.length) continue;
      const zsAll = zrows.filter((z) => z.parameter === p);
      const zVals = zs.map((z) => z.gPeserta.z as number);
      const zMin = Math.min(...zVals);
      const zMax = Math.max(...zVals);
      const spread = parseFloat((zMax - zMin).toFixed(2));
      const nAction = zsAll.filter((z) => z.gPeserta.kategori === "Action").length;
      perParameter.push({
        parameter: p,
        akunDibanding: Array.from(new Set(zsAll.map((z) => z.account))).length,
        nData: zsAll.length,
        zMin: rr(zMin, 2),
        zMax: rr(zMax, 2),
        spread,
        nAction,
        butuhStandardisasi: spread >= 4,
      });
    }

    const total = zrows.length;
    const pctOk = total - dP.tidakDianalisa > 0 ? Math.round((dP.memuaskan / (total - dP.tidakDianalisa)) * 100) : null;
    const interpretasi: string[] = [];
    const analisa: string[] = [];
    const capa: string[] = [];

    interpretasi.push(`Rekap mencakup ${accNames.length} akun, ${paramNames.length} parameter, ${total} kombinasi hasil level QC. Target & SDPA peer dihitung dengan statistik robust ISO 13528:2022 (Algorithm A — median winsorized, SDPA init 1.483×MAD).`);
    if (pctOk !== null)
      interpretasi.push(`Seluruh Peserta: ${dP.memuaskan} hasil memuaskan (|Z| ≤ 2, ${pctOk}%), ${dP.perluPerhatian} perlu perhatian (2 < |Z| < 3), ${dP.tidakMemuaskan} tidak memuaskan (|Z| ≥ 3), ${dP.tidakDianalisa} tidak dianalisa (kelompok < 3 peserta atau SDPA = 0).`);
    interpretasi.push(`Kelompok Metode: ${dM.memuaskan} memuaskan · ${dM.perluPerhatian} warning · ${dM.tidakMemuaskan} action · ${dM.tidakDianalisa} tidak dianalisa. Kelompok Alat: ${dA.memuaskan} memuaskan · ${dA.perluPerhatian} warning · ${dA.tidakMemuaskan} action · ${dA.tidakDianalisa} tidak dianalisa.`);
    if (worstAll)
      interpretasi.push(`Nilai |Z| tertinggi (Seluruh Peserta): ${worstAll.fullName} — ${worstAll.parameter} ${worstAll.level} lot ${worstAll.lot} (Z ${worstAll.z}; Bias% ${worstAll.biasPct === null ? "-" : worstAll.biasPct}).`);

    const actRows = zrows.filter((z) => z.gPeserta.kategori === "Action");
    for (const z of actRows.slice(0, 6)) {
      const biasAbs = z.gPeserta.biasPct === null ? null : Math.abs(z.gPeserta.biasPct);
      const dominan = biasAbs !== null && biasAbs >= 10 ? "dominan inaccuracy (bias besar terhadap target robust)" : "indikasi imprecision/komutabilitas material QC (bias relatif kecil namun deviasi konsisten)";
      analisa.push(`${nm(z)} — ${z.parameter} ${z.level} (Lot ${z.noLot || "-"}): Z ${z.gPeserta.z} (|Z| ≥ 3, tidak memuaskan), Bias% ${z.gPeserta.biasPct === null ? "-" : z.gPeserta.biasPct}, target/SDPA ${z.gPeserta.target}/${z.gPeserta.sdpa} (n ${z.gPeserta.n}) — ${dominan}.`);
    }
    const warnRows = zrows.filter((z) => z.gPeserta.kategori === "Warning");
    if (warnRows.length)
      analisa.push(`Terdapat ${warnRows.length} hasil pada zona warning (2 < |Z| < 3): ${warnRows.slice(0, 5).map((z) => `${nm(z)} — ${z.parameter} ${z.level} (Z ${z.gPeserta.z})`).join("; ")}${warnRows.length > 5 ? "; ..." : ""}. Hasil ini masih dapat diterima namun perlu dipantau pada sisi keselamatan.`);
    // Ketidaksesuaian antar kelompok (metode/alat lebih buruk dari peserta)
    const gapRows = zrows.filter((z) => z.gPeserta.kategori === "OK" && (z.gMetode.kategori === "Action" || z.gAlat.kategori === "Action"));
    if (gapRows.length)
      analisa.push(`${gapRows.length} hasil memuaskan terhadap Seluruh Peserta namun tidak memuaskan pada kelompok Metode/Alat — indikasi pergeseran sistematis per metode atau per alat (kalibrasi, reagen, atau komutabilitas) yang perlu diinvestigasi per kelompok.`);
    if (!actRows.length && !warnRows.length)
      analisa.push("Seluruh hasil yang dianalisa berada pada zona memuaskan (|Z| ≤ 2) terhadap Seluruh Peserta, Kelompok Metode, dan Kelompok Alat — konsistensi antar akun baik.");

    const actAccs = perAccount.filter((a) => a.nAction > 0);
    if (actAccs.length)
      capa.push(`SEGERA (prioritas 1): ${actAccs.map((a) => `${nm(a)} (${a.nAction} hasil |Z| ≥ 3)`).join(", ")} — hentikan sementara pelaporan hasil pada parameter terkait, lakukan kalibrasi ulang terhadap nilai target lot, investigasi root cause (reagen/kalibrator, kondisi alat), dan verifikasi ulang dengan QC sebelum hasil dirilis.`);
    const warnAccs = perAccount.filter((a) => a.nWarn > 0 && a.nAction === 0);
    if (warnAccs.length)
      capa.push(`PERBAIKAN (prioritas 2): ${warnAccs.map((a) => nm(a)).join(", ")} — terapkan Westgard multi-rule (1-3s/2-2s/R-4s/4-1s), tingkatkan frekuensi QC, dan tinjau penetapan mean target lot hingga kembali ke zona memuaskan (|Z| ≤ 2).`);
    const stdNeeded = perParameter.filter((p) => p.butuhStandardisasi);
    if (stdNeeded.length)
      capa.push(`STANDARDISASI (prioritas 3): parameter ${stdNeeded.map((p) => p.parameter).join(", ")} menunjukkan selisih Z antar akun ≥ 4 — selenggarakan perbandingan antar laboratorium (training/SOP seragam/kalibrasi bersama).`);
    const okAccs = perAccount.filter((a) => a.nOk === a.totalLevel);
    if (okAccs.length)
      capa.push(`PERTAHANKAN (prioritas 4): ${okAccs.map((a) => nm(a)).join(", ")} — seluruh hasil memuaskan; dokumentasikan sebagai praktik baik referensi akun lain.`);
    capa.push("PREVENTIF: pantau grafik Levey-Jennings QC harian, verifikasi setiap pergantian lot reagen/kalibrator dengan QC before-use, dan gunakan konsensus robust (ISO 13528:2022) sebagai pembanding reguler antar akun.");

    return {
      ok: true,
      analisa: {
        analisaKind: "zscore", // penanda renderer (pg3AnalisaHTML)
        ringkasan: { akun: accNames.length, parameter: paramNames.length, total, peerCombos: Array.from(new Set(zrows.map((z) => z.parameter + "|" + z.level + "|" + z.gPeserta.n))).length },
        distribusi: { peserta: dP, metode: dM, alat: dA },
        perAccount,
        perParameter,
        interpretasi,
        analisa,
        capa,
        dibuatPada: new Date().toISOString(),
      },
    };
  } catch (e: any) {
    return { ok: false, msg: e?.message || String(e) };
  }
}
