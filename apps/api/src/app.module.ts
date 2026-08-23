import { Module, type ModuleMetadata } from "@nestjs/common";
import { APP_FILTER, APP_GUARD } from "@nestjs/core";
import { ServeStaticModule } from "@nestjs/serve-static";
import { ThrottlerGuard, ThrottlerModule } from "@nestjs/throttler";
import { join } from "node:path";
import { env } from "./config/env";
import { AllExceptionsFilter } from "./common/all-exceptions.filter";
import { HealthService } from "./health/health.service";
import { CryptoModule } from "./crypto/crypto.module";
import { TenancyModule } from "./tenancy/tenancy.module";
import { DataModule } from "./data/data.module";
import { MailModule } from "./mail/mail.module";
import { AuthModule } from "./auth/auth.module";
import { RealtimeModule } from "./realtime/realtime.module";
import { ChannelsModule } from "./channels/channels.module";
import { QueueModule } from "./queue/queue.module";
import { ConversationsModule } from "./conversations/conversations.module";
import { NotificationsModule } from "./notifications/notifications.module";
import { PushModule } from "./push/push.module";
import { WorkspaceModule } from "./workspace/workspace.module";
import { ContactsModule } from "./contacts/contacts.module";
import { StorageModule } from "./storage/storage.module";
import { TemplatesModule } from "./templates/templates.module";
import { WhatsAppManagementModule } from "./whatsapp-management/whatsapp-management.module";
import { AnalyticsModule } from "./analytics/analytics.module";
import { TrackingModule } from "./tracking/tracking.module";
import { AiModule } from "./ai/ai.module";
import { HealthController } from "./health/health.controller";

const imports: ModuleMetadata["imports"] = [
  // Global IP rate limiting (in-memory per node; move to Redis storage for
  // multi-node). Generous default — abuse/DoS protection, not a usage cap.
  ThrottlerModule.forRoot([{ ttl: 60_000, limit: 1200 }]),
  CryptoModule,
  TenancyModule,
  DataModule,
  MailModule,
  AuthModule,
  RealtimeModule,
  StorageModule,
  ChannelsModule,
  QueueModule,
  ConversationsModule,
  NotificationsModule,
  PushModule,
  WorkspaceModule,
  ContactsModule,
  TemplatesModule,
  WhatsAppManagementModule,
  AnalyticsModule,
  TrackingModule,
  AiModule,
];

// In production the API serves the built SPA (apps/api/dist/main.js → ../../web/dist),
// so the whole app runs as one same-origin service (auth cookies + WS work cleanly).
if (env.serveWeb) {
  imports.push(
    ServeStaticModule.forRoot({
      rootPath: join(__dirname, "..", "..", "web", "dist"),
      exclude: ["/api/(.*)", "/health", "/health/(.*)", "/socket.io/(.*)"],
    }),
  );
}

@Module({
  imports,
  controllers: [HealthController],
  providers: [
    HealthService,
    // Global rate-limit guard and catch-all exception filter (structured logging).
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_FILTER, useClass: AllExceptionsFilter },
  ],
})
export class AppModule {}
