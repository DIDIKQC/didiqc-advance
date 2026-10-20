import { db } from "../src/lib/db";

async function main() {
  const count = await db.users.count();
  console.log(`Existing users: ${count}`);
  if (count > 0) {
    console.log("DB sudah ada user. Skip seeding.");
    return;
  }

  const admin = await db.users.create({
    data: {
      username: "admin",
      password: "didigqc123",
      fullName: "Administrator",
      email: "admin@didiqc.local",
      role: "superadmin",
      status: "active",
      approvedBy: "system",
      approvedDate: new Date(),
      expiryDate: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000),
      imgAnalAccess: true,
    },
  });
  console.log("✓ Created superadmin:", admin.username);

  // Settings (key-value)
  const settings: [string, string][] = [
    ["appName", "didiQCsys"],
    ["appVersion", "v9"],
    ["labName", "Laboratorium QC"],
    ["defaultSD", "2"],
    ["defaultCV", "5"],
  ];
  for (const [key, value] of settings) {
    await db.settings.create({ data: { key, value } });
  }
  console.log(`✓ Created ${settings.length} default settings`);

  // KopSurat (key-value, per owner)
  const kop: [string, string][] = [
    ["namaLab", "Laboratorium QC"],
    ["alamatLab", "Jl. Contoh No. 1"],
    ["kotaLab", "Jakarta"],
    ["telpLab", "021-1234567"],
    ["emailLab", "lab@didiqc.local"],
    ["websiteLab", "https://didiqc-advance.vercel.app"],
    ["logoUrl", ""],
    ["footerNote", "Hasil QC otomatis - didiQCsys v9"],
  ];
  for (const [key, value] of kop) {
    await db.kopSurat.create({ data: { key, value, ownerUsername: "admin" } });
  }
  console.log(`✓ Created ${kop.length} default kop surat entries`);

  console.log("\n=== SEED DONE ===");
  console.log("Login: admin / didigqc123");
}

main()
  .catch((e) => { console.error("SEED ERROR:", e); process.exit(1); })
  .finally(async () => { await db.$disconnect(); });
