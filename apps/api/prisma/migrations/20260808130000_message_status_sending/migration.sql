-- Add the in-flight "sending" state to the delivery ladder.
-- Isolated in its own migration: a new enum value must be committed before it
-- can be used, so nothing else in this transaction references it.
ALTER TYPE "MessageStatus" ADD VALUE IF NOT EXISTS 'sending' AFTER 'queued';
