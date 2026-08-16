import { Controller, ForbiddenException, Get, NotFoundException, Query } from "@nestjs/common";
import { analyticsQuerySchema, type AnalyticsResult } from "@ding/schemas";
import { Store } from "../data/store";
import { CurrentUserId } from "../auth/current-user.decorator";
import { AnalyticsService } from "./analytics.service";

/**
 * The insights dashboard feed. Admins and managers only — agents don't see the
 * Insights section, and this endpoint fails closed for them too. Every metric is
 * derived on the fly from conversations + messages in the requested window, so
 * there's nothing to precompute or keep in sync.
 */
@Controller("analytics")
export class AnalyticsController {
  constructor(
    private readonly store: Store,
    private readonly analytics: AnalyticsService,
  ) {}

  @Get()
  async dashboard(
    @CurrentUserId() userId: string,
    @Query("range") range?: string,
    @Query("channel") channel?: string,
    @Query("teamId") teamId?: string,
    @Query("agentUserId") agentUserId?: string,
  ): Promise<AnalyticsResult> {
    const me = await this.store.getUser(userId);
    if (!me) throw new NotFoundException("Current user not found");
    if (me.role !== "admin" && me.role !== "manager") {
      throw new ForbiddenException("Only admins and managers can view analytics");
    }
    // Coerce + default the query (unknown values fall back to "all" / "30d").
    const input = analyticsQuerySchema.parse({
      range: range || undefined,
      channel: channel || undefined,
      teamId: teamId || undefined,
      agentUserId: agentUserId || undefined,
    });
    return this.analytics.dashboard(me.orgId, input);
  }
}
