-- ============================================================
-- 0004_multi_account.sql
-- マルチアカウント対応マイグレーション
-- 複数の管理者アカウント（鑑定士）とスーパー管理者を管理する
-- ============================================================

-- ── 1. admin_accounts テーブル新設 ────────────────────────────
-- 各鑑定士アカウントを管理するテーブル。
-- slug は URL スラグ（例: "noa" → /admin/noa でアクセス）。
-- role: 'super_admin' = 全体管理者, 'admin' = 一般鑑定士
CREATE TABLE `admin_accounts` (
	`id` int AUTO_INCREMENT NOT NULL,
	`slug` varchar(64) NOT NULL,
	`displayName` varchar(100) NOT NULL,
	`passwordHash` varchar(255) NOT NULL,
	`role` enum('super_admin','admin') NOT NULL DEFAULT 'admin',
	`isActive` tinyint(1) NOT NULL DEFAULT 1,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `admin_accounts_id` PRIMARY KEY(`id`),
	CONSTRAINT `admin_accounts_slug_unique` UNIQUE(`slug`)
);
--> statement-breakpoint

-- ── 2. clients テーブルに adminAccountId カラムを追加 ─────────
-- 各お客様がどの鑑定士アカウントに紐づくかを管理する。
-- NULL の場合は既存データ（移行前）を示す。
ALTER TABLE `clients` ADD `adminAccountId` int;
--> statement-breakpoint

-- ── 3. sessions テーブルに adminAccountId カラムを追加 ────────
-- 各セッションがどの鑑定士アカウントで行われたかを記録する。
ALTER TABLE `sessions` ADD `adminAccountId` int;
--> statement-breakpoint

-- ── 4. 既存の admin_auth データを admin_accounts へ移行 ───────
-- admin_auth テーブルに既存パスワードハッシュがある場合、
-- slug='noa', displayName='のあ', role='admin' として移行する。
INSERT INTO `admin_accounts` (`slug`, `displayName`, `passwordHash`, `role`, `isActive`)
SELECT
  'noa'          AS `slug`,
  'のあ'          AS `displayName`,
  `passwordHash` AS `passwordHash`,
  'admin'        AS `role`,
  1              AS `isActive`
FROM `admin_auth`
LIMIT 1;
--> statement-breakpoint

-- ── 5. スーパー管理者アカウントを追加 ────────────────────────
-- 初期パスワード: angelique2024
-- bcrypt(cost=12): $2b$12$fRDvq3AIdsa8QxFXRHPYNuLZeiPmYQnRAXuXB27jm57Gh1sFE.ldi
-- ※ 本番運用前に必ずパスワードを変更してください。
INSERT INTO `admin_accounts` (`slug`, `displayName`, `passwordHash`, `role`, `isActive`)
VALUES (
  'super',
  'スーパー管理者',
  '$2b$12$fRDvq3AIdsa8QxFXRHPYNuLZeiPmYQnRAXuXB27jm57Gh1sFE.ldi',
  'super_admin',
  1
);
--> statement-breakpoint

-- ── 6. admin_account_sessions テーブル新設 ────────────────────
-- 各管理者アカウントのセッショントークンを個別管理する。
-- （従来の app_settings.admin_session_token をアカウント別に分離）
CREATE TABLE `admin_account_sessions` (
	`id` int AUTO_INCREMENT NOT NULL,
	`adminAccountId` int NOT NULL,
	`sessionToken` varchar(64) NOT NULL,
	`expiresAt` timestamp NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `admin_account_sessions_id` PRIMARY KEY(`id`),
	CONSTRAINT `admin_account_sessions_token_unique` UNIQUE(`sessionToken`)
);
