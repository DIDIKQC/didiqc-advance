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
//   pgFilterOptions  — opsi filter: akun terdaftar + parameter/alat/lot
//                      yang benar-benar dipakai di data QC lintas akun
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
//
// Keamanan: handler admin wajib session.role === "superadmin" && !isSecondary
// (role asli sesi, bukan argumen dari frontend). Tenant penerima hanya
// bisa membuka laporan yang dia jadi penerima dan laporan masih active.
// ============================================================

import { db } from "@/lib/db";
import type { SessionData } from "@/lib/session";
import { computeQCStats } from "@/lib/backend/calculations";
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
// Akun: semua user terdaftar. Parameter/Alat/Lot: hanya yang benar-benar
// pernah dipakai pada data QC lintas akun (bukan daftar master).
// ------------------------------------------------------------
export async function pgFilterOptions(args: any[], session: SessionData | null) {
  if (!isRealSuperadmin(session)) return deny();
  try {
    const [users, paramRows, alatRows, lotRows] = await Promise.all([
      db.users.findMany({
        select: { username: true, fullName: true, role: true, status: true },
        orderBy: { username: "asc" },
      }),
      db.inputQC.findMany({ distinct: ["parameter"], select: { parameter: true } }),
      db.inputQC.findMany({ distinct: ["namaAlat"], select: { namaAlat: true } }),
      db.inputQC.findMany({ distinct: ["noLot"], select: { noLot: true } }),
    ]);
    const params = paramRows
      .map((r) => String(r.parameter || "").trim())
      .filter((v) => v)
      .sort((a, b) => a.localeCompare(b));
    const instruments = alatRows
      .map((r) => String(r.namaAlat || "").trim())
      .filter((v) => v)
      .sort((a, b) => a.localeCompare(b));
    const lots = lotRows
      .map((r) => String(r.noLot || "").trim())
      .filter((v) => v)
      .sort((a, b) => a.localeCompare(b));
    return {
      ok: true,
      accounts: users.map((u) => ({
        username: u.username,
        fullName: u.fullName,
        role: u.role,
        status: u.status,
      })),
      params,
      instruments,
      lots,
    };
  } catch (e: any) {
    return { ok: false, msg: e?.message || String(e) };
  }
}

// ------------------------------------------------------------
// pgTabulasi — rekap statistik QC lintas akun (superadmin)
// args[0] = filter { startDate, endDate, params[], accounts[], instruments[], lots[] }
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

    const rows: PgRow[] = [];
    for (const g of groups.values()) {
      const lot = lotMap.get(g.lotID) || null; // lot milik akun tsb (target mean/TEa)
      const stats = computeQCStats(g.rows, lot);
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
// args[0] = { title, filter, rows, analisa, recipients[] }
// Snapshot lengkap disimpan di payloadJson; database penerima hanya
// referensi (tanpa duplikasi isi laporan).
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
    await db.pgReport.create({
      data: {
        id,
        ownerUsername: String(session!.username),
        title: String(p.title || "Laporan Tabulasi QC Analisis — Peer Group").slice(0, 180),
        filtersJson: JSON.stringify(filter),
        summaryJson: JSON.stringify(summary),
        payloadJson: JSON.stringify({ rows, analisa }),
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

    if (asRecipient && !asRecipient.readAt) {
      await db.pgReportRecipient.update({ where: { id: asRecipient.id }, data: { readAt: new Date() } });
    }
    return {
      ok: true,
      report: { id: r.id, title: r.title, sentAt: r.sentAt ? r.sentAt.toISOString() : null, active: r.active },
      filter: safeParse(r.filtersJson),
      rows: anonRows,
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
