import { Injectable } from "@nestjs/common";
import * as crypto from "node:crypto";
import bcrypt from "bcryptjs";
import * as OTPAuth from "otpauth";
import QRCode from "qrcode";
import type { TotpSetup, TwoFactorStatus, User } from "@ding/schemas";
import { Store } from "../data/store";
import { loginCodeEmail } from "../mail/templates";
import { SecretEncryptionService } from "../crypto/secret-encryption.service";
import { Mailer } from "../mail/mailer.service";

const ISSUER = "Nest Connect";
const RECOVERY_CODE_COUNT = 10;
const EMAIL_CODE_TTL_MS = 10 * 60 * 1000;

/** Strip spacing/case so recovery codes match however they're typed/pasted. */
function normalizeRecovery(code: string): string {
  return code.toLowerCase().replace(/[^a-z0-9]/g, "");
}

/**
 * Two-factor auth: authenticator (TOTP) + emailed codes, one-time recovery
 * codes, and the login challenge. The TOTP secret is encrypted at rest; codes
 * (recovery + emailed) are stored bcrypt-hashed. Enrolment stores a provisional
 * secret first (enabled:false) and only flips enabled once a code confirms it.
 */
@Injectable()
export class TwoFactorService {
  constructor(
    private readonly store: Store,
    private readonly secrets: SecretEncryptionService,
    private readonly mailer: Mailer,
  ) {}

  /** userId → when we last saw a second factor on the account. */
  private readonly enrolled = new Map<string, number>();
  private static readonly ENROLLED_TTL_MS = 60_000;

  /**
   * Does this person have a second factor? Asked by the guard on every request
   * where the workspace requires one.
   *
   * Only the `true` answer is cached, and that asymmetry is the whole design.
   * Enrolled is the steady state for almost everyone almost always, so caching
   * it keeps a lookup off the hot path; not-enrolled is a state somebody is
   * actively trying to leave, and caching *that* would leave them staring at
   * the gate for another minute after they'd finished setting it up. Nobody
   * would read that as a cache — they'd read it as the setup not having worked,
   * and try again.
   *
   * A cached `true` is dropped by `disable` below, so turning a second factor
   * off takes hold on the next request rather than up to a minute later.
   */
  async isEnrolled(userId: string): Promise<boolean> {
    const hit = this.enrolled.get(userId);
    if (hit !== undefined && Date.now() - hit < TwoFactorService.ENROLLED_TTL_MS) return true;
    const on = (await this.store.getUser(userId))?.twoFactorEnabled === true;
    if (on) this.enrolled.set(userId, Date.now());
    else this.enrolled.delete(userId);
    return on;
  }

  private totp(secret: string, label: string): OTPAuth.TOTP {
    return new OTPAuth.TOTP({
      issuer: ISSUER,
      label,
      algorithm: "SHA1",
      digits: 6,
      period: 30,
      secret: OTPAuth.Secret.fromBase32(secret),
    });
  }

  private verifyTotpCode(secret: string, code: string): boolean {
    const clean = code.replace(/\s/g, "");
    if (!/^\d{6}$/.test(clean)) return false;
    // window:1 tolerates ±30s of clock skew between server and phone.
    return this.totp(secret, "x").validate({ token: clean, window: 1 }) !== null;
  }

  /** Begin authenticator setup: store a provisional (not-yet-enabled) secret and
   *  return the QR + the base32 key for manual entry. */
  async startTotpSetup(user: User): Promise<TotpSetup> {
    const secret = new OTPAuth.Secret({ size: 20 }).base32;
    await this.store.updateTwoFactor(user.id, { totpSecret: this.secrets.encrypt(secret) });
    const otpauthUrl = this.totp(secret, user.email).toString();
    const qrDataUrl = await QRCode.toDataURL(otpauthUrl, { margin: 1, width: 220 });
    return { secret, otpauthUrl, qrDataUrl };
  }

  /** Confirm the authenticator code → enable TOTP and return fresh recovery codes. */
  async enableTotp(userId: string, code: string): Promise<string[] | null> {
    const tf = await this.store.getTwoFactor(userId);
    if (!tf?.totpSecret) return null;
    if (!this.verifyTotpCode(this.secrets.decrypt(tf.totpSecret), code)) return null;
    await this.store.updateTwoFactor(userId, { enabled: true, method: "totp" });
    return this.regenerateRecoveryCodes(userId);
  }

  /** Email an OTP for enrolment or a login challenge. */
  async sendEmailCode(user: User): Promise<void> {
    const code = String(crypto.randomInt(0, 1_000_000)).padStart(6, "0");
    await this.store.updateTwoFactor(user.id, {
      emailCodeHash: bcrypt.hashSync(code, 8),
      emailCodeExpires: new Date(Date.now() + EMAIL_CODE_TTL_MS).toISOString(),
    });
    // The expiry is stated from the same constant that enforces it, so the two
    // can't drift into the email promising ten minutes while the code dies in
    // five.
    await this.mailer.sendMail({
      to: user.email,
      ...loginCodeEmail(code, Math.round(EMAIL_CODE_TTL_MS / 60_000)),
    });
  }

  private async verifyEmailCode(userId: string, code: string): Promise<boolean> {
    const tf = await this.store.getTwoFactor(userId);
    if (!tf?.emailCodeHash || !tf.emailCodeExpires) return false;
    if (new Date(tf.emailCodeExpires).getTime() < Date.now()) return false;
    if (!bcrypt.compareSync(code.replace(/\s/g, ""), tf.emailCodeHash)) return false;
    await this.store.updateTwoFactor(userId, { emailCodeHash: null, emailCodeExpires: null }); // one-time
    return true;
  }

  /** Enable the email method after verifying an emailed code. */
  async enableEmail(userId: string, code: string): Promise<string[] | null> {
    if (!(await this.verifyEmailCode(userId, code))) return null;
    await this.store.updateTwoFactor(userId, { enabled: true, method: "email" });
    return this.regenerateRecoveryCodes(userId);
  }

  /** Verify a login challenge for an enabled account: the method's code, or a
   *  one-time recovery code as a fallback. */
  async verifyChallenge(userId: string, code: string): Promise<boolean> {
    const tf = await this.store.getTwoFactor(userId);
    if (!tf?.enabled) return false;
    const clean = code.replace(/\s/g, "");
    if (tf.method === "totp" && tf.totpSecret && this.verifyTotpCode(this.secrets.decrypt(tf.totpSecret), clean)) {
      return true;
    }
    if (tf.method === "email" && (await this.verifyEmailCode(userId, clean))) return true;
    return this.consumeRecoveryCode(userId, clean);
  }

  private async consumeRecoveryCode(userId: string, code: string): Promise<boolean> {
    const normalized = normalizeRecovery(code);
    if (normalized.length < 8) return false;
    for (const rc of await this.store.listRecoveryCodes(userId)) {
      if (!rc.usedAt && bcrypt.compareSync(normalized, rc.codeHash)) {
        await this.store.markRecoveryCodeUsed(rc.id);
        return true;
      }
    }
    return false;
  }

  /** Replace the user's recovery codes with a fresh set; returns the plaintext
   *  codes (shown to the user exactly once). */
  async regenerateRecoveryCodes(userId: string): Promise<string[]> {
    const codes = Array.from({ length: RECOVERY_CODE_COUNT }, () => {
      const raw = crypto.randomBytes(5).toString("hex"); // 10 hex chars
      return `${raw.slice(0, 5)}-${raw.slice(5)}`;
    });
    await this.store.replaceRecoveryCodes(
      userId,
      codes.map((c) => bcrypt.hashSync(normalizeRecovery(c), 8)),
    );
    return codes;
  }

  /** Turn 2FA off entirely and wipe secrets + recovery codes. */
  async disable(userId: string): Promise<void> {
    // Before the write, not after: a request landing in between would otherwise
    // refill the cache with the `true` this is about to make false.
    this.enrolled.delete(userId);
    await this.store.updateTwoFactor(userId, {
      enabled: false,
      method: null,
      totpSecret: null,
      emailCodeHash: null,
      emailCodeExpires: null,
    });
    await this.store.replaceRecoveryCodes(userId, []);
  }

  async status(userId: string): Promise<TwoFactorStatus> {
    const tf = await this.store.getTwoFactor(userId);
    const codes = await this.store.listRecoveryCodes(userId);
    return {
      enabled: tf?.enabled ?? false,
      method: (tf?.method as "totp" | "email" | null) ?? null,
      recoveryCodesRemaining: codes.filter((c) => !c.usedAt).length,
    };
  }
}
