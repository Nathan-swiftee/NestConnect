import type { CoexistenceSetup } from "@ding/schemas";

/**
 * Meta's Embedded Signup, in its "connect your existing WhatsApp Business app"
 * form (Meta calls it coexistence).
 *
 * It runs in a facebook.com popup opened by Meta's JavaScript SDK. Two things
 * come back, separately:
 *  - the SDK's login callback carries a one-time `code` (exchanged for a token
 *    on our server — the secret never reaches the browser);
 *  - the popup posts a `WA_EMBEDDED_SIGNUP` message naming the WhatsApp Business
 *    Account and the phone number that were onboarded. That is the number we
 *    connect — never "whichever number the account has first".
 *
 * The popup must open straight from a click, or the browser blocks it — so the
 * SDK is loaded ahead of time (`prepareCoexistenceSignup`) and the click only
 * calls `runCoexistenceSignup`.
 */

interface FacebookSdk {
  init(opts: { appId: string; autoLogAppEvents?: boolean; xfbml?: boolean; version: string }): void;
  login(
    cb: (res: { authResponse?: { code?: string } | null; status?: string }) => void,
    opts: Record<string, unknown>,
  ): void;
}

declare global {
  interface Window {
    FB?: FacebookSdk;
    fbAsyncInit?: () => void;
  }
}

export interface CoexistenceResult {
  code: string;
  wabaId: string;
  phoneNumberId: string;
}

let sdk: Promise<FacebookSdk> | null = null;
let initialisedFor = "";

/** Load and initialise Meta's SDK once. Safe to call again. */
export function prepareCoexistenceSignup(setup: CoexistenceSetup): Promise<FacebookSdk> {
  if (!sdk) {
    sdk = new Promise<FacebookSdk>((resolve, reject) => {
      if (window.FB) return resolve(window.FB);
      window.fbAsyncInit = () => (window.FB ? resolve(window.FB) : reject(new Error("Meta's sign-up didn't load")));
      const s = document.createElement("script");
      s.src = "https://connect.facebook.net/en_US/sdk.js";
      s.async = true;
      s.defer = true;
      s.crossOrigin = "anonymous";
      s.onerror = () => {
        sdk = null;
        reject(new Error("Couldn't load Meta's sign-up — check nothing is blocking facebook.com"));
      };
      document.body.appendChild(s);
    });
  }
  return sdk.then((fb) => {
    if (initialisedFor !== setup.appId) {
      fb.init({ appId: setup.appId, autoLogAppEvents: true, xfbml: false, version: setup.graphVersion });
      initialisedFor = setup.appId;
    }
    return fb;
  });
}

/** The SDK, if it has finished loading — what a click handler may use. */
export function loadedSdk(): FacebookSdk | undefined {
  return initialisedFor ? window.FB : undefined;
}

/**
 * Open Meta's sign-up and resolve with the code and the onboarded number.
 * Rejects with a sentence a person can act on if it's cancelled or fails.
 */
export function runCoexistenceSignup(fb: FacebookSdk, setup: CoexistenceSetup): Promise<CoexistenceResult> {
  return new Promise<CoexistenceResult>((resolve, reject) => {
    let session: { wabaId: string; phoneNumberId: string } | null = null;
    let code: string | null = null;
    let settled = false;
    const finish = (err?: Error) => {
      if (settled) return;
      if (err) {
        settled = true;
        cleanup();
        reject(err);
        return;
      }
      if (code && session) {
        settled = true;
        cleanup();
        resolve({ code, ...session });
      }
    };
    const onMessage = (e: MessageEvent) => {
      if (!/(^|\.)facebook\.com$/.test(new URL(e.origin).hostname)) return;
      let data: { type?: string; event?: string; data?: Record<string, string> } | null = null;
      try {
        data = typeof e.data === "string" ? JSON.parse(e.data) : e.data;
      } catch {
        return;
      }
      if (!data || data.type !== "WA_EMBEDDED_SIGNUP") return;
      const ev = String(data.event ?? "");
      if (ev.startsWith("FINISH")) {
        const wabaId = data.data?.waba_id;
        const phoneNumberId = data.data?.phone_number_id;
        if (wabaId && phoneNumberId) {
          session = { wabaId, phoneNumberId };
          finish();
        } else {
          finish(new Error("Meta finished without saying which number was connected — try again"));
        }
      } else if (ev === "CANCEL") {
        const step = data.data?.current_step;
        const why = data.data?.error_message;
        finish(new Error(why ? `Meta stopped the sign-up: ${why}` : `The sign-up was closed${step ? ` at “${step}”` : ""} before it finished`));
      } else if (ev === "ERROR") {
        finish(new Error(`Meta's sign-up failed: ${data.data?.error_message ?? "unknown error"}`));
      }
    };
    let wait: ReturnType<typeof setTimeout> | undefined;
    const cleanup = () => {
      window.removeEventListener("message", onMessage);
      if (wait) clearTimeout(wait);
    };
    window.addEventListener("message", onMessage);

    fb.login(
      (res) => {
        code = res.authResponse?.code ?? null;
        if (!code) {
          finish(new Error("The sign-up was closed before it finished"));
          return;
        }
        finish();
        // The number usually arrives before the callback; give it a moment if not.
        wait = setTimeout(() => finish(new Error("Meta didn't say which number was connected — try again")), 8000);
      },
      {
        config_id: setup.configId,
        response_type: "code",
        override_default_response_type: true,
        extras: {
          setup: {},
          // "Connect your existing WhatsApp Business app" — the number stays on
          // the phone app as well.
          featureType: "whatsapp_business_app_onboarding",
          sessionInfoVersion: "3",
        },
      },
    );
  });
}
