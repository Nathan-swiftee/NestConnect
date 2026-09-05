import { BadRequestException, Injectable, Logger } from "@nestjs/common";
import type { WhatsAppNumberState, WhatsAppRegisterResult } from "@ding/schemas";
import { env } from "../config/env";
import { Store } from "../data/store";
import { resolveWhatsAppCreds } from "../channels/whatsapp/whatsapp-creds";
import {
  fetchNumberState,
  registerPhoneNumber,
  scrubSecrets,
} from "./whatsapp-registration.logic";

/**
 * A WhatsApp number's registration on the Cloud API.
 *
 * Sits beside BusinessProfileService rather than inside it: both call Meta with
 * one inbox's own credentials, but a number's registration is not its
 * storefront card, and `BusinessProfileService.registerPhoneNumber` would read
 * as a mistake to the next person.
 *
 * The Graph calls themselves live in ./whatsapp-registration.logic.ts. This
 * class owns the three things that need the application: which credentials to
 * use, what the browser is allowed to learn, and what reaches the log.
 */
@Injectable()
export class WhatsAppRegistrationService {
  private readonly logger = new Logger(WhatsAppRegistrationService.name);

  constructor(private readonly store: Store) {}

  /**
   * The credentials for a WhatsApp inbox, or the reason there are none.
   *
   * Returns rather than throws: "this channel has no Phone number ID yet" is a
   * status to render next to a Register button, not a 400 the settings screen
   * has to catch.
   */
  private async credsFor(
    inboxId: string,
  ): Promise<{ phoneNumberId: string; accessToken: string } | WhatsAppNumberState> {
    const inbox = await this.store.getInbox(inboxId);
    if (!inbox) {
      return { status: "configuration_error", detail: "That channel no longer exists." };
    }
    if (inbox.type !== "whatsapp" && inbox.type !== "whatsapp_group") {
      return { status: "configuration_error", detail: "That channel isn't a WhatsApp number." };
    }
    const creds = await resolveWhatsAppCreds(this.store, inboxId);
    if (!creds?.phoneNumberId || !creds.accessToken) {
      return {
        status: "configuration_error",
        detail:
          "This number has no Phone number ID and access token saved yet — add them above, then register it.",
      };
    }
    return { phoneNumberId: creds.phoneNumberId, accessToken: creds.accessToken };
  }

  private isState(v: { phoneNumberId: string } | WhatsAppNumberState): v is WhatsAppNumberState {
    return "status" in v;
  }

  /** What Meta says about this channel's number right now. */
  async stateFor(inboxId: string): Promise<WhatsAppNumberState> {
    const creds = await this.credsFor(inboxId);
    if (this.isState(creds)) return creds;
    const state = await fetchNumberState({ ...creds, apiVersion: env.whatsapp.apiVersion });
    this.log(inboxId, `status is ${state.status}`, state.detail, creds.accessToken);
    return state;
  }

  /**
   * Register this channel's number with Meta using a two-step verification PIN.
   *
   * The PIN arrives on the request, is passed straight to Meta, and goes out of
   * scope when this method returns. It is never written to `channelConfig`,
   * never echoed in the response and never logged — which is why the signature
   * takes it as an argument rather than reading it from anywhere.
   */
  async register(inboxId: string, pin: string): Promise<WhatsAppRegisterResult> {
    // Defence in depth: the controller's Zod pipe has already enforced this, but
    // a wrong-length PIN sent to Meta still burns one of the handful of guesses
    // it allows before locking the number out for 24 hours.
    if (!/^[0-9]{6}$/.test(pin)) {
      throw new BadRequestException("The two-step verification PIN is exactly 6 digits.");
    }
    const creds = await this.credsFor(inboxId);
    if (this.isState(creds)) {
      return { ok: false, alreadyRegistered: false, state: creds };
    }
    const result = await registerPhoneNumber({
      ...creds,
      apiVersion: env.whatsapp.apiVersion,
      pin,
    });
    this.log(
      inboxId,
      result.ok
        ? result.alreadyRegistered
          ? "was already registered"
          : "registered"
        : `registration failed (${result.state.status})`,
      result.state.detail,
      creds.accessToken,
      pin,
    );
    return result;
  }

  /**
   * One place where anything about a number reaches the log, and the only place
   * that has to be careful. The detail line is Meta's or ours, so it should
   * never contain a credential — `scrubSecrets` is here so that "should" is not
   * the only thing standing between a token and the log aggregator.
   */
  private log(inboxId: string, what: string, detail: string, ...secrets: Array<string | undefined>): void {
    this.logger.log(`WhatsApp number for inbox ${inboxId} ${what}: ${scrubSecrets(detail, secrets)}`);
  }
}
