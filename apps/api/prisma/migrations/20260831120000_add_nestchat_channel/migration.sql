-- NestChat: our own live-chat channel, alongside WhatsApp and email.
--
-- Postgres cannot add an enum value inside a transaction that later uses it,
-- and Prisma wraps a migration in one — but ALTER TYPE ... ADD VALUE alone is
-- fine, and nothing here reads the new value, so this applies cleanly.
ALTER TYPE "ChannelType" ADD VALUE IF NOT EXISTS 'nestchat';
