// Temp verification script: list + head + delete the production round-trip test file
const { S3Client, GetObjectCommand, DeleteObjectCommand } = require("@aws-sdk/client-s3");
const fs = require("fs");

// Load .env manually
const env = {};
for (const line of fs.readFileSync(".env", "utf8").split("\n")) {
  const m = line.match(/^([A-Z_]+)=(.*)$/);
  if (m) env[m[1]] = m[2].trim();
}

const s3 = new S3Client({
  region: "auto",
  endpoint: env.R2_ENDPOINT,
  credentials: {
    accessKeyId: env.R2_ACCESS_KEY_ID,
    secretAccessKey: env.R2_SECRET_ACCESS_KEY,
  },
});

const KEY = process.argv[2];

(async () => {
  try {
    const res = await s3.send(new GetObjectCommand({ Bucket: env.R2_BUCKET, Key: KEY }));
    const bytes = await res.Body.transformToByteArray();
    console.log("R2 GET OK:", KEY);
    console.log("  contentType:", res.ContentType);
    console.log("  size:", bytes.length, "bytes");
    console.log("  content:", Buffer.from(bytes).toString("utf8"));
    await s3.send(new DeleteObjectCommand({ Bucket: env.R2_BUCKET, Key: KEY }));
    console.log("R2 DELETE OK (test file removed, bucket clean)");
  } catch (e) {
    console.error("FAILED:", e.name, e.message);
    process.exit(1);
  }
})();
