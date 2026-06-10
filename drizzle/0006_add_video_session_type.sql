-- Migration: Add "video" to sessionType enum
-- Run manually on Railway MySQL before deploying

ALTER TABLE `sessions`
  MODIFY COLUMN `sessionType`
    ENUM('chat', 'voice', 'video') NOT NULL DEFAULT 'chat';
