/**
 * Sube un archivo a R2. Uso en CI (apk-release.yml):
 *   bun run scripts/upload-apk-to-r2.ts --file <path> --key <key> --content-type <mime>
 *
 * Lee credenciales de env (R2_ACCOUNT_ID, R2_ACCESS_KEY_ID,
 * R2_SECRET_ACCESS_KEY, R2_BUCKET). Falla cerrado si falta algo.
 */
import { readFileSync } from "node:fs";

const args = process.argv.slice(2);
function flag(name: string): string {
  const i = args.indexOf(`--${name}`);
  if (i === -1 || !args[i + 1]) {
    console.error(`falta --${name}`);
    process.exit(1);
  }
  return args[i + 1] as string;
}

const file = flag("file");
const key = flag("key");
const contentType = flag("content-type");

const accountId = process.env.R2_ACCOUNT_ID;
const accessKeyId = process.env.R2_ACCESS_KEY_ID;
const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY;
const bucket = process.env.R2_BUCKET;
if (!accountId || !accessKeyId || !secretAccessKey || !bucket) {
  console.error("faltan R2_ACCOUNT_ID / R2_ACCESS_KEY_ID / R2_SECRET_ACCESS_KEY / R2_BUCKET");
  process.exit(1);
}

const { S3Client, PutObjectCommand } = await import("@aws-sdk/client-s3");
const client = new S3Client({
  region: "auto",
  endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
  credentials: { accessKeyId, secretAccessKey },
});

const body = readFileSync(file);
await client.send(
  new PutObjectCommand({ Bucket: bucket, Key: key, Body: body, ContentType: contentType })
);
console.log(`subido: ${key} (${body.length} bytes)`);
