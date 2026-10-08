import { ForbiddenException, Injectable } from "@nestjs/common";
import { env } from "../config/env";
import { Store } from "../data/store";
import { boundOrgId } from "./tenant-scope";

/**
 * Demo ("sandbox") workspaces.
 *
 * A sandbox workspace exists to be looked at — by an app-store reviewer, in a
 * sales demo — by someone who is not a customer of anyone. It holds synthetic
 * data only, and it is cut off from everything that leaves the platform:
 *
 *  - Replies are delivered as a simulation: the thread shows them sent and
 *    delivered, and no provider (WhatsApp, email, Gmail, SDK push) is called.
 *  - Channels can't be connected or reconfigured; groups, broadcasts, template
 *    sync and the WhatsApp business profile are unavailable — all of those
 *    talk to Meta or Google on someone's behalf.
 *  - The app's own email (invites, resets, codes), SDK customer push and AI
 *    assist are off: each would carry text out of the platform.
 *  - Its accounts are shared demo logins, so their password, email and two-
 *    factor settings can't be changed by whoever happens to be signed in.
 *
 * And one thing is relaxed: mandatory two-factor *enrolment*. A reviewer is
 * handed a username and password and cannot be handed a phone; requiring an
 * authenticator would make the demo unreachable. The password is still
 * required, the exemption is confined to workspaces flagged as sandboxes (only
 * the setup script sets the flag), and every other workspace is unchanged.
 */
@Injectable()
export class SandboxPolicy {
  private readonly cache = new Map<string, { sandbox: boolean; at: number }>();
  private static readonly TTL_MS = 60_000;

  constructor(private readonly store: Store) {}

  async isSandbox(orgId: string | undefined): Promise<boolean> {
    if (!orgId) return false;
    const hit = this.cache.get(orgId);
    if (hit && Date.now() - hit.at < SandboxPolicy.TTL_MS) return hit.sandbox;
    const sandbox = await this.store.isSandboxOrg(orgId);
    this.cache.set(orgId, { sandbox, at: Date.now() });
    return sandbox;
  }

  /** Whether the workspace the current request/job acts for is a sandbox. */
  current(): Promise<boolean> {
    return this.isSandbox(boundOrgId());
  }

  /** Refuse an action that would reach outside the platform, in a sandbox. */
  async assertLive(action: string): Promise<void> {
    if (await this.current()) {
      throw new ForbiddenException(`${action} isn't available in the demo workspace`);
    }
  }

  /** Whether this workspace's accounts must enrol in two-factor to sign in. */
  async twoFactorRequired(orgId: string | undefined): Promise<boolean> {
    if (!env.auth.require2fa) return false;
    return !(await this.isSandbox(orgId));
  }
}
