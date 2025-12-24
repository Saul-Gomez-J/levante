-- Migration 0005: Add reasoning support to messages
--
-- This migration adds support for reasoning content from AI models that expose
-- their thought process (GPT-5, Gemini 2.0 Flash, DeepSeek R1, etc.).
-- Reasoning is stored as a JSON object containing the reasoning text and metadata.

PRAGMA foreign_keys = OFF;
BEGIN TRANSACTION;

-- Add reasoning column to messages table
-- Stores JSON object with reasoning content: { text: string, duration?: number }
ALTER TABLE messages ADD COLUMN reasoning TEXT DEFAULT NULL;

-- Add index for messages with reasoning (for faster queries)
CREATE INDEX IF NOT EXISTS idx_messages_reasoning ON messages(session_id, reasoning)
WHERE reasoning IS NOT NULL;

-- Update schema version
UPDATE schema_version SET version = 5 WHERE id = 1;
INSERT OR IGNORE INTO schema_version (version) VALUES (5);

PRAGMA foreign_keys = ON;
COMMIT;

-- Reasoning JSON structure example:
-- {
--   "text": "Let me think about this step by step...",
--   "duration": 2
-- }
