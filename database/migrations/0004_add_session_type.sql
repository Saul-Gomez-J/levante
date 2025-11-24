-- Migration 0004: Add session_type to chat_sessions
-- This migration adds a session_type field to distinguish between different types of chats:
-- - 'chat': Normal conversational chat with LLMs
-- - 'inference': Hugging Face inference tasks (text-to-image, image-to-image, etc.)

PRAGMA foreign_keys = OFF;
BEGIN TRANSACTION;

-- Add session_type column with default 'chat'
ALTER TABLE chat_sessions ADD COLUMN session_type TEXT DEFAULT 'chat' NOT NULL;

-- Create index for faster filtering by session type
CREATE INDEX IF NOT EXISTS idx_chat_sessions_type ON chat_sessions(session_type);

-- Update schema version
UPDATE schema_version SET version = 4 WHERE id = 1;
INSERT OR IGNORE INTO schema_version (id, version) VALUES (1, 4);

COMMIT;
PRAGMA foreign_keys = ON;
