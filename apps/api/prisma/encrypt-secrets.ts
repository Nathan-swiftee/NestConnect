/**
 * One-off (idempotent) migration: encrypt integration secrets already stored in
 * plaintext. Run after setting SECRET_ENCRYPTION_KEY:
 *
 *   pnpm --filter @ding/api db:encrypt-secrets
 *
 * It walks every AppSetting and Inbox.channelConfig, encrypts the secret values
 * that are still plaintext, and leaves already-encrypted values untouched (so
 * re-running is safe and nothing is ever double-encrypted).
 */
import { PrismaClient } from "@prisma/client";
import { SecretEncryptionService } from "../src/crypto/secret-encryption.service";

async function main(): Promise<void> {
  const crypto = new SecretEncryptionService();
  if (!crypto.enabled) {
    console.error(
      "SECRET_ENCRYPTION_KEY is not set — nothing to do. Set a 32-byte key and re-run.",
    );
    process.exit(1);
  }

  const prisma = new PrismaClient();
  let appChanged = 0;
  let inboxChanged = 0;
  try {
    // ---- AppSetting values (Google/Meta client secrets, R2 keys) ----
    for (const row of await prisma.appSetting.findMany()) {
      const stored = crypto.encryptAppSetting(row.key, row.value);
      if (stored !== row.value) {
        await prisma.appSetting.update({
          where: { orgId_key: { orgId: row.orgId, key: row.key } },
          data: { value: stored },
        });
        appChanged++;
      }
    }

    // ---- Inbox.channelConfig credential fields (WhatsApp/Gmail tokens) ----
    for (const inbox of await prisma.inbox.findMany()) {
      const config = inbox.channelConfig as Record<string, string> | null;
      if (!config) continue;
      const encrypted = crypto.encryptChannelConfig(config);
      if (JSON.stringify(encrypted) !== JSON.stringify(config)) {
        await prisma.inbox.update({ where: { id: inbox.id }, data: { channelConfig: encrypted } });
        inboxChanged++;
      }
    }

    console.log(
      `Secret encryption complete: ${appChanged} app setting(s), ${inboxChanged} inbox config(s) encrypted.`,
    );
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error("Secret encryption migration failed:", err);
  process.exit(1);
});
