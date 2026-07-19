---
Task ID: ANALYZE-CODEGS
Agent: Explore
Task: Read and analyze the full code.gs extracted text without modifying it

Work Log:
- Verified worklog.md did not yet exist; created it.
- Listed /home/z/my-project/upload/ and confirmed code_gs_extracted.txt (3687 lines, 173 KB) exists alongside the source PDF.
- Read the entire code_gs_extracted.txt file in 8 sequential passes (offsets 1, 501, 1001, 1501, 2001, 2501, 3001, 3501 — each limit 500) covering all 3687 lines across the 84 PDF pages.
- Used Grep to enumerate every top-level function declaration (`^function\s+\w+`) and to scan for TODO/FIXME/PERBAIKAN markers and hardcoded URLs/IDs.
- Cross-referenced the SH sheet-name object with the initializeSheets() column definitions to map every sheet to its columns.
- Analyzed the QC calculation pipeline (calcMean, calcSD, calcCV, bias, TE, sigma, TEa, QGI), Westgard multi-rule engine (1-2s, 1-3s, 2-2s, R-4s, 4-1s, 6x, 7x, 8x, 10x, 7T, plus across-level variants), OPSpecs (PED/PFR/ΔSEc/ΔREc), multi-password login flow, auto-backup trigger, login-settings persistence, smart-import, and image-analysis modules.
- Catalogued ~179 functions grouped into 13 functional categories.
- Verified no TODO/FIXME/HACK markers exist; identified one piece of dead code (notifySuperadminNewUser is defined but never invoked, since registerUser blocks self-registration after the first superadmin).
- Compiled the structured report below and returned it as the final message.

Stage Summary:
- Application: didiQCsys v9.12 (Round 2) — Google Apps Script backend for a clinical laboratory Quality Control system (LJ charts, Westgard rules, sigma metrics, OPSpecs, PME/bias tracking, image-based hematology/urine/malaria/BTA/patologi reports).
- File size: 3,687 lines / 84 pages extracted from PDF. Originally split into two files (BAGIAN 1 ends ~line 1327, BAGIAN 2 begins at line 1329).
- Top-level constants: APP_NAME, APP_LOGO_URL, SS_ID (from ScriptProperties), SMART_PWD='didikqc', LOCK_TIMEOUT=30000ms, BACKUP_FOLDER_NAME='didiQCsys_Backups', MAX_BACKUP_FILES=10.
- Sheets defined in SH object: 22 sheet names (Users, Parameters, LotQC, InputQC, HistoriQC, CalculatedStats, BiasPME, DaftarTEa, SigmaCVOpt, LaporanCatatan, TabulasiCatatan, KopSurat, Settings, LogActivity, ImgHemato, ImgUrin, ImgMalaria, ImgBTA, ImgLain, ImgPatologi, CatatanDokter, UserPasswords).
- Function count: ~179 functions total (top-level + a handful of nested helpers such as z() inside checkWestgardRules, calcCV() inside calcCVFromInputQC, and interp* helpers inside getTrendAnalisisData and getInstrumentCompare).
- Concurrency: LockService.getScriptLock() with 30s timeout, wrapped via withLock(fn) on every mutating call.
- Storage: SpreadsheetApp (bound to SS_ID in ScriptProperties, fallback to active spreadsheet), PropertiesService for SS_ID and Settings, DriveApp for backups and patient images, ScriptApp triggers for daily auto-backup and yearly archive.
- Auth model: first user self-registers as superadmin; subsequent users are created/approved by superadmin. Multi-password per account supported via UserPasswords sheet (with Nama, LoginUsername, Status).
- QC math: bias = (calcMean - targetMean)/targetMean*100; CV = SD/mean*100 (population SD); TE = |bias| + 1.65*CV; sigma = (TEa - |bias|)/CV. v9.10/v9.12 fix: CV taken from observation (calcSD/calcMean), not from Lot/Manufaktur CV.
- Westgard rules implemented: 1-2s (warning), 1-3s, 2-2s (within & across), R-4s (within & across), 4-1s, 6x, 7x, 8x, 10x, 7T. Active rule set depends on sigma (≥6: 1-3s only; 4–6: +2-2s, R-4s; 3–4: +4-1s; <3: full multirule).
- Notable hardcoded values: APP_LOGO_URL points to a Google Drive file id `1pNQRaZmXb-BnsXEvJ3CG36eCRi_Kx3yH`; SMART_PWD = 'didikqc'; default user password when admin creates a user = 'didikqc123'; archive trigger fires on month-day 31 at 23:00; daily backup trigger fires at 02:00; log activity capped at 2000 rows.
- Dead code / quirks identified: notifySuperadminNewUser() is defined but never called; pmeRekapDetail computes `d.deltaREC` (capital C) in the OPSpecs kesimpulan string but the field is named `deltaREc` — would print "undefined" in that branch; ImageAnalysis functions (analyzePatologiImage, uploadImgToDrive) are template/AI-stub style (analyzePatologiImage returns canned text blocks, not real image recognition).
- API surface exposed to google.script.run: doGet, registerUser, loginUser, getUsers, saveUser, deleteUser, getUserPasswords, addUserPassword, editUserPassword, deleteUserPassword, toggleUserPasswordStatus, getKopSurat, saveKopSurat, getParameters, saveParameter, deleteParameter, getLotQC, saveLotQC, deleteLotQC, getLotInfoForAutoFill, getInputQC, getInputQCById, saveInputQC, deleteInputQC, bulkInputQC, getHistoriQC, restoreHistoriQC, deleteHistoriQC, getValidasiData, validateQC, validateQCBulk, getDaftarTEa, saveDaftarTEa, deleteDaftarTEa, getBiasPME, saveBiasPME, deleteBiasPME, getBiasPMEByFilter, getCalcStats, saveCalcStats, saveCalcStatsAllLevels, deleteCalcStats, getSigmaCVOpt, saveSigmaCVOpt, deleteSigmaCVOpt, getCatatanLaporan, saveCatatanLaporan, getCatatanTabulasi, saveCatatanTabulasi, getCatatanDokter, saveCatatanDokter, getSiklusPMEList, getTahunSiklusList, getPeriodeCalcStatsList, getPeriodeSigmaCVOptList, getLogActivity, clearLogActivity, getDashboardData, getGraphData, getSigmaBasedGraphData, getLaporanData, getTrendAnalisisData, getInstrumentCompare, getTabulasiData, getOPSpecsData, smartImportQC, hapusDataPrivat, getInputQCForHapus, setupArchiveTrigger, setupAutoBackupTrigger, removeAutoBackupTrigger, isBackupTriggerActive, backupDatabase, listBackups, restoreSheetFromBackup, exportSheet, getEmailQuota, testEmail, resetDatabase, getImg*/saveImg*/deleteImg* (hemato/urin/malaria/bta/lain/patologi), getInitData, getReportData, getDashboardDetailTrend, getDashboardAnalisisTrend, getAppLogo, getSettings, saveSettings, getLoginSettings, setSetting, initializeSheets, uploadImgToDrive, analyzePatologiImage.
