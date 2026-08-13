# Product Requirements Document (PRD)

# Equipment 360 -- Laboratory Equipment Management System (LEMS)

**Product:** DiDiQC\
**Version:** 1.0\
**Status:** Production Ready\
**Purpose:** Modul tambahan untuk aplikasi DiDiQC.

## 1. Executive Summary

**Konsep Utama**

> One Equipment = One QR Code = One Digital Equipment Passport

Setiap alat memiliki QR unik yang membuka halaman berisi seluruh
informasi alat: - Overview - SOP - Manual - Spesifikasi - Reagen - QC
(integrasi DiDiQC) - Maintenance - Kalibrasi - Breakdown - Dokumen -
Kontrak - Training - History

## 2. Goals

-   Digitalisasi seluruh dokumen alat.
-   Integrasi dengan modul QC DiDiQC.
-   Mendukung SNARS / ISO 15189.
-   Satu QR untuk seluruh informasi alat.

## 3. User Roles

-   Administrator
-   Kepala Laboratorium
-   PJ Alat
-   Teknisi
-   Vendor
-   Auditor (Read Only)

## 4. Sidebar

``` text
Equipment 360
├── Dashboard
├── Master Equipment
├── QR Management
├── Maintenance
├── Calibration
├── Breakdown
├── QC Integration
├── Documents
├── Contracts
├── Vendors
├── Reagents
├── Training
├── Reports
└── Settings
```

## 5. Dashboard

Widget: - Total Equipment - Active - Breakdown - Maintenance Due -
Calibration Due - QC Alert - Contract Expired - Warranty Expired -
Equipment Health Score

Charts: - Status Pie - Maintenance Trend - Breakdown Trend - Heatmap
Utilization - Maintenance Calendar

## 6. Master Equipment

### Identitas

-   Equipment ID
-   Asset Number
-   Nama
-   Brand
-   Model
-   Serial Number
-   Tahun
-   Lokasi
-   PIC
-   Status
-   Foto
-   QR Code

### Spesifikasi

-   Power
-   Voltage
-   Throughput
-   Parameter
-   Sample Volume
-   Communication
-   Temperature
-   Humidity

## 7. Equipment Passport

Tab: 1. Overview 2. Specification 3. SOP 4. Manual 5. Reagents 6. QC 7.
Maintenance 8. Calibration 9. Breakdown 10. Documents 11. Contract 12.
Training 13. History

## 8. QC Integration

Menggunakan data QC yang sudah ada di DiDiQC: - Sigma - CV - Bias -
TEa - Westgard - Levey-Jennings - Trend

Tidak membuat database QC baru.

## 9. Maintenance

-   Preventive
-   Corrective
-   Emergency
-   Checklist
-   Engineer
-   Foto
-   TTD
-   Biaya
-   Timeline

## 10. Calibration

-   Jadwal
-   Sertifikat
-   Vendor
-   Reminder
-   Lampiran

## 11. Breakdown

Workflow: Scan QR → Report Breakdown → Teknisi → Penyelesaian → Riwayat

## 12. Documents

Kategori: - SOP - Manual - IFU - Sertifikat - Kalibrasi - Garansi -
Kontrak - MOU - Invoice - Training - Lainnya

## 13. Notifications

-   Maintenance H-30/H-7/H-1
-   Kalibrasi
-   Kontrak habis
-   Garansi habis
-   QC gagal
-   Sigma \< 4
-   Reagen kedaluwarsa

## 14. Equipment Health Score

Komponen: - QC Performance 30% - Maintenance 20% - Calibration 20% -
Downtime 15% - Contract/Warranty 10% - Document Completeness 5%

## 15. Database

-   equipment
-   equipment_documents
-   equipment_qr
-   equipment_maintenance
-   equipment_calibration
-   equipment_breakdown
-   equipment_contract
-   equipment_training
-   equipment_vendor
-   equipment_history
-   equipment_notifications

## 16. API

-   GET /equipment
-   GET /equipment/{id}
-   POST /equipment
-   PUT /equipment/{id}
-   DELETE /equipment/{id}
-   GET /equipment/{id}/documents
-   GET /equipment/{id}/maintenance
-   GET /equipment/{id}/qc

## 17. Roadmap

### V1

-   Dashboard
-   Master
-   QR
-   Passport
-   Dokumen
-   Maintenance
-   Kalibrasi
-   Integrasi QC

### V2

-   Vendor
-   Kontrak
-   Breakdown
-   Training
-   Health Score
-   Notifikasi

### V3

-   AI Troubleshooting
-   Predictive Maintenance
-   MTBF/MTTR
-   Integrasi LIS/SIMRS
-   IoT

## 18. Nilai Tambah

Digital Equipment Passport menjadi pusat seluruh informasi alat yang
dapat diakses hanya melalui satu QR Code, tanpa duplikasi data QC karena
seluruh indikator mutu diambil langsung dari modul DiDiQC.
