# 🏗️ ARSITEKTUR APLIKASI didiQCsys v9.31

> Penjelasan komprehensif tentang arsitektur, design pattern, dan data flow aplikasi didiQCsys.

---

## 🎯 RINGKASAN ARSITEKTUR

didiQCsys adalah aplikasi **Quality Control Laboratorium Klinis** yang di-porting dari Google Apps Script (GAS) ke Next.js 16. Strategi utama: **pertahankan 100% kode frontend asli** (HTML/CSS/JS) dan **porting hanya backend** ke TypeScript.

### Prinsip Desain
1. **Frontend preservation**: `public/app.html` (7,973 baris) tidak diubah strukturnya
2. **Shim pattern**: `google.script.run` GAS di-override → `POST /api/rpc`
3. **Backend port**: 180+ fungsi GAS → 17 modul TypeScript
4. **Multi-tenant**: setiap akun punya database privat
5. **Session-based auth**: HMAC signed cookies, no JWT complexity

---

## 📐 DIAGRAM ARSITEKTUR

```
┌──────────────────────────────────────────────────────────────────┐
│                    BROWSER USER                                   │
│                                                                   │
│  public/app.html (7,973 baris)                                    │
│  ┌────────────────────────────────────────────────────────────┐  │
│  │  FRONTEND HTML/CSS/JS ASLI DARI GOOGLE APPS SCRIPT         │  │
│  │  • Chart.js + chartjs-plugin-annotation                  │  │
│  │  • jsPDF + html2canvas + qrcodejs                        │  │
│  │  • Font Awesome + Google Inter font                     │  │
│  │  • google.script.run SHIM (override ke POST /api/rpc)    │  │
│  │  • Sidebar 47 menu, dashboard, grafik LJ, laporan, dll   │  │
│  └────────────────────────────────────────────────────────────┘  │
│                              │                                    │
└──────────────────────────────┼────────────────────────────────────┘
                               │
                               │ (1) google.script.run.fn(args)
                               │     → POST /api/rpc
                               │     Cookie: session=<HMAC>
                               │     Body: {"fn":"FUNCTION","args":[...]}
                               │
┌──────────────────────────────▼────────────────────────────────────┐
│                    NEXT.JS 16 (App Router)                         │
│                                                                   │
│  src/app/page.tsx (99 baris)                                      │
│  ┌────────────────────────────────────────────────────────────┐  │
│  │  Wrapper iframe → loads /app.html                          │  │
│  │  Pass session info via postMessage or URL params          │  │
│  └────────────────────────────────────────────────────────────┘  │
│                              │                                    │
│  src/app/api/rpc/route.ts (183 baris)                            │
│  ┌────────────────────────────────────────────────────────────┐  │
│  │  POST handler:                                            │  │
│  │  1. Parse body {fn, args}                                  │  │
│  │  2. Read session cookie → verify HMAC                     │  │
│  │  3. Dispatch ke backend-handlers.ts                       │  │
│  │  4. Return JSON result                                     │  │
│  └────────────────────────────────────────────────────────────┘  │
└──────────────────────────────┼────────────────────────────────────┘
                               │
                               │ (2) Call: HANDLER[args, session]
                               │
┌──────────────────────────────▼────────────────────────────────────┐
│                    BACKEND (src/lib/backend/)                     │
│                                                                   │
│  backend-handlers.ts (312 baris)                                 │
│  ┌────────────────────────────────────────────────────────────┐  │
│  │  Map<string, Function> registry:                          │  │
│  │  'loginUser' → auth.loginUser                              │  │
│  │  'getParameters' → master-data.getParameters                │  │
│  │  'saveInputQC' → inputqc.saveInputQC                       │  │
│  │  'getGrafikData' → graph.getGrafikData                     │  │
│  │  ... (200+ registered functions)                          │  │
│  └────────────────────────────────────────────────────────────┘  │
│                              │                                    │
│  17 modul backend TypeScript (~10,000 baris total):              │
│  • auth.ts          • users.ts         • master-data.ts         │
│  • inputqc.ts       • calculations.ts  • westgard.ts             │
│  • graph.ts         • dashboard.ts     • reports.ts             │
│  • images.ts        • backup.ts        • smart-import.ts        │
│  • misc.ts          • qc-helpers.ts     • multi-master.ts       │
│  • equipment.ts     • import-db.ts                              │
└──────────────────────────────┼────────────────────────────────────┘
                               │
                               │ (3) Prisma Client queries
                               │     where: { ownerUsername: session.username }
                               │
┌──────────────────────────────▼────────────────────────────────────┐
│                    DATABASE LAYER                                 │
│                                                                   │
│  src/lib/db.ts (106 baris)                                       │
│  ┌────────────────────────────────────────────────────────────┐  │
│  │  Prisma Client singleton (avoid connection exhaustion)    │  │
│  │  Datasource: env(DATABASE_URL)                             │  │
│  └────────────────────────────────────────────────────────────┘  │
│                              │                                    │
│  prisma/schema.prisma (907 baris)                                │
│  ┌────────────────────────────────────────────────────────────┐  │
│  │  23 model PostgreSQL:                                     │  │
│  │  Users, UserPasswords, Sessions, Parameters, LotQC,       │  │
│  │  InputQC, HistoriQC, CalculatedStats, BiasPME,            │  │
│  │  SigmaCVOpt, DaftarTEa, KopSurat, Settings,               │  │
│  │  LogActivity, Equipment, Maintenance, Kalibrasi,          │  │
│  │  PatologiAnatomi, ImageHematologi, ImageUrine,            │  │
│  │  ImageMalaria, ImageBTA, ...                              │  │
│  └────────────────────────────────────────────────────────────┘  │
└──────────────────────────────┼────────────────────────────────────┘
                               │
                               │ (4) SQL queries
                               │
┌──────────────────────────────▼────────────────────────────────────┐
│  PostgreSQL (InsForge / lokal)                                    │
│  Host: rz7b4fhh.ap-southeast.database.insforge.app:5432          │
│  DB: insforge · 23 tabel · data multi-tenant                      │
└──────────────────────────────────────────────────────────────────┘
```

---

## 🔌 SHIM PATTERN: google.script.run → /api/rpc

### Cara Kerja Shim

Di `public/app.html`, ada shim JavaScript yang meng-override `google.script.run`:

```javascript
// Pseudo-code (versi simplified)
window.google = window.google || {};
google.script = {
  run: {
    _queue: [],
    withSuccessHandler(fn) { this._success = fn; return this; },
    withFailureHandler(fn) { this._failure = fn; return this; },
    // Setiap function call di-proxies ke /api/rpc
    ...new Proxy({}, {
      get(target, prop) {
        return function(...args) {
          fetch('/api/rpc', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ fn: prop, args }),
            credentials: 'include',  // kirim cookie session
          })
          .then(r => r.json())
          .then(result => {
            if (result.error) {
              this._failure?.(new Error(result.error));
            } else {
              this._success?.(result.data);
            }
          });
          return this;
        };
      }
    })
  }
};
```

### Setiap Panggilan Frontend
```javascript
// Di frontend (app.html)
google.script.run
  .withSuccessHandler(onSuccess)
  .withFailureHandler(onError)
  .getParameters();
```

### Menjadi HTTP Request
```http
POST /api/rpc HTTP/1.1
Content-Type: application/json
Cookie: session=<HMAC-signed-value>

{"fn":"getParameters","args":[]}
```

### Response
```http
HTTP/1.1 200 OK
Content-Type: application/json

{"data":[{"id":"PAR_...","parameter":"GLUKOSA","bidang":"KimiaKlinik",...}]}
```

---

## 🔐 SESSION & AUTHENTICATION

### Alur Login
```
Browser                    Next.js              Backend
   │                          │                    │
   │  POST /api/rpc           │                    │
   │  {fn:"loginUser",       │                    │
   │   args:["admin","xxx"]} │                    │
   │ ─────────────────────────▶│                    │
   │                          │  dispatch ke        │
   │                          │  auth.loginUser()   │
   │                          │ ────────────────────▶│
   │                          │                    │
   │                          │                    │  Prisma: users.findUnique
   │                          │                    │  verify bcrypt hash
   │                          │                    │
   │                          │  SessionData {      │
   │                          │    username, role,  │
   │                          │    isSecondary,     │
   │                          │    ...              │
   │                          │  }                 │
   │                          │  Sign with HMAC     │
   │                          │  Set-Cookie: session │
   │                          │ ◀────────────────────│
   │  200 OK                  │                    │
   │  Set-Cookie: session=... │                    │
   │ ◀─────────────────────────│                    │
   │                          │                    │
```

### SessionData Structure (`src/lib/session.ts`)
```typescript
interface SessionData {
  username: string;       // active username (could be View-As target)
  role: string;            // 'superadmin' | 'user' | 'secondary' (role sesi)
  realUsername: string;   // actual logged-in user (untuk password tambahan)
  realRole: string;       // role asli akun induk
  isSecondary?: boolean;  // true jika login via password tambahan
  accessMenu?: string|null; // "" = penuh; "grpEquipment,grpImageAnalysis" = restrict
}
```

### HMAC Cookie Signing
```typescript
// src/lib/session.ts
function sign(data: SessionData): string {
  const payload = base64url(JSON.stringify(data));
  const signature = hmacSha256(payload, SECRET_KEY);
  return `${payload}.${signature}`;
}

function verify(cookie: string): SessionData | null {
  const [payload, signature] = cookie.split('.');
  if (hmacSha256(payload, SECRET_KEY) !== signature) return null;
  return JSON.parse(base64url.decode(payload));
}
```

---

## 🏢 MULTI-TENANT ISOLATION

### Pattern Utama: `ownerUsername` Filtering

Setiap tabel yang punya data per-akun punya field `ownerUsername`. Backend selalu filter:

```typescript
// src/lib/backend/master-data.ts (simplified)
async function getParameters(args: any[], session: SessionData | null) {
  const activeUsername = session?.username; // bisa View-As target
  return await db.parameters.findMany({
    where: { ownerUsername: activeUsername },
    orderBy: { parameter: 'asc' }
  });
}
```

### View As Superadmin
Superadmin bisa "melihat sebagai" user lain. Saat View As aktif:
- `session.username` = target user (bukan superadmin)
- `session.realUsername` = superadmin (asli)
- Semua query filter by `session.username` → data user target

### Tables dengan `ownerUsername`
- `parameters`, `lotQC`, `inputQC`, `historiQC`
- `calculatedStats`, `biasPME`, `sigmaCVOpt`, `daftarTEa`
- `equipment`, `maintenance`, `kalibrasi`
- `patologiAnatomi`, `imageHematologi`, `imageUrine`, dll

### Tables TANPA `ownerUsername` (global)
- `users` (akun login)
- `userPasswords` (link ke user)
- `sessions` (auth)
- `settings` (per-app global, tapi access dibatasi ke superadmin)

### Defense-in-Depth
1. **Backend**: setiap query filter by `ownerUsername`
2. **Frontend**: sidebar, view-as, goPage guard
3. **Backend role gate**: `if (session.isSecondary) return 'Akses ditolak'` untuk Users, Pengaturan, Backup, Import

---

## 📋 RPC DISPATCHER (`src/app/api/rpc/route.ts`)

```typescript
// Simplified
import { handlers } from '@/lib/backend-handlers';
import { getSession } from '@/lib/session';

export async function POST(request: Request) {
  // 1. Parse body
  const { fn, args } = await request.json();
  
  // 2. Get session from cookie
  const session = await getSession(request);
  
  // 3. Find handler
  const handler = handlers[fn];
  if (!handler) {
    return Response.json({ error: `Unknown function: ${fn}` }, { status: 404 });
  }
  
  // 4. Call handler dengan args dan session
  try {
    const result = await handler(args || [], session);
    return Response.json({ data: result });
  } catch (err) {
    return Response.json({ error: err.message }, { status: 500 });
  }
}
```

---

## 🗃️ BACKEND MODULES

### `src/lib/backend-handlers.ts` (Registry)
```typescript
import * as auth from './backend/auth';
import * as masterData from './backend/master-data';
// ... import semua modul

export const handlers: Record<string, (args: any[], session: SessionData | null) => Promise<any>> = {
  // === AUTH ===
  'loginUser': auth.loginUser,
  'logoutUser': auth.logoutUser,
  'getSession': auth.getSession,
  
  // === USERS ===
  'getUsers': users.getUsers,
  'saveUser': users.saveUser,
  'deleteUser': users.deleteUser,
  'approveUser': users.approveUser,
  'getUserPasswords': users.getUserPasswords,
  'addUserPassword': users.addUserPassword,
  // ... 200+ registered functions
};
```

### Backend Function Signature (STRICT PATTERN)
```typescript
// Setiap function backend HARUS pakai signature ini:
export async function getParameters(
  args: any[],              // argumen dari frontend
  session: SessionData | null  // session user (null jika belum login)
): Promise<any> {
  // 1. Validate session (biasanya)
  if (!session) throw new Error('Not authenticated');
  
  // 2. Extract args
  const [bidang] = args;
  
  // 3. Query database (filter by ownerUsername!)
  const result = await db.parameters.findMany({
    where: { 
      ownerUsername: session.username,
      ...(bidang && { bidang })
    }
  });
  
  // 4. Return result (akan dikirim ke frontend)
  return result;
}
```

---

## 📊 DATA MODEL PRISMA

### Schema Overview (907 baris)

```prisma
// prisma/schema.prisma
generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

// === 1. USERS ===
model Users {
  id            Int      @id @default(autoincrement())
  username      String   @unique
  password      String
  fullName      String
  role          String   @default("user") // superadmin | user
  email         String?
  status        String   @default("active") // active | pending | rejected
  expiryDate    DateTime?
  imgAnalAccess Boolean  @default(false)
  // ...
  @@map("users")
}

// === 2. USER PASSWORDS (multi-password) ===
model UserPasswords {
  id          Int      @id @default(autoincrement())
  username    String
  password    String
  label       String?
  status      String   @default("active")
  accessMenu  String?  // "", "grpEquipment", "grpImageAnalysis", dll
  createdDate DateTime @default(now())
  @@map("user_passwords")
}

// === 3. PARAMETERS (per-akun) ===
model Parameters {
  id            String   @id
  parameter     String
  ownerUsername String
  bidang        String
  satuan        String?
  metode        String?
  createdDate   DateTime @default(now())
  // ...
  @@index([ownerUsername])
  @@map("parameters")
}

// === 4. LOT QC ===
model LotQC {
  id            String   @id
  lotNumber     String
  expiredDate   DateTime?
  ownerUsername String
  parameterId   String
  // ...
  @@index([ownerUsername])
  @@map("lot_q_c")
}

// === 5. INPUT QC ===
model InputQC {
  id            Int      @id @default(autoincrement())
  parameterId   String
  lotId         String
  ownerUsername String
  tanggal       DateTime
  level1        Float?
  level2        Float?
  level3        Float?
  // ...
  @@index([ownerUsername])
  @@map("input_q_c")
}

// ... 23 model total
```

---

## 🎨 FRONTEND STRUCTURE (`public/app.html`)

### File Stats
- **Size**: 784 KB
- **Lines**: 7,973
- **Blocks**: 4 script blocks (inline JavaScript)

### Struktur HTML
```html
<!DOCTYPE html>
<html lang="id">
<head>
  <!-- CDN: Chart.js, jsPDF, html2canvas, qrcodejs, Font Awesome, Inter font -->
</head>
<body>
  <!-- LOGIN PAGE (hidden setelah login) -->
  <div id="loginPage">
    <form id="loginForm">...</form>
  </div>
  
  <!-- MAIN APP (hidden sebelum login) -->
  <div id="mainApp" style="display:none">
    <!-- Sidebar dengan 47+ menu -->
    <aside id="sidebar">
      <nav id="sidebarNav">
        <!-- MENU UTAMA -->
        <!-- PENGATURAN -->
        <!-- IMAGE ANALYSIS -->
        <!-- MANAJEMEN ALAT LAB -->
        <!-- MULTI MASTER (superadmin only) -->
      </nav>
    </aside>
    
    <!-- Main content -->
    <main id="mainContent">
      <header id="topbar">
        <button onclick="refreshAppData()">Muat Data</button>
        <select id="viewAsSelect">Lihat Sebagai</select>
        <button onclick="doLogout()">Keluar</button>
      </header>
      
      <!-- 47 page divs (dashboard, inputqc, grafik, dll) -->
      <div id="pageDashboard">...</div>
      <div id="pageInputQC">...</div>
      <div id="pageGrafik">...</div>
      <!-- ... 44 more pages -->
    </main>
  </div>
  
  <!-- MODALS -->
  <div id="modalLot">...</div>
  <div id="modalParam">...</div>
  <div id="modalUserPwd">...</div>
  <!-- ... 20+ modals -->
  
  <!-- 4 SCRIPT BLOCKS -->
  <script>/* Block 1: data & state */</script>
  <script>/* Block 2: utility functions */</script>
  <script>/* Block 3: page renderers */</script>
  <script>/* Block 4: init & event handlers */</script>
</body>
</html>
```

### Frontend State Management
```javascript
// Global state (di script block 1)
let CU = {
  username: '',
  role: '',
  isSecondary: false,
  accessMenu: '',
  imgAnalAccess: false,
};

let CD = {
  params: [],        // semua parameter user
  lots: [],          // semua lot user
  teaList: [],       // daftar TEa
  settings: {},      // settings global
  allUsers: [],      // semua user (superadmin only)
  equipment: [],     // equipment user
  // ...
};

// Setiap kali data berubah, re-render via:
// - populateFilters() untuk dropdown
// - loadCurrentPage() untuk halaman aktif
// - renderXTable() untuk tabel spesifik
```

### Sidebar Menu Structure (47 menu untuk superadmin)
```
MENU UTAMA
├── Dashboard
├── Input QC
├── Histori QC
├── Validasi QC
├── Grafik & Analisis
├── Laporan
├── Trend Analisis
├── Instrument Compare
├── Tabulasi Rekap
├── Analisis OPSpecs
├── Calc Stats
├── Bias PME
├── Sigma CV Opt
├── Smart Import
└── Export DB / Import DB (superadmin only)

MASTER DATA
├── Parameter
├── Lot QC
├── Daftar TEa
├── Kop Surat
└── Multi Master (superadmin only)

PENGATURAN
└── Pengaturan (superadmin only)

USERS (superadmin only)
└── Users

IMAGE ANALYSIS
├── Hematologi
├── Urine
├── Malaria
├── BTA
├── Patologi Anatomi
├── Dashboard PA
├── Laporan PA
└── Digit

MANAJEMEN ALAT LAB (Equipment 360)
├── Dashboard Alat
├── Master Equipment
├── Maintenance
├── Kalibrasi
└── ...
```

---

## 🔄 DATA FLOW: ADD PARAMETER

### Contoh lengkap: tambah parameter baru

```
1. User klik "Tambah Parameter" di sidebar
   ↓
2. goPage('masterparam') dipanggil
   ↓
3. Modal #modalParam ditampilkan
   ↓
4. User isi form: parameter, bidang, satuan, metode
   ↓
5. User klik "Simpan"
   ↓
6. saveParamAction() dijalankan:
   const param = {
     id: 'PAR_' + Date.now() + '_' + Math.floor(Math.random()*9999),
     parameter: inputParameter,
     bidang: inputBidang,
     satuan: inputSatuan,
     metode: inputMetode,
     ownerUsername: CU.username  // tenant isolation!
   };
   google.script.run
     .withSuccessHandler(onSaveSuccess)
     .saveParameter(param);
   ↓
7. Shim intercept: POST /api/rpc
   Body: {"fn":"saveParameter","args":[param]}
   Cookie: session=<HMAC>
   ↓
8. route.ts: parse body, get session, dispatch ke handlers['saveParameter']
   ↓
9. master-data.ts saveParameter(args, session):
   - Validate session
   - Validate args[0] is object
   - Override ownerUsername dengan session.username (defense)
   - db.parameters.create({ data: args[0] })
   ↓
10. PostgreSQL insert row
   ↓
11. Return result to frontend
   ↓
12. onSaveSuccess(result) dipanggil:
   - Close modal
   - Toast "Tersimpan"
   - CD.params.push(result) — update local state
   - populateFilters() — re-render dropdown
   - loadCurrentPage() — re-render table
   ↓
13. User lihat parameter baru di tabel
```

---

## 🎯 WESTGARD RULES ENGINE

### Pattern Detection
```typescript
// src/lib/backend/westgard.ts (simplified)
function detectWestgardRules(
  data: QCPoint[],  // [{ value, mean, sd, level, run }, ...]
  config: { rules: string[], mode: 'single' | 'across' }
): Violation[] {
  const violations: Violation[] = [];
  
  // 1-3s: 1 titik melebihi ±3SD
  // 2-2s: 2 titik berturut-turut melebihi ±2SD (same side)
  // R-4s: 1 titik >+2SD, titik berikutnya <-2SD (atau sebaliknya)
  // 4-1s: 4 titik berturut-turut melebihi ±1SD (same side)
  // 6x: 6 titik berturut-turut di sisi mean yang sama (single run)
  // 7x, 8x, 10x: 7/8/10 titik berturut-turut di sisi mean yang sama
  // 7T: 7 titik berturut-turut naik (atau turun) — trend
  
  // Across run mode: gabungkan semua level QC
  // 6x across run: 3 titik L1 + 3 titik L2 di bawah mean = 6 titik → violation!
  
  return violations;
}
```

### QGI (Quality Goal Index)
```
QGI = |Bias| / TEa

if QGI < 1.0  → dominan Random Error
if QGI > 1.0  → dominan Systematic Error
if QGI ≈ 1.0  → keduanya
```

---

## 🌍 I18N SYSTEM (ID/EN)

### Implementation
```javascript
// PHRASES dictionary (779 pairs)
const PHRASES = {
  'Selamat Datang': 'Welcome',
  'Masuk': 'Sign In',
  'Daftar': 'Register',
  'Grafik & Analisis': 'Graph & Analysis',
  'Laporan': 'Report',
  // ... 779 total
};

const PHRASES_REV = Object.fromEntries(
  Object.entries(PHRASES).filter(([k, v]) => k !== v)
    .map(([k, v]) => [v, k])
);

// Translate text node
function _t(text, lang) {
  const trimmed = text.trim();
  const map = lang === 'en' ? PHRASES : PHRASES_REV;
  const translated = map[trimmed] || trimmed;
  // preserve whitespace
  return text.replace(trimmed, translated);
}

// Walk DOM recursively
function _translateNode(node, lang) {
  if (node.nodeType === Node.TEXT_NODE) {
    node.textContent = _t(node.textContent, lang);
  } else if (node.nodeType === Node.ELEMENT_NODE) {
    if (['SCRIPT', 'STYLE'].includes(node.tagName)) return;
    // Translate attributes (placeholder, title)
    if (node.placeholder) node.placeholder = _t(node.placeholder, lang);
    if (node.title) node.title = _t(node.title, lang);
    // Recurse children
    node.childNodes.forEach(child => _translateNode(child, lang));
  }
}

// MutationObserver for dynamic content
const observer = new MutationObserver(debounce(() => {
  _translateNode(document.body, currentLang);
}, 180));
observer.observe(document.body, { childList: true, subtree: true });
```

---

## 🔍 SEARCHABLE COMBOBOX (v9.31)

### Architecture
```
<select id="grafParam" class="ss-src" style="display:none">
  <!-- asli select, sumber nilai tunggal -->
  <option value="">-- Pilih --</option>
  <option value="GLUKOSA">GLUKOSA</option>
  <option value="KOLESTEROL">KOLESTEROL</option>
  ...
</select>

<div class="ss-wrap">
  <input class="ss-input" placeholder="Ketik untuk mencari..." />
  <i class="ss-arrow fa fa-chevron-down"></i>
  <ul class="ss-panel" style="display:none">
    <li data-value="GLUKOSA" class="ss-item">GLUKOSA</li>
    <li data-value="KOLESTEROL" class="ss-item">KOLESTEROL</li>
    ...
  </ul>
</div>
```

### Sync 3 Jalur
1. **Property override** `select.value`: tangkap reset programatik
2. **MutationObserver childList**: tangkap innerHTML rebuild
3. **Event change**: tangkap perubahan dari kode lama

---

## 🛠️ EQUIPMENT 360 MODULE

### Schema
```prisma
model Equipment {
  id              String @id
  ownerUsername   String
  nama            String
  jenis           String
  status          String   // active | servicing | retired
  kepemilikan     String   // milik_sendiri | vendor | kso
  vendor          String?
  ksoStart        DateTime?
  ksoEnd          DateTime?
  photoUrl        String?
  parameterIds    String?  // comma-separated parameter ID
  // ...
}

model Maintenance {
  id           String @id
  equipmentId  String
  signatureUrl String?
  // ...
}

model Kalibrasi {
  id          String @id
  equipmentId String
  tanggal     DateTime
  // ...
}
```

### Sigma Linkage
- Saat equipment di-link ke parameter (via `parameterIds`):
  - Backend `computeLinkedQCStats(equipmentId, session)`:
    - Parse parameterIds (comma-separated)
    - Ambil InputQC untuk setiap parameter
    - Hitung sigma L1/L2/L3 per parameter
    - Return sigma matrix

---

## 📈 DASHBOARD AGGREGATION

### Data Flow Dashboard
```
1. User buka dashboard
   ↓
2. loadDashboard() → 8 RPC calls paralel:
   - getDashboardStats(session.username)
   - getSigmaPerBidang(session.username)
   - getCVPerBidang(session.username)
   - getBiasPerBidang(session.username)
   - getTrendBulanBerjalan(session.username)
   - getOnlineUsers() (superadmin only)
   - getRegisteredUsers() (superadmin only)
   - getActiveUsers() (superadmin only)
   ↓
3. Backend aggregate per bidang:
   - For each bidang in user.parameters:
     - Hitung total QC
     - Hitung mean, sd, cv per level
     - Hitung bias per level (vs peer group)
     - Hitung sigma per level
   ↓
4. Return aggregated data
   ↓
5. Frontend render cards + Chart.js charts
```

---

## 🔄 REPORTS MODULE

### Generated Reports
1. **Laporan Rentang Tanggal** — tabel QC + grafik LJ per parameter
2. **Trend Analisis** — grafik perubahan mean/SD/CV/bias per bulan
3. **Instrument Compare** — bandingkan 2 instrument untuk parameter sama
4. **Tabulasi Rekap** — rekap per parameter & bulan
5. **Analisis OPSpecs** — OPSpecs chart untuk parameter terpilih
6. **Laporan PA** — laporan Patologi Anatomi dengan filter
7. **Laporan Equipment** — laporan per-alat dengan filter

### Export Formats
- Print (browser native)
- PDF (via jsPDF + html2canvas)
- Excel (via custom XLSX generator)
- CSV (untuk laporan PA)
- Screenshot (via html2canvas)

---

## 🔒 SECURITY CONSIDERATIONS

### Defense Layers
1. **Session HMAC**: cookie signed, tidak bisa di-tamper
2. **Tenant isolation**: setiap query filter by `ownerUsername`
3. **Role gate**: superadmin vs user vs secondary
4. **CORS**: Vercel config set X-Frame-Options: SAMEORIGIN
5. **Input validation**: setiap backend function validate args
6. **SQL injection**: Prisma parameterized queries (no raw SQL)

### Tidak Ada di Bundle
- `.env` (berisi DB credentials)
- `node_modules/` (tergantung OS)
- Database (data produksi)
- `.git/` (history — tidak perlu untuk jalan)

---

## 🎯 PERFORMANCE TUNING

### Backend
- Prisma Client singleton (avoid connection exhaustion)
- Index di `ownerUsername` untuk semua tabel multi-tenant
- Connection pooling: `?pgbouncer=true&connect_timeout=15`
- Serverless-friendly: cold start optimized

### Frontend
- iframe loading="eager" untuk app.html
- Chart.js animation disabled untuk large datasets
- Pagination untuk tabel besar (>100 rows)
- MutationObserver dengan debounce 180ms

### Vercel
- `maxDuration: 60` untuk /api/rpc (untuk operasi berat)
- `output: "standalone"` di next.config.ts
- Region: sin1 (Singapore, dekat dengan InsForge ap-southeast)

---

## 🐛 DEBUGGING TIPS

### Backend
```bash
# Lihat dev.log untuk error backend
tail -f /home/z/my-project/dev.log | grep -i error

# Test RPC manual
curl -X POST http://localhost:3000/api/rpc \
  -H "Content-Type: application/json" \
  -d '{"fn":"getParameters","args":[]}' \
  --cookie "session=<value>"
```

### Frontend
```javascript
// Di browser console
console.log(CU);  // lihat session user
console.log(CD);  // lihat cached data

// Test RPC manual
fetch('/api/rpc', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ fn: 'getParameters', args: [] }),
  credentials: 'include'
}).then(r => r.json()).then(console.log);
```

### Database
```bash
# Buka Prisma Studio (GUI untuk database)
bunx prisma studio
# Buka http://localhost:5555
```

---

## 📚 BACAAN LANJUT

- **DOKUMENTASI-LENGKAP.md** — History semua pekerjaan
- **CHANGELOG-VERSION.md** — Detail perubahan per versi
- **KREDENSIAL-LOGIN.md** — Kredensial & env vars
- **CATATAN-AI.md** — Conventions untuk AI agent
- **AGENTS.md** — InsForge integration notes

### Source Code Reference
- `src/lib/backend-handlers.ts` — Registry semua RPC functions
- `src/lib/session.ts` — Session implementation
- `src/app/api/rpc/route.ts` — RPC dispatcher
- `prisma/schema.prisma` — Database schema
- `public/app.html` — Frontend (7,973 baris)

---

*didiQCsys v9.31 — Arsitektur Aplikasi*
