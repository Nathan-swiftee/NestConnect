import { Injectable } from "@nestjs/common";
import { ORG_ID } from "../data/fixtures";

/**
 * The single seam for "which tenant are we acting as". The platform is currently
 * single-organisation, so this resolves to one org — but centralising it here
 * (instead of importing the `ORG_ID` constant across the codebase) is the
 * migration point for request-scoped, per-tenant resolution later. New code
 * should depend on this, not on the fixture constant.
 */
@Injectable()
export class TenantContext {
  /**
   * The org this deployment operates as. TODO(multi-tenant): replace with a
   * request-scoped resolver that derives the org from the authenticated
   * principal / inbound channel rather than a fixed id.
   */
  get defaultOrgId(): string {
    return ORG_ID;
  }

  /** The org a given authenticated user belongs to (already tenant-safe). */
  orgIdForUser(user: { orgId: string }): string {
    return user.orgId;
  }
}
