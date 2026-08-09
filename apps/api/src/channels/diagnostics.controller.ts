import { Controller, ForbiddenException, Get, NotFoundException, Query } from "@nestjs/common";
import { Store, type WebhookDiagnostic } from "../data/store";
import { CurrentUserId } from "../auth/current-user.decorator";

/**
 * Read-only view of recent inbound-webhook problems (unmapped accounts, bad
 * signatures). Admins/managers only. Useful when a channel "goes quiet" — an
 * unmapped number or a signature mismatch shows up here instead of silently
 * landing in the wrong inbox.
 */
@Controller("channels/diagnostics")
export class DiagnosticsController {
  constructor(private readonly store: Store) {}

  @Get()
  async list(
    @CurrentUserId() userId: string,
    @Query("limit") limit?: string,
  ): Promise<WebhookDiagnostic[]> {
    const me = await this.store.getUser(userId);
    if (!me) throw new NotFoundException("Current user not found");
    if (me.role !== "admin" && me.role !== "manager") {
      throw new ForbiddenException("Only admins and managers can view webhook diagnostics");
    }
    const n = limit ? Number(limit) : 100;
    return this.store.listWebhookDiagnostics(Number.isFinite(n) ? n : 100);
  }
}
