import { Body, Controller, Delete, Get, NotFoundException, Param, Patch, Post } from "@nestjs/common";
import {
  registerDeviceInputSchema,
  setConversationMutedInputSchema,
  updatePushPreferencesInputSchema,
  type DeviceInfo,
  type PushPreferences,
  type RegisterDeviceInput,
  type SetConversationMutedInput,
  type UpdatePushPreferencesInput,
} from "@ding/schemas";
import { ZodValidationPipe } from "../common/zod-validation.pipe";
import { Store } from "../data/store";
import type { StoredDevice } from "../data/store";
import { CurrentSessionId, CurrentUserId } from "../auth/current-user.decorator";
import { PushService } from "./push.service";

/**
 * The device registry behind push. A device belongs to the person signed in on
 * it, so every route here is scoped to the caller — there is no cross-user view,
 * by design: a push token is an address, and one person should never be able to
 * enumerate or send to another's.
 */
@Controller("devices")
export class DevicesController {
  constructor(
    private readonly store: Store,
    private readonly push: PushService,
  ) {}

  private view(d: StoredDevice): DeviceInfo {
    // The push token is deliberately absent: it never needs to leave the server.
    return {
      id: d.id,
      platform: d.platform,
      deviceName: d.deviceName,
      appVersion: d.appVersion,
      osVersion: d.osVersion,
      createdAt: d.createdAt,
      lastSeenAt: d.lastSeenAt,
      disabledReason: d.disabledReason,
    };
  }

  /**
   * Register this install for push, or refresh an existing registration.
   *
   * The app calls this after sign-in *and* on every start, because push tokens
   * rotate — re-sending the same one is a cheap no-op, and sending a new one
   * after a rotation is the only way we learn the new address.
   *
   * The device is tied to the caller's session, so remote sign-out takes its
   * notifications with it.
   */
  @Post()
  async register(
    @CurrentUserId() userId: string,
    @CurrentSessionId() sessionId: string | undefined,
    @Body(new ZodValidationPipe(registerDeviceInputSchema)) body: RegisterDeviceInput,
  ): Promise<DeviceInfo> {
    const device = await this.store.upsertDevice({ userId, sessionId, ...body });
    return this.view(device);
  }

  /** This person's registered devices. */
  @Get()
  async list(@CurrentUserId() userId: string): Promise<DeviceInfo[]> {
    return (await this.store.listDevices(userId)).map((d) => this.view(d));
  }

  /** What this person wants pushed. Defaults when they've never changed them. */
  @Get("preferences")
  preferences(@CurrentUserId() userId: string): Promise<PushPreferences> {
    return this.push.preferences(userId);
  }

  /** Change one or more preferences; the client sends only what moved. */
  @Patch("preferences")
  updatePreferences(
    @CurrentUserId() userId: string,
    @Body(new ZodValidationPipe(updatePushPreferencesInputSchema)) body: UpdatePushPreferencesInput,
  ): Promise<PushPreferences> {
    return this.push.updatePreferences(userId, body);
  }

  /**
   * Silence one conversation for the person asking.
   *
   * A dedicated route rather than a field on the preferences PATCH: the stored
   * value is a list, and two devices each sending a whole list built from their
   * own stale copy would lose one of the mutes.
   */
  @Patch("mute/:conversationId")
  setMuted(
    @CurrentUserId() userId: string,
    @Param("conversationId") conversationId: string,
    @Body(new ZodValidationPipe(setConversationMutedInputSchema)) body: SetConversationMutedInput,
  ): Promise<PushPreferences> {
    return this.push.setConversationMuted(userId, conversationId, body.muted);
  }

  /** Send a real push to this person's own devices, and say what happened.
   *  "Did it arrive?" is the only question that matters when setting push up,
   *  and it can't be answered by inspecting configuration. */
  @Post("test")
  async test(@CurrentUserId() userId: string): Promise<{ devices: number; sent: number; failed: number }> {
    const devices = (await this.store.devicesForUsers([userId])).length;
    const { sent, failed } = await this.push.notifyAndWait({
      userIds: [userId],
      kind: "test",
      title: "Nest Connect",
      body: "Notifications are working on this device.",
    });
    return { devices, sent, failed };
  }

  /** Stop pushing to a device — sign-out, or turning notifications off here. */
  @Delete(":id")
  async remove(@CurrentUserId() userId: string, @Param("id") id: string): Promise<{ ok: true }> {
    if (!(await this.store.deleteDevice(userId, id))) throw new NotFoundException("Device not found");
    return { ok: true };
  }
}
