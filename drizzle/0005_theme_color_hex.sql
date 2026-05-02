-- テーマカラーをHEX値に変換・アクセントカラー列を追加

-- 1. accentColor カラムを追加
ALTER TABLE `fortune_tellers`
  ADD COLUMN IF NOT EXISTS `accentColor` VARCHAR(20) NOT NULL DEFAULT '#c9a8a3';

-- 2. 旧テーマキー名を HEX に変換し、accentColor も設定
UPDATE `fortune_tellers` SET `themeColor` = '#f3e7e5', `accentColor` = '#c9a8a3' WHERE `themeColor` = 'dusty-pink';
UPDATE `fortune_tellers` SET `themeColor` = '#ede7f6', `accentColor` = '#9575cd' WHERE `themeColor` = 'lavender';
UPDATE `fortune_tellers` SET `themeColor` = '#e8f5e9', `accentColor` = '#66bb6a' WHERE `themeColor` = 'mint-green';
UPDATE `fortune_tellers` SET `themeColor` = '#e3f2fd', `accentColor` = '#42a5f5' WHERE `themeColor` = 'sky-blue';
UPDATE `fortune_tellers` SET `themeColor` = '#fce4ec', `accentColor` = '#f48fb1' WHERE `themeColor` = 'peach';
UPDATE `fortune_tellers` SET `themeColor` = '#fff8e1', `accentColor` = '#ffc107' WHERE `themeColor` = 'gold';
UPDATE `fortune_tellers` SET `themeColor` = '#f3e5f5', `accentColor` = '#ab47bc' WHERE `themeColor` = 'mauve';
UPDATE `fortune_tellers` SET `themeColor` = '#fafafa', `accentColor` = '#9e9e9e' WHERE `themeColor` = 'off-white';

-- 3. themeColor の DEFAULT を HEX 値に変更
ALTER TABLE `fortune_tellers`
  MODIFY COLUMN `themeColor` VARCHAR(20) NOT NULL DEFAULT '#f3e7e5';
