import { env } from "../config/env";
import type { Store } from "../data/store";
import { PLATFORM_ORG_ID } from "./platform";

/**
 * Whether this person owns the platform — above any one workspace: they see
 * every workspace, make new ones, can open any of them, and alone change the
 * integrations every workspace runs on.
 *
 * It's who they are (their sign-in), not where they are: true in whichever
 * workspace they're in at the moment. Named by PLATFORM_OWNERS; without it,
 * the admins of the platform's own workspace. A manager there is not one —
 * managing a team is not owning the platform.
 */
export async function isPlatformOwner(store: Store, userId: string): Promise<boolean> {
  const places = await store.listMemberships(userId);
  if (!places.length) return false;
  if (env.platformOwners.length) return env.platformOwners.includes(places[0]!.user.email.trim().toLowerCase());
  return places.some((m) => m.user.orgId === PLATFORM_ORG_ID && m.user.role === "admin");
}
