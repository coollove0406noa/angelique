-- マルチアカウント対応マイグレーション
-- 占い師アカウントテーブル、スーパー管理者テーブルを追加
-- clients/sessionsにfortune_teller_idを追加

-- 1. fortune_tellers テーブル作成
CREATE TABLE IF NOT EXISTS `fortune_tellers` (
  `id` INT AUTO_INCREMENT PRIMARY KEY,
  `slug` VARCHAR(50) NOT NULL UNIQUE,
  `brandName` VARCHAR(100) NOT NULL,
  `passwordHash` VARCHAR(255) NOT NULL,
  `sessionToken` VARCHAR(64),
  `themeColor` VARCHAR(50) NOT NULL DEFAULT 'dusty-pink',
  `isActive` TINYINT(1) NOT NULL DEFAULT 1,
  `createdAt` TIMESTAMP NOT NULL DEFAULT NOW(),
  `updatedAt` TIMESTAMP NOT NULL DEFAULT NOW() ON UPDATE NOW()
);

-- 2. super_admin_auth テーブル作成
CREATE TABLE IF NOT EXISTS `super_admin_auth` (
  `id` INT AUTO_INCREMENT PRIMARY KEY,
  `passwordHash` VARCHAR(255) NOT NULL,
  `sessionToken` VARCHAR(64),
  `createdAt` TIMESTAMP NOT NULL DEFAULT NOW(),
  `updatedAt` TIMESTAMP NOT NULL DEFAULT NOW() ON UPDATE NOW()
);

-- 3. clients に fortune_teller_id カラム追加
ALTER TABLE `clients` ADD COLUMN IF NOT EXISTS `fortuneTellerId` INT NOT NULL DEFAULT 1;

-- 4. sessions に fortune_teller_id カラム追加
ALTER TABLE `sessions` ADD COLUMN IF NOT EXISTS `fortuneTellerId` INT NOT NULL DEFAULT 1;

-- 5. sessions に adminNotes カラム追加
ALTER TABLE `sessions` ADD COLUMN IF NOT EXISTS `adminNotes` TEXT;

-- 6. のあさんのアカウントをfortune_tellersに移行
-- admin_authからパスワードハッシュをコピーして最初のfortune_tellerとして登録
INSERT INTO `fortune_tellers` (`id`, `slug`, `brandName`, `passwordHash`, `themeColor`, `isActive`)
SELECT 1, 'noa', '華耀望愛', `passwordHash`, 'dusty-pink', 1
FROM `admin_auth`
LIMIT 1
ON DUPLICATE KEY UPDATE `slug` = `slug`;

-- 7. app_settingsのキーをfortune_teller_idプレフィックス付きに移行
-- "admin_session_token" は fortune_tellers.sessionToken に移行済みのため削除
-- STORES URLはft_1_プレフィックス付きにリネーム
UPDATE `app_settings`
SET `key` = CONCAT('ft_1_', `key`)
WHERE `key` IN (
  'stores_url_chat_10min',
  'stores_url_chat_30min',
  'stores_url_voice_10min',
  'stores_url_voice_30min',
  'stores_url_10min',
  'stores_url_30min'
)
AND `key` NOT LIKE 'ft_%';

-- admin_session_tokenキーを削除（fortune_tellers.sessionTokenに移行）
DELETE FROM `app_settings` WHERE `key` = 'admin_session_token';
