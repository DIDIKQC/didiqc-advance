# 🤖 CATATAN KHUSUS UNTUK AI AGENT
# didiQCsys v9.31

> **BACA FILE INI SEBELUM MELAKUKAN PERUBAHAN APAPUN!**
> 
> File ini berisi aturan main, conventions, dan pitfall yang HARUS diketahui
> oleh AI agent (Claude, GPT, Cursor, Copilot, dll) sebelum memodifikasi
> kode didiQCsys. Membaca file ini akan mencegah bug & error yang bisa
> merusak aplikasi yang sudah berjalan stabil.

---

## ⚠️ ATURAN MAIN DARI USER (WAJIB DIPATUHI)

### Filosofi Utama
> *"Hanya ini perbaikan dan tambahan yang saya minta jangan ada perubahan bagian lain… jangan ada error karena kami adalah programer yang handal"*

### Aturan Emas
1. **JANGAN UBAH BAGIAN LAIN YANG SUDAH BERFUNGSI** — kecuali user eksplisit minta
2. **JANGAN ADA ERROR** — setelah perubahan, app HARUS tetap jalan
3. **HANYA LAKUKAN yang diminta** — jangan over-engineering atau refactoring
4. **PERTAHANKAN POLA YANG SUDAH ADA** — jangan reinvent, ikuti conventions
5. **SETIAP PERUBAHAN → commit + push** — Vercel auto-deploy aktif

### Konsekuensi
- Setiap perubahan yang tidak diminta = potensi bug
- Setiap error di production = user report langsung
- Vercel auto-deploy → setiap commit langsung live di production
- Tidak ada staging environment — semua commit ke main = production

---

## 📂 STRUKTUR FILE YANG SENSITIF

### `public/app.html` (784KB, 7,973 baris) — SANGAT SENSITIF
- File frontend terbesar dan terpenting
- Berisi HTML + CSS + JS asli dari Google Apps Script
- **JANGAN modify sembarangan** — 1 karakter salah bisa break seluruh app
- 4 script blocks inline — pastikan `node --check` setiap block setelah edit
- Setiap perubahan: jalankan `node --check` dulu sebelum commit

### `src/lib/backend/master-data.ts` (28KB) — SENSITIF
- `getParameters` filter by `ownerUsername` (tenant isolation)
- **Bug terkenal**: TRIGLISERID hilang dari superadmin `didik` karena parameter row punya `ownerUsername: admin` (dibuat sebelum tenant isolation)
- **Fix yang direncanakan**: union query — parameter milik sendiri ∪ parameter yang ada data QC di tabel lain (data-driven self-healing)

### `src/lib/backend-handlers.ts` (312 baris) — SENSITIF
- Registry semua RPC functions
- Setiap fungsi backend HARUS didaftarkan di sini
- Format: `'functionName': module.functionName`

### `prisma/schema.prisma` (907 baris) — SENSITIF
- 23 model PostgreSQL
- Jangan tambah field tanpa `bunx prisma db push` setelahnya
- Production schema = PostgreSQL (bukan SQLite!)

---

## 🛠️ WORKFLOW PERUBAHAN (STRICT)

### Step 1: Backup Schema
```bash
# Sebelum ubah prisma/schema.prisma
cp prisma/schema.prisma prisma/schema.prisma.bak
```

### Step 2: Untuk Verifikasi Lokal, SWAP ke SQLite
```bash
# Backup schema PostgreSQL
cp prisma/schema.prisma prisma/schema.prisma.pg.bak

# Ganti provider ke sqlite untuk lokal test
# Edit prisma/schema.prisma line 22: provider = "sqlite"
# Edit line 23: url = "file:./dev.db"

# Push schema ke SQLite lokal
bunx prisma db push

# Seed admin untuk test
bun run scripts/seed-admin.ts
```

### Step 3: Setelah Verifikasi OK, RESTORE Schema PostgreSQL
```bash
# Kembalikan schema PostgreSQL
cp prisma/schema.prisma.pg.bak prisma/schema.prisma

# Hapus backup
rm prisma/schema.prisma.pg.bak

# Generate client
bunx prisma generate
```

### Step 4: Lint & Syntax Check
```bash
# Lint
bun run lint

# Untuk app.html, check tiap script block
# Extract script blocks, jalankan node --check
# (atau gunakan tooling yang sudah ada)
```

### Step 5: Verifikasi Browser
```bash
# Pastikan dev server jalan
bun run dev &

# Buka http://localhost:3000
# Test alur yang diubah
# Pastikan tidak ada console error
```

### Step 6: Commit & Push
```bash
git add <files yang diubah>
git commit -m "feat: deskripsi singkat dalam Bahasa Indonesia"
git push origin main
# Vercel akan auto-deploy
```

### Step 7: Verifikasi Production
- Buka https://didiqc-advance.vercel.app
- Test perubahan
- Cek Vercel deployment logs jika ada error

### Step 8: Update Worklog
- Append ke `/home/z/my-project/worklog.md` (di sandbox) dengan format:
```markdown
---
Task ID: <task-id>
Agent: <agent name>
Task: <the task you were asked to do>

Work Log:
- <step 1>
- <step 2>
- ...

Stage Summary:
- <hasil>
- <files changed>
```

---

## 🎨 CONVENTIONS PENAMAAN

### File Names
- Backend: `kebab-case.ts` (misal: `master-data.ts`)
- Components: `PascalCase.tsx` (misal: `AlertDialog.tsx`)
- Pages: `page.tsx` (Next.js App Router convention)
- API routes: `route.ts`

### Function Names
- Backend exports: `camelCase` (misal: `getParameters`, `saveParameter`)
- RPC function names (di handlers): `camelCase` (misal: `getParameters`, `saveUser`)
- Frontend functions: `camelCase` (misal: `goPage`, `loadDashboard`, `populateFilters`)

### Variable Names
- Global state frontend: `CU` (Current User), `CD` (Cached Data)
- DOM elements: `camelCase` dengan prefix sesuai jenis:
  - `m` untuk modal: `mLotParam`, `mLotAlat`
  - `graf` untuk grafik: `grafBidang`, `grafParam`
  - `lap` untuk laporan: `lapBidang`, `lapParam`
  - `trend` untuk trend: `trendBidang`, `trendParam`
  - `val` untuk validasi: `valBidang`, `valParam`
  - `hist` untuk histori: `histBidang`, `histParam`

### Database Field Names
- Prisma auto-converts `camelCase` → `snake_case` di PostgreSQL
- `ownerUsername` → `owner_username`
- `createdDate` → `created_date`

### Comments
- Bahasa Indonesia untuk comment aplikasi
- Bahasa Inggris untuk comment teknis (Prisma, Next.js)
- Setiap file backend mulai dengan header comment:
```typescript
// ============================================================
// Module Name — Brief description
// ============================================================
```

---

## 🔄 BACKEND FUNCTION PATTERN (WAJIB IKUTI)

### Standard Signature
```typescript
// SETIAP fungsi backend HARUS pakai signature ini:
export async function functionName(
  args: any[],                    // argumen dari frontend
  session: SessionData | null     // session user (null jika belum login)
): Promise<any> {
  // 1. Validate session (kecuali loginUser)
  if (!session) {
    throw new Error('Not authenticated');
  }
  
  // 2. Validate args
  if (!Array.isArray(args)) {
    throw new Error('Invalid arguments: expected array');
  }
  
  // 3. Extract args (destructuring opsional)
  const [param1, param2] = args;
  
  // 4. Business logic — selalu filter by ownerUsername!
  const result = await db.someTable.findMany({
    where: {
      ownerUsername: session.username,  // tenant isolation!
      // ... other filters
    },
    orderBy: { createdDate: 'desc' },
  });
  
  // 5. Return result
  return result;
}
```

### Tenant Isolation WAJIB
- Setiap query ke tabel multi-tenant HARUS filter by `ownerUsername`
- **NEVER** return data tanpa filter `ownerUsername`
- Defense-in-depth: backend + frontend gating

### Error Handling
```typescript
// Throw Error untuk error:
throw new Error('Parameter tidak ditemukan');

// Return object {ok, error} untuk error user-facing:
return { ok: false, error: 'Password lama salah' };

// Return data untuk success:
return { ok: true, data: result };
// Atau langsung return data:
return result;
```

---

## 🎨 FRONTEND PATTERN (public/app.html)

### Global State
```javascript
// CU = Current User (session info)
let CU = {
  username: '',
  role: '',
  isSecondary: false,
  accessMenu: '',  // "", "grpEquipment", "grpImageAnalysis"
  imgAnalAccess: false,
};

// CD = Cached Data (fetched dari backend)
let CD = {
  params: [],
  lots: [],
  teaList: [],
  settings: {},
  allUsers: [],
  equipment: [],
  // ...
};
```

### RPC Call Pattern (Frontend)
```javascript
// Standard pattern:
google.script.run
  .withSuccessHandler(function(result) {
    // handle success
    showToast('Tersimpan', 'success');
    // update local state
    CD.params.push(result);
    // re-render
    populateFilters();
    loadCurrentPage();
  })
  .withFailureHandler(function(error) {
    // handle error
    showToast('Gagal: ' + error.message, 'error');
  })
  .functionName(arg1, arg2);
```

### DOM Helper Pattern
```javascript
// G(id) = document.getElementById(id)
function G(id) { return document.getElementById(id); }

// Penggunaan:
G('grafParam').value = 'GLUKOSA';
G('modalLot').style.display = 'block';
```

### Page Navigation
```javascript
// goPage(pageId) untuk pindah halaman
function goPage(pageId) {
  // Hide semua page
  document.querySelectorAll('[id^="page"]').forEach(p => p.style.display = 'none');
  // Show page target
  G('page' + capitalize(pageId)).style.display = 'block';
  // Update topbar title
  G('topbarTitle').textContent = SUBMENU_MAP[pageId].title;
  // Trigger load function
  if (typeof window['load' + capitalize(pageId)] === 'function') {
    window['load' + capitalize(pageId)]();
  }
}
```

### Modal Pattern
```javascript
// Buka modal
function openXModal(id) {
  G('modalX').style.display = 'block';
  // populate form
  if (id) {
    // edit mode
    const item = CD.x.find(i => i.id === id);
    G('mXId').value = item.id;
    G('mXName').value = item.name;
    // ...
  } else {
    // add mode
    G('mXForm').reset();
  }
}

// Simpan
function saveXAction() {
  const data = {
    id: G('mXId').value || 'X_' + Date.now() + '_' + Math.floor(Math.random()*9999),
    name: G('mXName').value,
    ownerUsername: CU.username,  // tenant!
    // ...
  };
  
  google.script.run
    .withSuccessHandler(function(result) {
      G('modalX').style.display = 'none';
      showToast('Tersimpan', 'success');
      // refresh data
      refreshX();
    })
    .saveX(data);
}
```

---

## 🛡️ TENANT ISOLATION CHECKLIST

Sebelum commit perubahan backend, pastikan:

- [ ] Setiap query filter by `ownerUsername: session.username`
- [ ] Tidak ada query `findMany` tanpa filter `ownerUsername`
- [ ] Function yang seharusnya superadmin-only cek `session.role === 'superadmin'`
- [ ] Function yang seharusnya blokir secondary cek `session.isSecondary`
- [ ] View-As mengganti `session.username` ke target user, bukan ke superadmin asli
- [ ] Tidak ada leak data antar akun

### Contoh Tenant Guard
```typescript
// Function yang HANYA boleh superadmin langsung (bukan secondary):
export async function getUsers(args: any[], session: SessionData | null) {
  if (!session || session.role !== 'superadmin') {
    throw new Error('Akses ditolak: hanya superadmin');
  }
  if (session.isSecondary) {
    throw new Error('Akses ditolak: password tambahan tidak boleh akses Users');
  }
  // ...
}
```

---

## ⚠️ PITFALL YANG PERNAH TERJADI

### 1. TRIGLISERID Hilang dari Superadmin
**Penyebab**: `getParameters` filter by `ownerUsername: didik` saja. TRIGLISERID row punya `ownerUsername: admin` (dibuat sebelum tenant isolation). Setelah Task 34 mengaktifkan filter, parameter `admin` tidak muncul di akun `didik` walau ada 584 inputQC data yang referensi paramID tersebut.

**Fix yang direncanakan**: Union query — parameter milik sendiri ∪ parameter yang ada data QC di tabel lain (data-driven self-healing).

**Pelajaran**: Setiap perubahan tenant isolation HARUS backward-compatible dengan data lama.

### 2. Login Icon Eye di Kiri (v9.31)
**Penyebab**: Commit v9.31 tambah scoped CSS `#loginForm .input-icon i.fa-user { left: auto; right: 14px; }` untuk pindahkan ikon username ke kanan, TETAPI lupa tambah `left: auto` untuk `.toggle-pwd`. Generic rule `.form-group .input-icon i { left: 14px }` masih berlaku → ikon eye tetap di kiri.

**Fix**: Tambah 1 baris CSS `#loginForm .input-icon .toggle-pwd { left: auto; right: 14px; }`

**Pelajaran**: Setiap override CSS scoped HARUS cek semua elemen yang relevant, tidak hanya yang diminta.

### 3. Grafik LJ Terpotong (v9.26)
**Penyebab**: Tambah tabel "Penjelasan & Interpretasi Detail" dengan td berisi teks paragraf panjang. Global rule `.table-wrap td { white-space: nowrap }` membuat td menjadi 1 baris tak bisa patah → tabel meluas sampai 5596px → Chart.js ResizeObserver ikut resize canvas LJ jadi 5211px.

**Fix**: Hapus kolom "Penjelasan & Rumus" + tambah `white-space: normal` pada td interpretasi.

**Pelajaran**: Setiap tambahan tabel baru dengan teks panjang HARUS cek `white-space` rule global.

### 4. View As Dashboard Bug (v9.17)
**Penyebab**: Saat superadmin View As ke user lain lalu kembali ke akun sendiri, Sigma/CV-Bias/Trend Detail sections tidak render. Kondisi render berbasis `CU.username` yang tidak ter-reset saat kembali.

**Fix**: Reset state saat View As di-clear.

**Pelajaran**: Setiap state yang depend pada `CU.username` HARUS di-reset saat View As berubah.

### 5. Lot QC Overwrite (v9.17)
**Penyebab**: ID generation untuk lot QC tidak unique → ID baru sama dengan ID existing → Prisma `create` sebenarnya jadi `upsert` yang overwrite.

**Fix**: Generate ID dengan format `LOT_<timestamp>_<random_4_digit>`.

**Pelajaran**: ID generation HARUS benar-benar unique. Pakai timestamp + random + sequence number.

---

## 🧪 TESTING CHECKLIST

Sebelum commit, test minimal:

### Smoke Test
- [ ] `bun run dev` jalan tanpa error
- [ ] Halaman login muncul di `http://localhost:3000`
- [ ] Login `admin` / `didikqc123` sukses
- [ ] Dashboard menampilkan data atau empty state (bukan error)
- [ ] Sidebar menampilkan 47 menu (untuk superadmin)

### Fitur yang Diubah
- [ ] Test fitur baru yang ditambahkan
- [ ] Test fitur lama yang SEDANG DIUBAH — pastikan tidak break
- [ ] Test fitur lama yang TIDAK DIUBAH — pastikan tidak regress

### Mobile Responsive
- [ ] Resize ke 375px → layout adaptif
- [ ] Sidebar collapsible di mobile
- [ ] Tabel horizontal scroll jika perlu

### Cross-Browser
- [ ] Chrome (utama)
- [ ] Firefox (opsional)
- [ ] Safari (opsional)

### Dark Mode & i18n
- [ ] Toggle dark mode → semua komponen berubah
- [ ] Toggle ID → EN → semua teks berubah
- [ ] Toggle EN → ID → semua teks kembali

---

## 📋 COMMON ISSUES & SOLUTIONS

### Issue: "Server has closed the connection" di Vercel
**Solusi**: Tambah `&pgbouncer=true&connect_timeout=15` di DATABASE_URL

### Issue: "Cannot find module @prisma/client"
**Solusi**: Jalankan `bunx prisma generate`

### Issue: "Port 3000 already in use"
**Solusi**: `lsof -i :3000` lalu `kill -9 <PID>`

### Issue: Prisma error "URL must start with protocol file:"
**Solusi**: Cek `prisma/schema.prisma` line 22 — pastikan `provider = "postgresql"` bukan `sqlite`

### Issue: Login gagal tapi tidak ada error message
**Solusi**: 
- Cek `dev.log` untuk error backend
- Cek apakah user ada di DB (`bunx prisma studio`)
- Cek apakah password match (hash bcrypt)

### Issue: Data tidak tampil walau di DB
**Solusi**:
- Cek apakah `ownerUsername` di row cocok dengan `session.username`
- Cek apakah ada filter lain (date range, bidang, dll) yang filter out data
- Cek apakah frontend re-render setelah data fetched

---

## 🚀 PRODUCTION DEPLOYMENT FLOW

```
Local Dev → git commit → git push origin main
                           ↓
                    GitHub webhook
                           ↓
                    Vercel auto-build
                           ↓
                    Vercel auto-deploy ke production
                           ↓
                    https://didiqc-advance.vercel.app (LIVE)
```

### Build Command Vercel (sudah di vercel.json)
```bash
bunx prisma generate && (bunx prisma db push --skip-generate || echo 'WARN') && next build
```

### Jika Build Gagal di Vercel
1. Cek Vercel deployment logs
2. Pastikan `DATABASE_URL` di Vercel env vars valid
3. Pastikan schema.prisma `provider = "postgresql"`
4. Pastikan tidak ada import yang missing
5. Test lokal dulu sebelum push

---

## 📞 KONTAK & REFERENSI

### Repository
- **GitHub**: https://github.com/DIDIKQC/didiqc-advance
- **Production**: https://didiqc-advance.vercel.app
- **Branch production**: `main`

### Dokumentasi Internal
- `DOKUMENTASI-LENGKAP.md` — History semua pekerjaan
- `SETUP-INSTALASI.md` — Panduan setup
- `ARSITEKTUR.md` — Penjelasan arsitektur
- `CHANGELOG-VERSION.md` — History versi
- `KREDENSIAL-LOGIN.md` — Kredensial & env vars

### Stack Reference
- **Next.js 16**: https://nextjs.org/docs
- **Prisma 6**: https://www.prisma.io/docs
- **shadcn/ui**: https://ui.shadcn.com
- **InsForge**: https://insforge.dev/docs
- **Tailwind CSS 4**: https://tailwindcss.com

---

## 🎯 FINAL REMINDERS

1. **Baca semua dokumentasi** sebelum mulai mengubah kode
2. **Pertahankan pola yang sudah ada** — jangan reinvent
3. **Test lokal dulu** sebelum commit
4. **Commit + push** setelah verifikasi OK (Vercel auto-deploy)
5. **Update worklog** setelah selesai
6. **Jangan ubah bagian lain** yang tidak diminta user
7. **Jangan ada error** — programmer handal tidak bikin error

> *"Hanya ini perbaikan dan tambahan yang saya minta jangan ada perubahan bagian lain… jangan ada error karena kami adalah programer yang handal"*

---

*didiQCsys v9.31 — Catatan AI Agent*
*Baca ini dulu sebelum mengubah apapun.*
