import { Controller, Get } from "@nestjs/common";
import { Store } from "../data/store";
import { CurrentUserId } from "../auth/current-user.decorator";

/** Workspace bootstrap data for the app shell: who am I, my inboxes, my sidebar. */
@Controller()
export class WorkspaceController {
  constructor(private readonly store: Store) {}

  @Get("me")
  me(@CurrentUserId() userId: string) {
    return this.store.me(userId);
  }

  @Get("inboxes")
  inboxes() {
    return this.store.listInboxes();
  }

  @Get("views")
  views(@CurrentUserId() userId: string) {
    return this.store.views(userId);
  }
}
