-- Migration 0003: Add attachments support to messages
--
-- This migration adds support for file attachments (images, audio) to chat messages.
-- Attachments are stored as JSON metadata, with actual files stored in the filesystem.
-- File path structure: ~/levante/attachments/{session_id}/{message_id}/{filename}

PRAGMA foreign_keys = OFF;
BEGIN TRANSACTION;

-- Add attachments column to messages table
-- Stores JSON array of MessageAttachment objects
ALTER TABLE messages ADD COLUMN attachments TEXT DEFAULT NULL;

-- Add index for messages with attachments (for faster queries)
CREATE INDEX IF NOT EXISTS idx_messages_attachments ON messages(session_id, attachments)
WHERE attachments IS NOT NULL;

-- Update schema version
UPDATE schema_version SET version = 3 WHERE id = 1;
INSERT OR IGNORE INTO schema_version (version) VALUES (3);

PRAGMA foreign_keys = ON;
COMMIT;

-- Attachment JSON structure example:
-- [
--   {
--     "id": "att_xyz123",
--     "type": "image",
--     "filename": "screenshot.png",
--     "mimeType": "image/png",
--     "size": 245678,
--     "path": "session_abc/message_123/screenshot.png"
--   }
-- ]
