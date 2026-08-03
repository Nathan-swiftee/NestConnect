import { Controller, Get } from "@nestjs/common";
import { Store } from "../data/store";

/** Workspace bootstrap data for the app shell: who am I, my inboxes, my sidebar. */
@Controller()
export class WorkspaceController {
  constructor(private readonly store: Store) {}

  @Get("me")
  me() {
    return this.store.me(this.store.demoUserId);
  }

  @Get("inboxes")
  inboxes() {
    return this.store.listInboxes();
  }

  @Get("views")
  views() {
    return this.store.views(this.store.demoUserId);
  }
}
