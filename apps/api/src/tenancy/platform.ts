import { ORG_ID } from "../data/fixtures";

/**
 * The operator's own workspace.
 *
 * Some settings are not any one workspace's business: where media is stored
 * (R2), how the app sends its own email (SMTP / Resend), the Expo and Firebase
 * project phones are reached through, the Google and Meta app credentials every
 * workspace connects through, the AI key. They are configured once, by the
 * people who run the platform, and they live with the platform's own workspace.
 *
 * That workspace is the original one — every deployment so far has run as it,
 * which is why its id is the long-standing constant. `PLATFORM_ORG_ID` exists
 * for a deployment that is ever set up the other way round.
 */
export const PLATFORM_ORG_ID = process.env.PLATFORM_ORG_ID?.trim() || ORG_ID;

export function isPlatformOrg(orgId: string | undefined): boolean {
  return !!orgId && orgId === PLATFORM_ORG_ID;
}
