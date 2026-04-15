/**
 * Railway MySQL マイグレーション実行スクリプト
 * 使い方: node scripts/migrate-railway.mjs
 */

import mysql from "mysql2/promise";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DRIZZLE_DIR = path.resolve(__dirname, "../drizzle");

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error("❌ DATABASE_URL が設定されていません");
  process.exit(1);
}

// mysql://user:pass@host:port/db を分解
function parseUrl(url) {
  const u = new URL(url);
  return {
    host: u.hostname,
    port: parseInt(u.port || "3306"),
    user: u.username,
    password: decodeURIComponent(u.password),
    database: u.pathname.replace(/^\//, ""),
    ssl: { rejectUnauthorized: false },
  };
}

// SQL を --> statement-breakpoint で分割し、空文を除去
function splitStatements(sql) {
  return sql
    .split("--> statement-breakpoint")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

const MIGRATION_FILES = [
  "0000_quiet_wind_dancer.sql",
  "0001_loving_vanisher.sql",
  "0002_quick_reaper.sql",
  "0003_parallel_supreme_intelligence.sql",
  "0004_multi_account.sql",
];

// のあさん初期パスワードハッシュ（bcrypt, "angelique2024"）
// admin_auth が空の場合のフォールバック用
const NOA_FALLBACK_HASH =
  "$2b$12$YJ7yHFrSsM9Y5YBGKx1P7OoVWgGHsOPbZxFGmGQzH/X0nXDFNyRBK";

async function main() {
  const config = parseUrl(DATABASE_URL);
  console.log(`\n🔌 接続先: ${config.host}:${config.port}/${config.database}`);

  const conn = await mysql.createConnection(config);
  console.log("✅ 接続成功\n");

  try {
    // ── 各マイグレーションファイルを実行 ──────────────────────────
    for (const file of MIGRATION_FILES) {
      const filePath = path.join(DRIZZLE_DIR, file);
      if (!fs.existsSync(filePath)) {
        console.warn(`⚠️  スキップ（ファイル不在）: ${file}`);
        continue;
      }

      console.log(`▶ 実行中: ${file}`);
      const sql = fs.readFileSync(filePath, "utf-8");
      const statements = splitStatements(sql);

      for (const stmt of statements) {
        // コメントのみの行はスキップ
        const cleaned = stmt.replace(/--[^\n]*/g, "").trim();
        if (!cleaned) continue;

        try {
          await conn.query(stmt);
          // ステートメントの先頭20文字をログ表示
          console.log(`   ✓ ${cleaned.slice(0, 60).replace(/\n/g, " ")}...`);
        } catch (err) {
          // 既に存在するテーブル/カラムはスキップ（冪等性）
          if (
            err.code === "ER_TABLE_EXISTS_ERROR" ||
            err.code === "ER_DUP_FIELDNAME" ||
            err.message.includes("Duplicate column name") ||
            err.message.includes("already exists")
          ) {
            console.log(`   ⏭ 既存のため省略: ${err.message.slice(0, 60)}`);
          } else {
            throw err;
          }
        }
      }
      console.log(`   ✅ ${file} 完了\n`);
    }

    // ── のあさんの fortune_teller が未登録なら挿入 ────────────────
    console.log("▶ のあさんアカウント確認...");
    const [rows] = await conn.query(
      "SELECT id FROM fortune_tellers WHERE slug = 'noa' LIMIT 1"
    );
    if (rows.length === 0) {
      // admin_auth からハッシュを取得できるか試みる
      let hash = NOA_FALLBACK_HASH;
      try {
        const [authRows] = await conn.query(
          "SELECT passwordHash FROM admin_auth LIMIT 1"
        );
        if (authRows.length > 0 && authRows[0].passwordHash) {
          hash = authRows[0].passwordHash;
          console.log("   ℹ admin_auth からパスワードハッシュを引き継ぎます");
        }
      } catch (_) {}

      await conn.query(
        `INSERT INTO fortune_tellers (id, slug, brandName, passwordHash, themeColor, isActive)
         VALUES (1, 'noa', '華耀望愛', ?, 'dusty-pink', 1)`,
        [hash]
      );
      console.log("   ✅ のあさんアカウント（slug: noa）を挿入しました\n");
    } else {
      console.log("   ⏭ のあさんアカウントは既に存在します\n");
    }

    // ── 結果確認 ──────────────────────────────────────────────────
    console.log("📋 テーブル一覧:");
    const [tables] = await conn.query("SHOW TABLES");
    for (const row of tables) {
      console.log(`   - ${Object.values(row)[0]}`);
    }

    console.log("\n✅ 全マイグレーション完了！");
  } finally {
    await conn.end();
  }
}

main().catch((err) => {
  console.error("\n❌ エラー:", err.message);
  process.exit(1);
});
