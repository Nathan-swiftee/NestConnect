import { BadGatewayException, BadRequestException, Injectable, Logger } from "@nestjs/common";
import type { UpdateWhatsAppBusinessProfileInput, WhatsAppBusinessProfile } from "@ding/schemas";
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
    return fromMeta(json.data?.[0] ?? {});
  }

  /** Write the editable fields back to Meta, then return the fresh profile. */
  async update(
    inboxId: string,
    input: UpdateWhatsAppBusinessProfileInput,
  ): Promise<WhatsAppBusinessProfile> {
    const creds = await this.credsFor(inboxId);
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
    return this.get(inboxId);
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
