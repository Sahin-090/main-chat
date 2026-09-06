-- ============================================================
-- Secure Chat Server - Database Schema
-- Compatible with MySQL 5.7+ / MariaDB / phpMyAdmin
-- You can import this file directly via phpMyAdmin, OR
-- simply start the server and it will auto-create everything.
-- ============================================================

CREATE DATABASE IF NOT EXISTS `secure_chat_server`
  CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

USE `secure_chat_server`;

-- ------------------------------------------------------------
-- Users
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `users` (
  `id` VARCHAR(36) NOT NULL PRIMARY KEY,
  `username` VARCHAR(32) NOT NULL UNIQUE,
  `password_hash` VARCHAR(255) NOT NULL,
  `display_name` VARCHAR(64) NOT NULL,
  `avatar_color` VARCHAR(16) DEFAULT '#6366f1',
  `avatar_url` VARCHAR(255) NULL,
  `role` ENUM('user', 'admin') NOT NULL DEFAULT 'user',
  `is_online` TINYINT(1) NOT NULL DEFAULT 0,
  `last_seen` DATETIME NULL,
  `is_banned` TINYINT(1) NOT NULL DEFAULT 0,
  `banned_reason` VARCHAR(255) NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_username (`username`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Migration for existing installs where the table already existed
-- without avatar_url (safe to fail/skip if the column is already there).
ALTER TABLE `users` ADD COLUMN `avatar_url` VARCHAR(255) NULL AFTER `avatar_color`;

-- Notification preferences (safe to fail/skip if columns already exist).
ALTER TABLE `users` ADD COLUMN `notifications_enabled` TINYINT(1) NOT NULL DEFAULT 1 AFTER `is_banned`;
ALTER TABLE `users` ADD COLUMN `notification_preview_enabled` TINYINT(1) NOT NULL DEFAULT 1 AFTER `notifications_enabled`;

-- ------------------------------------------------------------
-- Private conversations (1:1)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `conversations` (
  `id` VARCHAR(36) NOT NULL PRIMARY KEY,
  `user_one_id` VARCHAR(36) NOT NULL,
  `user_two_id` VARCHAR(36) NOT NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uniq_pair (`user_one_id`, `user_two_id`),
  FOREIGN KEY (`user_one_id`) REFERENCES `users`(`id`) ON DELETE CASCADE,
  FOREIGN KEY (`user_two_id`) REFERENCES `users`(`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ------------------------------------------------------------
-- Groups
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `groups_table` (
  `id` VARCHAR(36) NOT NULL PRIMARY KEY,
  `name` VARCHAR(64) NOT NULL,
  `description` VARCHAR(255) NULL,
  `password_hash` VARCHAR(255) NOT NULL,
  `avatar_color` VARCHAR(16) DEFAULT '#8b5cf6',
  `created_by` VARCHAR(36) NOT NULL,
  `is_deleted` TINYINT(1) NOT NULL DEFAULT 0,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ------------------------------------------------------------
-- Group members
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `group_members` (
  `id` VARCHAR(36) NOT NULL PRIMARY KEY,
  `group_id` VARCHAR(36) NOT NULL,
  `user_id` VARCHAR(36) NOT NULL,
  `role` ENUM('member', 'moderator', 'owner') NOT NULL DEFAULT 'member',
  `joined_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uniq_member (`group_id`, `user_id`),
  FOREIGN KEY (`group_id`) REFERENCES `groups_table`(`id`) ON DELETE CASCADE,
  FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ------------------------------------------------------------
-- Messages (works for both private + group via chat_type/chat_id)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `messages` (
  `id` VARCHAR(36) NOT NULL PRIMARY KEY,
  `chat_type` ENUM('private', 'group') NOT NULL,
  `chat_id` VARCHAR(36) NOT NULL,
  `sender_id` VARCHAR(36) NOT NULL,
  `reply_to_id` VARCHAR(36) NULL,
  `content` TEXT NULL,
  `message_type` ENUM('text', 'image', 'video', 'audio', 'pdf', 'zip', 'apk', 'file') NOT NULL DEFAULT 'text',
  `file_url` VARCHAR(512) NULL,
  `file_name` VARCHAR(255) NULL,
  `file_size` INT NULL,
  `is_edited` TINYINT(1) NOT NULL DEFAULT 0,
  `is_deleted` TINYINT(1) NOT NULL DEFAULT 0,
  `deleted_for_everyone` TINYINT(1) NOT NULL DEFAULT 0,
  `deleted_by` VARCHAR(36) NULL,
  `deleted_at` DATETIME NULL,
  `status` ENUM('sent', 'delivered', 'seen') NOT NULL DEFAULT 'sent',
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_chat (`chat_type`, `chat_id`, `created_at`),
  INDEX idx_sender (`sender_id`),
  FULLTEXT INDEX idx_content_search (`content`),
  FOREIGN KEY (`sender_id`) REFERENCES `users`(`id`) ON DELETE CASCADE,
  FOREIGN KEY (`reply_to_id`) REFERENCES `messages`(`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Migration for existing installs (safe to fail/skip if columns already exist)
ALTER TABLE `messages` ADD COLUMN `deleted_by` VARCHAR(36) NULL AFTER `deleted_for_everyone`;
ALTER TABLE `messages` ADD COLUMN `deleted_at` DATETIME NULL AFTER `deleted_by`;

-- Voice message duration in seconds (also usable for video later). NULL for
-- non-audio message types. Safe to fail/skip if the column already exists.
ALTER TABLE `messages` ADD COLUMN `duration` INT NULL AFTER `file_size`;

-- ------------------------------------------------------------
-- Per-user "delete for me" tracking (message stays intact for
-- everyone else; just hidden for the user who deleted it locally)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `message_deletions` (
  `id` VARCHAR(36) NOT NULL PRIMARY KEY,
  `message_id` VARCHAR(36) NOT NULL,
  `user_id` VARCHAR(36) NOT NULL,
  `deleted_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_message_user (`message_id`, `user_id`),
  FOREIGN KEY (`message_id`) REFERENCES `messages`(`id`) ON DELETE CASCADE,
  FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ------------------------------------------------------------
-- Per-user message delivery/seen state (for group seen ticks)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `message_receipts` (
  `id` VARCHAR(36) NOT NULL PRIMARY KEY,
  `message_id` VARCHAR(36) NOT NULL,
  `user_id` VARCHAR(36) NOT NULL,
  `delivered_at` DATETIME NULL,
  `seen_at` DATETIME NULL,
  UNIQUE KEY uniq_receipt (`message_id`, `user_id`),
  FOREIGN KEY (`message_id`) REFERENCES `messages`(`id`) ON DELETE CASCADE,
  FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ------------------------------------------------------------
-- Unread counters (fast lookups)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `unread_counters` (
  `id` VARCHAR(36) NOT NULL PRIMARY KEY,
  `user_id` VARCHAR(36) NOT NULL,
  `chat_type` ENUM('private', 'group') NOT NULL,
  `chat_id` VARCHAR(36) NOT NULL,
  `count` INT NOT NULL DEFAULT 0,
  UNIQUE KEY uniq_counter (`user_id`, `chat_type`, `chat_id`),
  FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ------------------------------------------------------------
-- Activity / admin logs
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `activity_logs` (
  `id` VARCHAR(36) NOT NULL PRIMARY KEY,
  `user_id` VARCHAR(36) NULL,
  `action` VARCHAR(64) NOT NULL,
  `details` TEXT NULL,
  `ip_address` VARCHAR(64) NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_action (`action`),
  INDEX idx_user (`user_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ------------------------------------------------------------
-- Refresh tokens (for JWT rotation / logout-all)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `refresh_tokens` (
  `id` VARCHAR(36) NOT NULL PRIMARY KEY,
  `user_id` VARCHAR(36) NOT NULL,
  `token_hash` VARCHAR(255) NOT NULL,
  `expires_at` DATETIME NOT NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ------------------------------------------------------------
-- Web Push subscriptions (one row per browser/device endpoint).
-- A user can have several (phone + desktop + multiple browsers).
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `push_subscriptions` (
  `id` VARCHAR(36) NOT NULL PRIMARY KEY,
  `user_id` VARCHAR(36) NOT NULL,
  `endpoint` VARCHAR(700) NOT NULL,
  `endpoint_hash` CHAR(64) NOT NULL,
  `p256dh` VARCHAR(255) NOT NULL,
  `auth` VARCHAR(255) NOT NULL,
  `user_agent` VARCHAR(255) NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `last_used_at` DATETIME NULL,
  UNIQUE KEY uniq_endpoint (`endpoint_hash`),
  INDEX idx_user (`user_id`),
  FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ------------------------------------------------------------
-- Per-user conversation mute state (private chats + groups).
-- Presence of a row = muted; no row = notifications on.
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `muted_chats` (
  `id` VARCHAR(36) NOT NULL PRIMARY KEY,
  `user_id` VARCHAR(36) NOT NULL,
  `chat_type` ENUM('private', 'group') NOT NULL,
  `chat_id` VARCHAR(36) NOT NULL,
  `muted_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uniq_mute (`user_id`, `chat_type`, `chat_id`),
  FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
