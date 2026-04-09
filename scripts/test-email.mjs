// テストメール送信スクリプト
// 使用方法: node scripts/test-email.mjs <送信先メールアドレス>
import sgMail from "@sendgrid/mail";
import * as dotenv from "dotenv";
import { readFileSync } from "fs";
import { resolve } from "path";

// .env ファイルを読み込む
try {
  const envPath = resolve(process.cwd(), ".env");
  const envContent = readFileSync(envPath, "utf-8");
  dotenv.config({ path: envPath });
  console.log("[Test] .env loaded");
} catch {
  console.log("[Test] No .env file found, using process.env");
}

const apiKey = process.env.SENDGRID_API_KEY;
const fromEmail = process.env.SENDGRID_FROM_EMAIL || "noreply@noakayou.com";
const toEmail = process.argv[2] || fromEmail;

if (!apiKey) {
  console.error("[Test] ERROR: SENDGRID_API_KEY is not set");
  process.exit(1);
}

console.log(`[Test] Sending test email to: ${toEmail}`);
console.log(`[Test] From: ${fromEmail}`);
console.log(`[Test] API key prefix: ${apiKey.substring(0, 8)}...`);

sgMail.setApiKey(apiKey);

try {
  const [response] = await sgMail.send({
    to: { email: toEmail, name: "テスト受信者" },
    from: { email: fromEmail, name: "angelique テスト" },
    subject: "【angelique】テストメール送信確認",
    html: `
      <div style="font-family:sans-serif;max-width:500px;margin:40px auto;padding:32px;background:#fff;border-radius:16px;border:1px solid #d4bfbb;">
        <div style="font-size:24px;color:#c9a8a3;text-align:center;margin-bottom:16px;">✦ angelique ✦</div>
        <h2 style="color:#6b5b58;">テストメール送信確認</h2>
        <p style="color:#9e8480;">このメールはシステムのメール送信機能テストのために送信されました。</p>
        <p style="color:#9e8480;">送信日時: ${new Date().toLocaleString("ja-JP", { timeZone: "Asia/Tokyo" })}</p>
        <p style="color:#9e8480;font-size:12px;">このメールは自動送信です。返信は不要です。</p>
      </div>
    `,
    text: `angelique テストメール\n\n送信日時: ${new Date().toLocaleString("ja-JP", { timeZone: "Asia/Tokyo" })}\n\nこのメールはシステムのメール送信機能テストのために送信されました。`,
  });

  console.log(`[Test] SUCCESS! Status code: ${response.statusCode}`);
  console.log(`[Test] Headers:`, JSON.stringify(response.headers, null, 2));
} catch (err) {
  const sgErr = err;
  const statusCode = sgErr.response?.statusCode ?? sgErr.code;
  const bodyErrors = sgErr.response?.body?.errors;

  console.error(`[Test] FAILED! HTTP ${statusCode ?? "?"}: ${sgErr.message}`);
  if (bodyErrors) {
    console.error("[Test] Error details:", JSON.stringify(bodyErrors, null, 2));
  }
  if (sgErr.response?.body) {
    console.error("[Test] Full response body:", JSON.stringify(sgErr.response.body, null, 2));
  }
  process.exit(1);
}
