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
// Akun: semua user terdaftar. Parameter/Alat/Lot: hanya yang benar-benar
// pernah dipakai pada data QC lintas akun (bukan daftar master).
// ------------------------------------------------------------
export async function pgFilterOptions(args: any[], session: SessionData | null) {
  if (!isRealSuperadmin(session)) return deny();
  try {
    const [users, paramRows, alatRows, lotRows, usedLotIdRows] = await Promise.all([
      db.users.findMany({
        select: { username: true, fullName: true, role: true, status: true },
        orderBy: { username: "asc" },
      }),
      db.inputQC.findMany({ distinct: ["parameter"], select: { parameter: true } }),
      db.inputQC.findMany({ distinct: ["namaAlat"], select: { namaAlat: true } }),
      db.inputQC.findMany({ distinct: ["noLot"], select: { noLot: true } }),
      // v9.38: metode = hanya dari lot yang BENAR-BENAR dipakai data QC lintas
      // akun (bukan dari master Daftar Metode)
      db.inputQC.findMany({ distinct: ["lotID"], select: { lotID: true } }),
    ]);
    const usedLotIds = usedLotIdRows
      .map((r) => String(r.lotID || "").trim())
      .filter((v) => v);
    const usedLotRows = usedLotIds.length
      ? await db.lotQC.findMany({
          where: { id: { in: usedLotIds } },
          select: { methode: true },
        })
      : [];
    const metodeSet = new Set<string>();
    usedLotRows.forEach((r: any) => {
      const m = String(r.methode || "").trim();
      if (m) metodeSet.add(m);
    });
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
      metode: Array.from(metodeSet).sort((a, b) => a.localeCompare(b)),
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
    for (const g of groups.values()) {
      const lot = lotMap.get(g.lotID) || null; // lot milik akun tsb (target mean/TEa)
      if (metodeSet.size) {
        const lm = String(lot?.methode || "").trim();
        if (!lm || !metodeSet.has(lm)) continue; // metode tidak dipilih / lot tanpa metode
      }
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
