import { Injectable } from "@nestjs/common";
import { bindTenant, currentOrgId } from "./tenant-scope";

/**
 * "Which workspace are we acting for", as an injectable — for services that
 * prefer a dependency to a module import. It reads the same request-scoped
 * binding as everything else (see tenant-scope.ts); there is no default org.
 */
@Injectable()
export class TenantContext {
  /** The bound workspace. Throws if nothing is bound. */
  get orgId(): string {
    return currentOrgId();
  }

  /** Bind the current context to `orgId` (see bindTenant). */
  bind(orgId: string): void {
    bindTenant(orgId);
  }

  /** The org a given authenticated user belongs to (already tenant-safe). */
  orgIdForUser(user: { orgId: string }): string {
    return user.orgId;
  }
}
