import { Module, type ModuleMetadata } from "@nestjs/common";
import { ServeStaticModule } from "@nestjs/serve-static";
import { join } from "node:path";
import { env } from "./config/env";
import { CryptoModule } from "./crypto/crypto.module";
import { TenancyModule } from "./tenancy/tenancy.module";
import { DataModule } from "./data/data.module";
import { AuthModule } from "./auth/auth.module";
import { RealtimeModule } from "./realtime/realtime.module";
import { ChannelsModule } from "./channels/channels.module";
import { QueueModule } from "./queue/queue.module";
import { ConversationsModule } from "./conversations/conversations.module";
import { WorkspaceModule } from "./workspace/workspace.module";
import { ContactsModule } from "./contacts/contacts.module";
import { StorageModule } from "./storage/storage.module";
import { TemplatesModule } from "./templates/templates.module";
import { HealthController } from "./health/health.controller";

const imports: ModuleMetadata["imports"] = [
  CryptoModule,
  TenancyModule,
  DataModule,
  AuthModule,
  RealtimeModule,
  StorageModule,
  ChannelsModule,
  QueueModule,
  ConversationsModule,
  WorkspaceModule,
  ContactsModule,
  TemplatesModule,
];

// In production the API serves the built SPA (apps/api/dist/main.js → ../../web/dist),
// so the whole app runs as one same-origin service (auth cookies + WS work cleanly).
if (env.serveWeb) {
  imports.push(
    ServeStaticModule.forRoot({
      rootPath: join(__dirname, "..", "..", "web", "dist"),
      exclude: ["/api/(.*)", "/health", "/socket.io/(.*)"],
    }),
  );
}

@Module({
  imports,
  controllers: [HealthController],
})
export class AppModule {}
