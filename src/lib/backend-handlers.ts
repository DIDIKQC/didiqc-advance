// ============================================================
// backend-handlers.ts — Central handler registry
// Meng-aggregate semua fungsi backend dari modul-modul di src/lib/backend/
// Setiap entri: { fnName: async (args, session) => any }
// ============================================================

import type { SessionData } from "@/lib/session";
import * as auth from "@/lib/backend/auth";
import * as masterData from "@/lib/backend/master-data";
import * as inputqc from "@/lib/backend/inputqc";
import * as calculations from "@/lib/backend/calculations";
import * as westgard from "@/lib/backend/westgard";
import * as dashboard from "@/lib/backend/dashboard";
import * as graph from "@/lib/backend/graph";
import * as reports from "@/lib/backend/reports";
import * as images from "@/lib/backend/images";
import * as smartImport from "@/lib/backend/smart-import";
import * as users from "@/lib/backend/users";
import * as misc from "@/lib/backend/misc";
import * as backup from "@/lib/backend/backup";

export type HandlerFn = (args: any[], session: SessionData | null) => Promise<any>;

// ============================================================
// PUBLIC HANDLERS — tidak butuh auth (dipanggil sebelum login)
// ============================================================
export const PUBLIC_HANDLERS = new Set<string>([
  "getLoginSettings",
  "getAppLogo",
  "loginUser",
  "registerUser",
  "initializeSheets",
  "__ping",
]);

// ============================================================
// MASTER REGISTRY — wired to real implementations
// ============================================================
export const handlers: Record<string, HandlerFn> = {
  // ===== Auth & bootstrap =====
  getLoginSettings: auth.getLoginSettings,
  getAppLogo: auth.getAppLogo,
  loginUser: auth.loginUser,
  registerUser: auth.registerUser,
  initializeSheets: auth.initializeSheets,
  getInitData: auth.getInitData,
  logout: auth.logout,

  // ===== Master Data: Parameters =====
  getParameters: masterData.getParameters,
  saveParameter: masterData.saveParameter,
  deleteParameter: masterData.deleteParameter,
  getParamByID: masterData.getParamByID,

  // ===== Master Data: LotQC =====
  getLotQC: masterData.getLotQC,
  saveLotQC: masterData.saveLotQC,
  deleteLotQC: masterData.deleteLotQC,
  getLotByID: masterData.getLotByID,
  getLotInfoForAutoFill: masterData.getLotInfoForAutoFill,

  // ===== Master Data: DaftarTEa =====
  getDaftarTEa: masterData.getDaftarTEa,
  saveDaftarTEa: masterData.saveDaftarTEa,
  deleteDaftarTEa: masterData.deleteDaftarTEa,

  // ===== Master Data: KopSurat =====
  getKopSurat: masterData.getKopSurat,
  saveKopSurat: masterData.saveKopSurat,

  // ===== Master Data: Settings =====
  getSetting: masterData.getSetting,
  setSetting: masterData.setSetting,
  getSettings: masterData.getSettings,
  saveSettings: masterData.saveSettings,

  // ===== Master Data: Patologi Dokter Pengirim, Asal Ruangan & Asal Rujukan =====
  getPatologiDokter: masterData.getPatologiDokter,
  savePatologiDokter: masterData.savePatologiDokter,
  deletePatologiDokter: masterData.deletePatologiDokter,
  getPatologiRuangan: masterData.getPatologiRuangan,
  savePatologiRuangan: masterData.savePatologiRuangan,
  deletePatologiRuangan: masterData.deletePatologiRuangan,
  getPatologiRujukan: masterData.getPatologiRujukan,
  savePatologiRujukan: masterData.savePatologiRujukan,
  deletePatologiRujukan: masterData.deletePatologiRujukan,

  // ===== Users & Multi-Password =====
  getUsers: users.getUsers,
  saveUser: users.saveUser,
  deleteUser: users.deleteUser,
  approveUser: users.approveUser,
  getUserByUsername: users.getUserByUsername,
  getUserPasswords: users.getUserPasswords,
  addUserPassword: users.addUserPassword,
  deleteUserPassword: users.deleteUserPassword,
  editUserPassword: users.editUserPassword,
  toggleUserPasswordStatus: users.toggleUserPasswordStatus,

  // ===== Input QC =====
  getInputQC: inputqc.getInputQC,
  getInputQCById: inputqc.getInputQCById,
  saveInputQC: inputqc.saveInputQC,
  deleteInputQC: inputqc.deleteInputQC,
  addHistoriQC: inputqc.addHistoriQC,
  getQCByDateRange: inputqc.getQCByDateRange,
  bulkInputQC: inputqc.bulkInputQC,

  // ===== Histori =====
  getHistoriQC: inputqc.getHistoriQC,
  restoreHistoriQC: inputqc.restoreHistoriQC,
  deleteHistoriQC: inputqc.deleteHistoriQC,

  // ===== Validasi =====
  getValidasiData: inputqc.getValidasiData,
  validateQC: inputqc.validateQC,
  validateQCBulk: inputqc.validateQCBulk,
  updateValidasiNote: inputqc.updateValidasiNote,
  unvalidateQC: inputqc.unvalidateQC,

  // ===== CalculatedStats =====
  getCalcStats: calculations.getCalcStats,
  getCalcStatById: calculations.getCalcStatById,
  saveCalcStats: calculations.saveCalcStats,
  saveCalcStatsAllLevels: calculations.saveCalcStatsAllLevels,
  deleteCalcStats: calculations.deleteCalcStats,
  calcStatsFromInputQC: calculations.calcStatsFromInputQC,

  // ===== BiasPME =====
  getBiasPME: calculations.getBiasPME,
  getBiasPMEById: calculations.getBiasPMEById,
  saveBiasPME: calculations.saveBiasPME,
  deleteBiasPME: calculations.deleteBiasPME,
  getBiasPMEByFilter: calculations.getBiasPMEByFilter,
  calcCVFromInputQC: calculations.calcCVFromInputQC,

  // ===== SigmaCVOpt =====
  getSigmaCVOpt: calculations.getSigmaCVOpt,
  getSigmaCVOptById: calculations.getSigmaCVOptById,
  saveSigmaCVOpt: calculations.saveSigmaCVOpt,
  deleteSigmaCVOpt: calculations.deleteSigmaCVOpt,

  // ===== Westgard =====
  checkWestgardRules: westgard.checkWestgardRules,
  checkWestgardAcrossLevels: westgard.checkWestgardAcrossLevels,
  getActiveRulesBySigma: westgard.getActiveRulesBySigma,
  filterViolationsBySigma: westgard.filterViolationsBySigma,
  categorizeWestgardError: westgard.categorizeWestgardError,
  computeSigmaForLevel: westgard.computeSigmaForLevel,
  getWestgardViolations30Days: westgard.getWestgardViolations30Days,
  checkAndNotifyWestgard: westgard.checkAndNotifyWestgard,

  // ===== Dashboard =====
  getDashboardData: dashboard.getDashboardData,
  computeSigmaByBidang: dashboard.computeSigmaByBidang,
  computeCVBiasByBidang: dashboard.computeCVBiasByBidang,
  computeMonthTrend: dashboard.computeMonthTrend,
  getDashboardDetailTrend: dashboard.getDashboardDetailTrend,
  getDashboardAnalisisTrend: dashboard.getDashboardAnalisisTrend,

  // ===== Graph =====
  getGraphData: graph.getGraphData,
  getMeanSDForLevel: graph.getMeanSDForLevel,
  getSmallestSigmaBySrc: graph.getSmallestSigmaBySrc,
  getSigmaBasedGraphData: graph.getSigmaBasedGraphData,

  // ===== Reports =====
  getLaporanData: reports.getLaporanData,
  buildLevelInterpretation: reports.buildLevelInterpretation,
  getReportData: reports.getReportData,
  estimateErrorPer100: reports.estimateErrorPer100,
  getTrendAnalisisData: reports.getTrendAnalisisData,
  computeSigmaPME: reports.computeSigmaPME,
  getInstrumentCompare: reports.getInstrumentCompare,
  getTabulasiData: reports.getTabulasiData,
  getOPSpecsData: reports.getOPSpecsData,
  computePed: reports.computePed,
  computePfr: reports.computePfr,

  // ===== Catatan =====
  getCatatanLaporan: misc.getCatatanLaporan,
  saveCatatanLaporan: misc.saveCatatanLaporan,
  getCatatanTabulasi: misc.getCatatanTabulasi,
  saveCatatanTabulasi: misc.saveCatatanTabulasi,
  getCatatanDokter: misc.getCatatanDokter,
  saveCatatanDokter: misc.saveCatatanDokter,

  // ===== Filter option lists =====
  getSiklusPMEList: misc.getSiklusPMEList,
  getTahunSiklusList: misc.getTahunSiklusList,
  getPeriodeCalcStatsList: misc.getPeriodeCalcStatsList,
  getPeriodeSigmaCVOptList: misc.getPeriodeSigmaCVOptList,

  // ===== Log Activity =====
  getLogActivity: misc.getLogActivity,
  clearLogActivity: misc.clearLogActivity,

  // ===== Image Analysis (6 types) =====
  getImgData: images.getImgData,
  saveImgData: images.saveImgData,
  deleteImgData: images.deleteImgData,
  getImgHemato: images.getImgHemato,
  saveImgHemato: images.saveImgHemato,
  deleteImgHemato: images.deleteImgHemato,
  getImgUrin: images.getImgUrin,
  saveImgUrin: images.saveImgUrin,
  deleteImgUrin: images.deleteImgUrin,
  getImgMalaria: images.getImgMalaria,
  saveImgMalaria: images.saveImgMalaria,
  deleteImgMalaria: images.deleteImgMalaria,
  getImgBTA: images.getImgBTA,
  saveImgBTA: images.saveImgBTA,
  deleteImgBTA: images.deleteImgBTA,
  getImgLain: images.getImgLain,
  saveImgLain: images.saveImgLain,
  deleteImgLain: images.deleteImgLain,
  getImgPatologi: images.getImgPatologi,
  saveImgPatologi: images.saveImgPatologi,
  deleteImgPatologi: images.deleteImgPatologi,
  uploadImgToDrive: images.uploadImgToDrive,
  analyzePatologiImage: images.analyzePatologiImage,
  getPatologiDashboard: images.getPatologiDashboard,
  getPatologiReport: images.getPatologiReport,

  // ===== Smart Import & Hapus Data =====
  smartImportQC: smartImport.smartImportQC,
  hapusDataPrivat: smartImport.hapusDataPrivat,
  getInputQCForHapus: smartImport.getInputQCForHapus,

  // ===== Backup & Restore =====
  autoArchiveYearly: backup.autoArchiveYearly,
  setupArchiveTrigger: backup.setupArchiveTrigger,
  backupAllSheets: backup.backupAllSheets,
  backupAppProject: backup.backupAppProject,
  backupDatabase: backup.backupDatabase,
  listBackups: backup.listBackups,
  restoreSheetFromBackup: backup.restoreSheetFromBackup,
  setupAutoBackupTrigger: backup.setupAutoBackupTrigger,
  removeAutoBackupTrigger: backup.removeAutoBackupTrigger,
  isBackupTriggerActive: backup.isBackupTriggerActive,
  autoBackupDaily: backup.autoBackupDaily,
  exportSheet: backup.exportSheet,
  getEmailQuota: backup.getEmailQuota,
  testEmail: backup.testEmail,
  resetDatabase: backup.resetDatabase,
};
