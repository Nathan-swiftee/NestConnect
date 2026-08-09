import { Body, Controller, Get, Post } from "@nestjs/common";
import { CurrentUserId } from "../auth/current-user.decorator";
import { Store } from "../data/store";

@Controller("notifications")
export class NotificationsController {
  constructor(private readonly store: Store) {}

  /** The current user's recent bell notifications (newest first). */
  @Get()
  list(@CurrentUserId() userId: string) {
    return this.store.listNotifications(userId);
  }

  /** Mark some (by id) — or, when no ids are given, all — of them read. */
  @Post("read")
  async read(@CurrentUserId() userId: string, @Body() body: { ids?: string[] }): Promise<{ ok: boolean }> {
    const ids = Array.isArray(body?.ids) ? body.ids.filter((x) => typeof x === "string") : undefined;
    await this.store.markNotificationsRead(userId, ids);
    return { ok: true };
  }
}
