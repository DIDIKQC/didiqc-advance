-- didiQCsys Database Dump
-- Generated: 2026-07-19T23:04:18.004Z
-- Source: SQLite (custom.db) via Prisma
-- Tables: 23
-- NOTE: This dump uses INSERT statements. Table schema is in prisma/schema.prisma.
--       For MySQL/PostgreSQL, run "prisma db push" first to create schema, then import this data.

PRAGMA foreign_keys=OFF;

-- ============================================
-- Table: users (2 rows)
-- ============================================
INSERT INTO "users" ("id","username","password","fullName","role","email","status","otp","otpExpiry","expiryDate","approvedBy","approvedDate","createdDate","lastLogin","imgAnalAccess") VALUES (1,'admin','didikqc123','Admin Utama','superadmin','admin@didikqc.id','active',NULL,NULL,'2027-07-19T00:00:00.000Z','system','2026-07-19T12:42:11.719Z','2026-07-19T12:42:11.721Z','2026-07-19T22:49:23.420Z',1);
INSERT INTO "users" ("id","username","password","fullName","role","email","status","otp","otpExpiry","expiryDate","approvedBy","approvedDate","createdDate","lastLogin","imgAnalAccess") VALUES (3,'testuser','pass123','Test User','user','test@test.com','active',NULL,NULL,'2027-07-19T14:31:52.904Z','',NULL,'2026-07-19T14:31:52.906Z',NULL,0);

-- ============================================
-- Table: parameters (1 rows)
-- ============================================
INSERT INTO "parameters" ("id","parameter","ownerUsername","createdDate","createdBy","bidang") VALUES ('PAR_1784474986387_187','TRIGLISERID','admin','2026-07-19T15:29:46.387Z','admin','KimiaKlinik');

-- ============================================
-- Table: lotqc (1 rows)
-- ============================================
INSERT INTO "lotqc" ("id","paramID","noLot","namaAlat","methode","satuan","expiredDate","sumber","meanL1","sdL1","targetL1","meanL2","sdL2","targetL2","meanL3","sdL3","targetL3","tea","biasPct","ownerUsername") VALUES ('LOT_1784475058106_4904','PAR_1784474986387_187','111','DIALAB','-','mg/dl','2026-07-31','Manufaktur',100,10,100,200,15,200,300,20,300,20,5,'admin');

-- ============================================
-- Table: inputqc (3 rows)
-- ============================================
INSERT INTO "inputqc" ("id","paramID","lotID","parameter","noLot","namaAlat","tanggal","level1","level2","level3","inputBy","inputDate","validated","validatedBy","validatedDate","catatanValidasi","ownerUsername") VALUES ('QC_1784475125238_2421','PAR_1784474986387_187','LOT_1784475058106_4904','TRIGLISERID','111','DIALAB','2026-07-03',106,208,301,'admin','2026-07-19T15:32:05.238Z',0,NULL,NULL,NULL,'admin');
INSERT INTO "inputqc" ("id","paramID","lotID","parameter","noLot","namaAlat","tanggal","level1","level2","level3","inputBy","inputDate","validated","validatedBy","validatedDate","catatanValidasi","ownerUsername") VALUES ('QC_1784500700912_1471','PAR_1784474986387_187','LOT_1784475058106_4904','TRIGLISERID','111','DIALAB','2026-07-01',109,207,299,'admin','2026-07-19T22:38:20.913Z',0,NULL,NULL,NULL,'admin');
INSERT INTO "inputqc" ("id","paramID","lotID","parameter","noLot","namaAlat","tanggal","level1","level2","level3","inputBy","inputDate","validated","validatedBy","validatedDate","catatanValidasi","ownerUsername") VALUES ('QC_1784500700914_2122','PAR_1784474986387_187','LOT_1784475058106_4904','TRIGLISERID','111','DIALAB','2026-07-02',98,197,309,'admin','2026-07-19T22:38:20.914Z',0,NULL,NULL,NULL,'admin');

-- ============================================
-- Table: historiqc (3 rows)
-- ============================================
INSERT INTO "historiqc" ("id","qcid","paramID","lotID","parameter","noLot","namaAlat","tanggal","level1","level2","level3","inputBy","deletedBy","deletedDate","ownerUsername","actionType","changeDetail") VALUES ('HQC_1784501262006_4832','QC_1784475125236_3908','PAR_1784474986387_187','LOT_1784475058106_4904','TRIGLISERID','111','DIALAB','2026-07-01',107,209,308,'admin','admin','2026-07-19T22:47:42.006Z','admin','DATA DIHAPUS','Dihapus via InputQC');
INSERT INTO "historiqc" ("id","qcid","paramID","lotID","parameter","noLot","namaAlat","tanggal","level1","level2","level3","inputBy","deletedBy","deletedDate","ownerUsername","actionType","changeDetail") VALUES ('HQC_1784501416788_7049','QC_1784475125238_1477','PAR_1784474986387_187','LOT_1784475058106_4904','TRIGLISERID','111','DIALAB','2026-07-02',100,205,298,'admin','admin','2026-07-19T22:50:16.788Z','admin','DATA DIHAPUS','Dihapus via InputQC');
INSERT INTO "historiqc" ("id","qcid","paramID","lotID","parameter","noLot","namaAlat","tanggal","level1","level2","level3","inputBy","deletedBy","deletedDate","ownerUsername","actionType","changeDetail") VALUES ('HQC_1784501420277_2038','QC_1784500700915_7551','PAR_1784474986387_187','LOT_1784475058106_4904','TRIGLISERID','111','DIALAB','2026-07-03',103,219,319,'admin','admin','2026-07-19T22:50:20.277Z','admin','DATA DIHAPUS','Dihapus via InputQC');

-- ============================================
-- Table: calculatedstats (0 rows)
-- ============================================
-- (no data)

-- ============================================
-- Table: biaspme (0 rows)
-- ============================================
-- (no data)

-- ============================================
-- Table: daftartea (2 rows)
-- ============================================
INSERT INTO "daftartea" ("id","paramID","parameter","nilaiTEa","referensi","ownerUsername") VALUES ('TEA_1784472400482_3375','PAR_1784465007071_8165','Glukosa',10.5,'Test Ref','admin');
INSERT INTO "daftartea" ("id","paramID","parameter","nilaiTEa","referensi","ownerUsername") VALUES ('TEA_1784475001911_2883','PAR_1784474986387_187','TRIGLISERID',20,'CLIA','admin');

-- ============================================
-- Table: sigmacvopt (0 rows)
-- ============================================
-- (no data)

-- ============================================
-- Table: laporancatatan (1 rows)
-- ============================================
INSERT INTO "laporancatatan" ("id","filterKey","bulanTahun","paramID","lotID","namaAlat","catatan","ownerUsername") VALUES ('CAT_1784500775128_2000','PAR_1784474986387_187_LOT_1784475058106_4904',NULL,'PAR_1784474986387_187','LOT_1784475058106_4904',NULL,'tes apakah catatan ini berfungsi baik','admin');

-- ============================================
-- Table: tabulasikatatan (0 rows)
-- ============================================
-- (no data)

-- ============================================
-- Table: kopsurat (0 rows)
-- ============================================
-- (no data)

-- ============================================
-- Table: settings (8 rows)
-- ============================================
INSERT INTO "settings" ("key","value") VALUES ('theme_primary','#2563eb');
INSERT INTO "settings" ("key","value") VALUES ('sidebar_bg','#0f172a');
INSERT INTO "settings" ("key","value") VALUES ('auto_logout','180');
INSERT INTO "settings" ("key","value") VALUES ('sb_font_size','14');
INSERT INTO "settings" ("key","value") VALUES ('sb_font_weight','500');
INSERT INTO "settings" ("key","value") VALUES ('sb_font_color','#f1f5f9');
INSERT INTO "settings" ("key","value") VALUES ('backup_auto','false');
INSERT INTO "settings" ("key","value") VALUES ('archive_auto','true');

-- ============================================
-- Table: logactivity (61 rows)
-- ============================================
INSERT INTO "logactivity" ("id","timestamp","username","action","detail") VALUES (1,'2026-07-19T12:42:11.723Z','admin','REGISTER','Pendaftaran user pertama (superadmin)');
INSERT INTO "logactivity" ("id","timestamp","username","action","detail") VALUES (2,'2026-07-19T12:42:45.184Z','admin','LOGIN','Login sebagai Admin Utama');
INSERT INTO "logactivity" ("id","timestamp","username","action","detail") VALUES (3,'2026-07-19T12:43:27.030Z','admin','LOGIN','Login sebagai Admin Utama');
INSERT INTO "logactivity" ("id","timestamp","username","action","detail") VALUES (4,'2026-07-19T12:43:27.073Z','superadmin','ADD_PARAM','Glukosa');
INSERT INTO "logactivity" ("id","timestamp","username","action","detail") VALUES (5,'2026-07-19T12:50:49.666Z','admin','LOGIN','Login sebagai Admin Utama');
INSERT INTO "logactivity" ("id","timestamp","username","action","detail") VALUES (6,'2026-07-19T12:51:51.480Z','admin','LOGIN','Login sebagai Admin Utama');
INSERT INTO "logactivity" ("id","timestamp","username","action","detail") VALUES (7,'2026-07-19T12:53:20.528Z','admin','LOGIN','Login sebagai Admin Utama');
INSERT INTO "logactivity" ("id","timestamp","username","action","detail") VALUES (8,'2026-07-19T12:54:40.863Z','admin','LOGIN','Login sebagai Admin Utama');
INSERT INTO "logactivity" ("id","timestamp","username","action","detail") VALUES (9,'2026-07-19T12:55:35.438Z','admin','LOGIN','Login sebagai Admin Utama');
INSERT INTO "logactivity" ("id","timestamp","username","action","detail") VALUES (10,'2026-07-19T12:55:35.476Z','superadmin','ADD_PARAM','Kolesterol');
INSERT INTO "logactivity" ("id","timestamp","username","action","detail") VALUES (11,'2026-07-19T12:56:32.863Z','admin','LOGIN','Login sebagai Admin Utama');
INSERT INTO "logactivity" ("id","timestamp","username","action","detail") VALUES (12,'2026-07-19T12:59:07.643Z','admin','LOGIN','Login sebagai Admin Utama');
INSERT INTO "logactivity" ("id","timestamp","username","action","detail") VALUES (13,'2026-07-19T13:00:27.784Z','admin','LOGIN','Login sebagai Admin Utama');
INSERT INTO "logactivity" ("id","timestamp","username","action","detail") VALUES (14,'2026-07-19T13:00:27.818Z','superadmin','ADD_PARAM','Test1');
INSERT INTO "logactivity" ("id","timestamp","username","action","detail") VALUES (15,'2026-07-19T13:25:39.730Z','admin','LOGIN','Login sebagai Admin Utama');
INSERT INTO "logactivity" ("id","timestamp","username","action","detail") VALUES (16,'2026-07-19T13:53:31.485Z','admin','LOGIN','Login sebagai Admin Utama');
INSERT INTO "logactivity" ("id","timestamp","username","action","detail") VALUES (17,'2026-07-19T13:54:18.976Z','admin','LOGIN','Login sebagai Admin Utama');
INSERT INTO "logactivity" ("id","timestamp","username","action","detail") VALUES (18,'2026-07-19T13:55:17.274Z','admin','LOGIN','Login sebagai Admin Utama');
INSERT INTO "logactivity" ("id","timestamp","username","action","detail") VALUES (19,'2026-07-19T13:55:53.943Z','admin','LOGIN','Login sebagai Admin Utama');
INSERT INTO "logactivity" ("id","timestamp","username","action","detail") VALUES (20,'2026-07-19T13:56:19.442Z','admin','LOGIN','Login sebagai Admin Utama');
INSERT INTO "logactivity" ("id","timestamp","username","action","detail") VALUES (21,'2026-07-19T13:57:49.604Z','admin','LOGIN','Login sebagai Admin Utama');
INSERT INTO "logactivity" ("id","timestamp","username","action","detail") VALUES (22,'2026-07-19T14:16:43.520Z','admin','LOGIN','Login sebagai Admin Utama');
INSERT INTO "logactivity" ("id","timestamp","username","action","detail") VALUES (23,'2026-07-19T14:16:51.275Z','admin','LOGIN','Login sebagai Admin Utama');
INSERT INTO "logactivity" ("id","timestamp","username","action","detail") VALUES (24,'2026-07-19T14:20:27.541Z','admin','LOGIN','Login sebagai Admin Utama');
INSERT INTO "logactivity" ("id","timestamp","username","action","detail") VALUES (25,'2026-07-19T14:22:58.795Z','admin','LOGIN','Login sebagai Admin Utama');
INSERT INTO "logactivity" ("id","timestamp","username","action","detail") VALUES (26,'2026-07-19T14:24:15.271Z','didik','CREATE_USER','Buat user baru: didik (role: superadmin)');
INSERT INTO "logactivity" ("id","timestamp","username","action","detail") VALUES (27,'2026-07-19T14:24:35.003Z','admin','DEL_PARAM','PAR_1784466027816_1985');
INSERT INTO "logactivity" ("id","timestamp","username","action","detail") VALUES (28,'2026-07-19T14:30:53.527Z','admin','LOGIN','Login sebagai Admin Utama');
INSERT INTO "logactivity" ("id","timestamp","username","action","detail") VALUES (29,'2026-07-19T14:31:52.908Z','testuser','CREATE_USER','Buat user baru: testuser (role: user)');
INSERT INTO "logactivity" ("id","timestamp","username","action","detail") VALUES (30,'2026-07-19T14:45:39.187Z','admin','LOGIN','Login sebagai Admin Utama');
INSERT INTO "logactivity" ("id","timestamp","username","action","detail") VALUES (31,'2026-07-19T14:46:11.602Z','testuser2','CREATE_USER','Buat user baru: testuser2 (role: user)');
INSERT INTO "logactivity" ("id","timestamp","username","action","detail") VALUES (32,'2026-07-19T14:46:27.944Z','admin','ADD_PARAM','TestParam');
INSERT INTO "logactivity" ("id","timestamp","username","action","detail") VALUES (33,'2026-07-19T14:47:36.576Z','admin','LOGIN','Login sebagai Admin Utama');
INSERT INTO "logactivity" ("id","timestamp","username","action","detail") VALUES (34,'2026-07-19T14:48:18.232Z','admin','LOGIN','Login sebagai Admin Utama');
INSERT INTO "logactivity" ("id","timestamp","username","action","detail") VALUES (35,'2026-07-19T15:27:18.796Z','admin','LOGIN','Login sebagai Admin Utama');
INSERT INTO "logactivity" ("id","timestamp","username","action","detail") VALUES (36,'2026-07-19T15:28:35.983Z','admin','LOGIN','Login sebagai Admin Utama');
INSERT INTO "logactivity" ("id","timestamp","username","action","detail") VALUES (37,'2026-07-19T15:29:46.389Z','admin','ADD_PARAM','TRIGLISERID');
INSERT INTO "logactivity" ("id","timestamp","username","action","detail") VALUES (38,'2026-07-19T15:30:58.108Z','admin','ADD_LOT','LOT_1784475058106_4904');
INSERT INTO "logactivity" ("id","timestamp","username","action","detail") VALUES (39,'2026-07-19T15:32:05.240Z','admin','BULK_QC','3 data ditambahkan');
INSERT INTO "logactivity" ("id","timestamp","username","action","detail") VALUES (40,'2026-07-19T22:26:14.955Z','admin','LOGIN','Login sebagai Admin Utama');
INSERT INTO "logactivity" ("id","timestamp","username","action","detail") VALUES (41,'2026-07-19T22:26:39.802Z','ddk','CREATE_USER','Buat user baru: ddk (role: superadmin)');
INSERT INTO "logactivity" ("id","timestamp","username","action","detail") VALUES (42,'2026-07-19T22:29:26.029Z','admin','LOGIN','Login sebagai Admin Utama');
INSERT INTO "logactivity" ("id","timestamp","username","action","detail") VALUES (43,'2026-07-19T22:29:53.347Z','admin','LOGIN','Login sebagai Admin Utama');
INSERT INTO "logactivity" ("id","timestamp","username","action","detail") VALUES (44,'2026-07-19T22:31:55.707Z','admin','LOGIN','Login sebagai Admin Utama');
INSERT INTO "logactivity" ("id","timestamp","username","action","detail") VALUES (45,'2026-07-19T22:32:17.551Z','admin','LOGIN','Login sebagai Admin Utama');
INSERT INTO "logactivity" ("id","timestamp","username","action","detail") VALUES (46,'2026-07-19T22:35:40.077Z','admin','LOGIN','Login sebagai Admin Utama');
INSERT INTO "logactivity" ("id","timestamp","username","action","detail") VALUES (47,'2026-07-19T22:36:10.697Z','testuser2','DELETE_USER','Hapus user: testuser2');
INSERT INTO "logactivity" ("id","timestamp","username","action","detail") VALUES (48,'2026-07-19T22:36:18.952Z','didik','DELETE_USER','Hapus user: didik');
INSERT INTO "logactivity" ("id","timestamp","username","action","detail") VALUES (49,'2026-07-19T22:36:21.316Z','ddk','DELETE_USER','Hapus user: ddk');
INSERT INTO "logactivity" ("id","timestamp","username","action","detail") VALUES (50,'2026-07-19T22:36:29.844Z','admin','EDIT_USER','Update user: admin');
INSERT INTO "logactivity" ("id","timestamp","username","action","detail") VALUES (51,'2026-07-19T22:36:47.765Z','admin','LOGIN','Login sebagai Admin Utama');
INSERT INTO "logactivity" ("id","timestamp","username","action","detail") VALUES (52,'2026-07-19T22:38:20.916Z','admin','BULK_QC','3 data ditambahkan');
INSERT INTO "logactivity" ("id","timestamp","username","action","detail") VALUES (53,'2026-07-19T22:43:41.929Z','admin','LOGIN','Login sebagai Admin Utama');
INSERT INTO "logactivity" ("id","timestamp","username","action","detail") VALUES (54,'2026-07-19T22:45:59.809Z','admin','LOGIN','Login sebagai Admin Utama');
INSERT INTO "logactivity" ("id","timestamp","username","action","detail") VALUES (55,'2026-07-19T22:47:42.010Z','admin','DEL_QC','QC_1784475125236_3908|Dihapus via InputQC');
INSERT INTO "logactivity" ("id","timestamp","username","action","detail") VALUES (56,'2026-07-19T22:49:23.424Z','admin','LOGIN','Login sebagai Admin Utama');
INSERT INTO "logactivity" ("id","timestamp","username","action","detail") VALUES (57,'2026-07-19T22:50:16.791Z','admin','DEL_QC','QC_1784475125238_1477|Dihapus via InputQC');
INSERT INTO "logactivity" ("id","timestamp","username","action","detail") VALUES (58,'2026-07-19T22:50:20.280Z','admin','DEL_QC','QC_1784500700915_7551|Dihapus via InputQC');
INSERT INTO "logactivity" ("id","timestamp","username","action","detail") VALUES (59,'2026-07-19T22:50:38.107Z','admin','DEL_PARAM','PAR_1784472387933_7757');
INSERT INTO "logactivity" ("id","timestamp","username","action","detail") VALUES (60,'2026-07-19T22:50:43.099Z','admin','DEL_PARAM','PAR_1784465735473_5060');
INSERT INTO "logactivity" ("id","timestamp","username","action","detail") VALUES (61,'2026-07-19T22:50:45.136Z','admin','DEL_PARAM','PAR_1784465007071_8165');

-- ============================================
-- Table: catatandokter (0 rows)
-- ============================================
-- (no data)

-- ============================================
-- Table: userpasswords (0 rows)
-- ============================================
-- (no data)

-- ============================================
-- Table: imghemato (0 rows)
-- ============================================
-- (no data)

-- ============================================
-- Table: imgurin (0 rows)
-- ============================================
-- (no data)

-- ============================================
-- Table: imgmalaria (0 rows)
-- ============================================
-- (no data)

-- ============================================
-- Table: imgbta (0 rows)
-- ============================================
-- (no data)

-- ============================================
-- Table: imglain (0 rows)
-- ============================================
-- (no data)

-- ============================================
-- Table: imgpatologi (0 rows)
-- ============================================
-- (no data)

-- ============================================
-- Table: sessions (0 rows)
-- ============================================
-- (no data)

