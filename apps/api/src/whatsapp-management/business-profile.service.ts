import { BadGatewayException, BadRequestException, Injectable, Logger } from "@nestjs/common";
import type { OpeningHours, UpdateWhatsAppBusinessProfileInput, WhatsAppBusinessProfile } from "@ding/schemas";
import { env } from "../config/env";
import { Store } from "../data/store";
import { metaErrorMessage, resolveWhatsAppCreds } from "../channels/whatsapp/whatsapp-creds";

/** The subset of Meta's `whatsapp_business_profile` node we read/write. */
interface MetaProfile {
  about?: string;
  address?: string;
  description?: string;
  email?: string;
  vertical?: string;
  websites?: string[];
  profile_picture_url?: string;
}

/**
 * Manage a WhatsApp number's public business profile — the "about" line,
 * description, address, contact details and category a customer sees on the
 * business card in WhatsApp. Backed by Meta's Cloud API
 * `GET/POST /{phone-number-id}/whatsapp_business_profile`. Works on any
 * connected number (no Official Business Account needed).
 */
@Injectable()
export class BusinessProfileService {
  private readonly logger = new Logger(BusinessProfileService.name);

  constructor(private readonly store: Store) {}

  /** Resolve a WhatsApp inbox's live credentials, or explain why it can't. */
  private async credsFor(inboxId: string) {
    const inbox = await this.store.getInbox(inboxId);
    if (!inbox || inbox.type !== "whatsapp") {
      throw new BadRequestException("That inbox isn't a WhatsApp number.");
    }
    const creds = await resolveWhatsAppCreds(this.store, inboxId);
    if (!creds) {
      throw new BadRequestException(
        "This WhatsApp number isn't connected yet — add its Phone number ID and access token under Channels first.",
      );
    }
    return creds;
  }

  /** Read the number's current public profile from Meta. */
  async get(inboxId: string): Promise<WhatsAppBusinessProfile> {
    const creds = await this.credsFor(inboxId);
    const fields = "about,address,description,email,profile_picture_url,websites,vertical";
    const url =
      `https://graph.facebook.com/${env.whatsapp.apiVersion}/${creds.phoneNumberId}` +
      `/whatsapp_business_profile?fields=${fields}`;
    let res: Response;
    let json: { data?: MetaProfile[]; error?: unknown };
    try {
      res = await fetch(url, { headers: { authorization: `Bearer ${creds.accessToken}` } });
      json = (await res.json()) as { data?: MetaProfile[]; error?: unknown };
    } catch (err) {
      throw new BadGatewayException(`Couldn't reach WhatsApp: ${String(err)}`);
    }
    if (!res.ok) {
      this.logger.warn(`Business profile GET HTTP ${res.status}: ${JSON.stringify(json.error ?? json)}`);
      throw new BadGatewayException(metaErrorMessage(json.error, res.status));
    }
    const profile = fromMeta(json.data?.[0] ?? {});
    profile.openingHours = await this.readHours(inboxId);
    return profile;
  }

  private hoursKey(inboxId: string): string {
    return `wa_opening_hours:${inboxId}`;
  }

  /** Opening hours live in Nest Connect (WhatsApp has no hours field). */
  private async readHours(inboxId: string): Promise<OpeningHours | undefined> {
    const orgId = (await this.store.getInbox(inboxId))?.orgId;
    if (!orgId) return undefined;
    const raw = await this.store.getAppSetting(orgId, this.hoursKey(inboxId));
    if (!raw) return undefined;
    try {
      return JSON.parse(raw) as OpeningHours;
    } catch {
      return undefined;
    }
  }

  /** Write the editable fields back to Meta, then return the fresh profile. */
  async update(
    inboxId: string,
    input: UpdateWhatsAppBusinessProfileInput,
  ): Promise<WhatsAppBusinessProfile> {
    const creds = await this.credsFor(inboxId);
    // Opening hours are stored in Nest Connect (WhatsApp has no hours field).
    if (input.openingHours !== undefined) {
      const orgId = (await this.store.getInbox(inboxId))?.orgId;
      if (orgId) await this.store.setAppSetting(orgId, this.hoursKey(inboxId), JSON.stringify(input.openingHours));
    }
    // Only forward the fields the caller actually set (an omitted field is left
    // as-is at Meta; an explicit empty string clears it).
    const body: Record<string, unknown> = { messaging_product: "whatsapp" };
    if (input.about !== undefined) body.about = input.about;
    if (input.address !== undefined) body.address = input.address;
    if (input.description !== undefined) body.description = input.description;
    if (input.email !== undefined) body.email = input.email;
    if (input.vertical !== undefined) body.vertical = input.vertical;
    if (input.websites !== undefined) {
      // Drop blank rows so an empty field doesn't send "" to Meta (a 400).
      body.websites = input.websites.map((w) => w.trim()).filter(Boolean);
    }

    // Only hit Meta when a Meta-backed field changed — an hours-only save is
    // local, so it skips the network call.
    if (Object.keys(body).length > 1) {
      const url =
        `https://graph.facebook.com/${env.whatsapp.apiVersion}/${creds.phoneNumberId}` +
        `/whatsapp_business_profile`;
      let res: Response;
      let json: { success?: boolean; error?: unknown };
      try {
        res = await fetch(url, {
          method: "POST",
          headers: { authorization: `Bearer ${creds.accessToken}`, "content-type": "application/json" },
          body: JSON.stringify(body),
        });
        json = (await res.json()) as { success?: boolean; error?: unknown };
      } catch (err) {
        throw new BadGatewayException(`Couldn't reach WhatsApp: ${String(err)}`);
      }
      if (!res.ok) {
        this.logger.warn(`Business profile POST HTTP ${res.status}: ${JSON.stringify(json.error ?? json)}`);
        throw new BadGatewayException(metaErrorMessage(json.error, res.status));
      }
      this.logger.log(`Updated WhatsApp business profile for inbox ${inboxId}`);
    }
    return this.get(inboxId);
  }

  /**
   * Set the number's public profile photo. Meta's Cloud API can't take image
   * bytes on the profile node directly — you upload via the app-scoped resumable
   * upload API to get a handle, then set `profile_picture_handle`. Needs a Meta
   * App ID (per-number config, else the global env).
   */
  async setPhoto(
    inboxId: string,
    file: { buffer: Buffer; mimetype: string; originalname?: string },
  ): Promise<WhatsAppBusinessProfile> {
    const creds = await this.credsFor(inboxId);
    if (!file?.buffer?.length) throw new BadRequestException("No image received.");
    if (!/^image\/(jpeg|png)$/.test(file.mimetype)) {
      throw new BadRequestException("Use a JPG or PNG image.");
    }
    const appId = (await this.store.getInboxConfig(inboxId))?.appId || env.whatsapp.appId;
    if (!appId) {
      throw new BadRequestException(
        "Add your Meta App ID (under Channels → this number) to change the profile photo from here.",
      );
    }
    const v = env.whatsapp.apiVersion;
    const bytes = new Uint8Array(file.buffer);

    // 1. Open a resumable upload session.
    const start = await this.metaJson(
      `https://graph.facebook.com/${v}/${appId}/uploads` +
        `?file_name=${encodeURIComponent(file.originalname || "profile.jpg")}` +
        `&file_length=${bytes.length}&file_type=${encodeURIComponent(file.mimetype)}`,
      { method: "POST", headers: { authorization: `Bearer ${creds.accessToken}` } },
    );
    if (!start.id) throw new BadGatewayException("WhatsApp didn't start the photo upload.");

    // 2. Upload the bytes → a file handle.
    const uploaded = await this.metaJson(`https://graph.facebook.com/${v}/${start.id}`, {
      method: "POST",
      headers: { authorization: `OAuth ${creds.accessToken}`, file_offset: "0" },
      body: bytes,
    });
    if (!uploaded.h) throw new BadGatewayException("WhatsApp didn't return a photo handle.");

    // 3. Point the profile at the handle.
    await this.metaJson(`https://graph.facebook.com/${v}/${creds.phoneNumberId}/whatsapp_business_profile`, {
      method: "POST",
      headers: { authorization: `Bearer ${creds.accessToken}`, "content-type": "application/json" },
      body: JSON.stringify({ messaging_product: "whatsapp", profile_picture_handle: uploaded.h }),
    });
    this.logger.log(`Updated WhatsApp profile photo for inbox ${inboxId}`);
    return this.get(inboxId);
  }

  /** POST/GET Meta, returning parsed JSON or throwing a friendly BadGateway. */
  private async metaJson(url: string, init: RequestInit): Promise<Record<string, any>> {
    let res: Response;
    let json: { error?: unknown; [k: string]: unknown };
    try {
      res = await fetch(url, init);
      json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    } catch (err) {
      throw new BadGatewayException(`Couldn't reach WhatsApp: ${String(err)}`);
    }
    if (!res.ok) {
      this.logger.warn(`Meta ${init.method} HTTP ${res.status}: ${JSON.stringify(json.error ?? json)}`);
      throw new BadGatewayException(metaErrorMessage(json.error, res.status));
    }
    return json;
  }
}

/** Map Meta's snake_case profile payload to our camelCase domain shape. */
function fromMeta(p: MetaProfile): WhatsAppBusinessProfile {
  return {
    about: p.about ?? undefined,
    address: p.address ?? undefined,
    description: p.description ?? undefined,
    email: p.email ?? undefined,
    vertical: (p.vertical as WhatsAppBusinessProfile["vertical"]) ?? undefined,
    websites: p.websites ?? undefined,
    profilePictureUrl: p.profile_picture_url ?? undefined,
  };
}
