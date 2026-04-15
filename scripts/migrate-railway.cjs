/**
 * Railway MySQL マイグレーション実行スクリプト（CJS版）
 * 使い方: node scripts/migrate-railway.cjs
 */

// グローバルインストールの mysql2 を使用
const mysql = require("C:/Users/cooll/AppData/Roaming/npm/node_modules/mysql2/promise");
const fs = require("fs");
const path = require("path");

const DRIZZLE_DIR = path.resolve(__dirname, "../drizzle");

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error("❌ DATABASE_URL が設定されていません");
  process.exit(1);
}

function parseUrl(url) {
  const u = new URL(url);
  return {
    host: u.hostname,
    port: parseInt(u.port || "3306"),
    user: u.username,
    password: decodeURIComponent(u.password),
    database: u.pathname.replace(/^\//, ""),
    ssl: { rejectUnauthorized: false },
    multipleStatements: false,
  };
}

function splitStatements(sql) {
  // まず --> statement-breakpoint で分割を試みる
  if (sql.includes("--> statement-breakpoint")) {
    return sql
      .split("--> statement-breakpoint")
      .map((s) => s.trim())
      .filter((s) => s.replace(/--[^\n]*/g, "").trim().length > 0);
  }

  // statement-breakpoint がない場合はセミコロンで分割
  // ただし文字列内のセミコロンは無視（簡易パース）
  const statements = [];
  let current = "";
  let inString = false;
  let stringChar = "";

  for (let i = 0; i < sql.length; i++) {
    const ch = sql[i];
    if (!inString && (ch === "'" || ch === '"' || ch === "`")) {
      inString = true;
      stringChar = ch;
      current += ch;
    } else if (inString && ch === stringChar && sql[i - 1] !== "\\") {
      inString = false;
      current += ch;
    } else if (!inString && ch === ";") {
      const stmt = current.trim();
      if (stmt.replace(/--[^\n]*/g, "").trim().length > 0) {
        statements.push(stmt);
      }
      current = "";
    } else {
      current += ch;
    }
  }
  const last = current.trim();
  if (last.replace(/--[^\n]*/g, "").trim().length > 0) {
    statements.push(last);
  }
  return statements;
}

const MIGRATION_FILES = [
  "0000_quiet_wind_dancer.sql",
  "0001_loving_vanisher.sql",
  "0002_quick_reaper.sql",
  "0003_parallel_supreme_intelligence.sql",
  "0004_multi_account.sql",
];

const NOA_FALLBACK_HASH =
  "$2b$12$YJ7yHFrSsM9Y5YBGKx1P7OoVWgGHsOPbZxFGmGQzH/X0nXDFNyRBK";

async function main() {
  const config = parseUrl(DATABASE_URL);
  console.log(`\n🔌 接続先: ${config.host}:${config.port}/${config.database}`);

  const conn = await mysql.createConnection(config);
  console.log("✅ 接続成功\n");

  try {
    for (const file of MIGRATION_FILES) {
      const filePath = path.join(DRIZZLE_DIR, file);
      if (!fs.existsSync(filePath)) {
        console.warn(`⚠️  スキップ（ファイル不在）: ${file}`);
        continue;
      }

      console.log(`▶ 実行中: ${file}`);
      const sql = fs.readFileSync(filePath, "utf-8");
      const statements = splitStatements(sql);

      for (const rawStmt of statements) {
        const cleaned = rawStmt.replace(/--[^\n]*/g, "").trim();
        if (!cleaned) continue;

        // MySQL は ALTER TABLE ADD COLUMN IF NOT EXISTS を未サポートのため除去
        const stmt = rawStmt.replace(/ADD COLUMN IF NOT EXISTS/gi, "ADD COLUMN");

        try {
          await conn.query(stmt);
          console.log(`   ✓ ${cleaned.slice(0, 70).replace(/\n/g, " ")}`);
        } catch (err) {
          if (
            err.code === "ER_TABLE_EXISTS_ERROR" ||
            err.code === "ER_DUP_FIELDNAME" ||
            err.code === "ER_DUP_ENTRY" ||
            (err.message && err.message.includes("Duplicate column name")) ||
            (err.message && err.message.includes("already exists"))
          ) {
            console.log(`   ⏭ 既存のためスキップ: ${err.message.slice(0, 60)}`);
          } else {
            console.error(`\n❌ エラー（${file}）:`, err.message);
            console.error("   SQL:", cleaned.slice(0, 100));
            throw err;
          }
        }
      }
      console.log(`   ✅ ${file} 完了\n`);
    }

    // のあさんアカウント確認・挿入
    console.log("▶ のあさんアカウント確認...");
    const [rows] = await conn.query(
      "SELECT id FROM fortune_tellers WHERE slug = 'noa' LIMIT 1"
    );
    if (rows.length === 0) {
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

    // 結果確認
    console.log("📋 作成済みテーブル一覧:");
    const [tables] = await conn.query("SHOW TABLES");
    for (const row of tables) {
      console.log(`   - ${Object.values(row)[0]}`);
    }

    console.log("\n🎉 全マイグレーション完了！");
  } finally {
    await conn.end();
  }
}

main().catch((err) => {
  console.error("\n❌ 致命的エラー:", err.message);
  process.exit(1);
});
