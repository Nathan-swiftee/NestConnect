import { useState } from "react";
import {
  WHATSAPP_STATUS_LABEL,
  whatsAppCanRegister,
  type WhatsAppNumberStatus,
} from "@ding/schemas";
import { useRegisterWhatsappNumber, useWhatsappNumberStatus } from "@ding/client";

/**
 * The last step of connecting a WhatsApp number, which Meta does not do for you.
 *
 * A number added and verified in WhatsApp Manager still sits at "Pending" until
 * something calls the Cloud API's registration endpoint — Meta's own advice is
 * "register this phone number using the registration API or contact your
 * partner". Nest Connect is the partner, so this is where that happens.
 *
 * Everything here deals in one 6-digit PIN. The Phone number ID and access
 * token are never sent from the browser: the server reads them from the
 * channel's stored config, which is the only place the token has ever lived.
 */

/** Which pill colour a status gets. `on` is the app's green, `off` its amber;
 *  a hard failure takes the danger tone so it does not read as "nearly there". */
const PILL_TONE: Record<WhatsAppNumberStatus, string> = {
  connected: "on",
  registration_required: "off",
  auth_failed: "bad",
  configuration_error: "bad",
  meta_error: "bad",
};

/**
 * The PIN box.
 *
 * Two things earn their place here. It is masked, because it is a credential
 * and admins share screens. And it strips everything but digits as you type,
 * because Meta allows only a handful of wrong guesses before it locks the
 * number out for 24 hours — a pasted "123 456" being rejected as a mismatch
 * would spend one of them on a space.
 */
export function WhatsAppPinField({
  value,
  onChange,
  label = "WhatsApp two-step verification PIN",
  optional,
  autoFocus,
}: {
  value: string;
  onChange: (v: string) => void;
  label?: string;
  optional?: boolean;
  autoFocus?: boolean;
}) {
  return (
    <label className="field">
      <span>
        {label} {optional && <em>optional</em>}
      </span>
      {/*
        The length is capped in the handler and deliberately not with
        `maxLength`. The attribute counts raw characters, which it sees *before*
        the strip below runs — so one stray letter in a pasted "1a23456" fills
        the sixth slot with something that is then thrown away, and the last
        digit can never be typed at all. Capping the digits instead means a
        letter is simply ignored, which is the whole point of stripping them.
      */}
      <input
        type="password"
        inputMode="numeric"
        autoComplete="off"
        value={value}
        autoFocus={autoFocus}
        onChange={(e) => onChange(e.target.value.replace(/\D/g, "").slice(0, 6))}
        /* Not a row of dots. In a masked field a dotted placeholder is exactly
           what a filled one looks like, so after a rejected PIN the cleared box
           reads as though the PIN is still in it — and the admin retries the
           same thing, spending another of Meta's few guesses. */
        placeholder="6 digits"
      />
      <small className="fieldhint">
        This is the 6-digit two-step verification PIN configured for this WhatsApp number in Meta. It is
        not the SMS/voice verification code.
      </small>
    </label>
  );
}

/**
 * The registration control on an existing channel.
 *
 * Shows what Meta says — asked of Meta, not inferred from whether we happen to
 * have credentials saved, which is what made a Pending number read as
 * "Connected" here while it could not send a thing. The Register button appears
 * only for the one status registering can fix; a banned or misconfigured number
 * gets the explanation instead of a PIN box that would lead nowhere.
 */
export function WhatsAppRegistration({
  channelId,
  onToast,
}: {
  channelId: string;
  onToast: (msg: string) => void;
}) {
  const status = useWhatsappNumberStatus(channelId);
  const register = useRegisterWhatsappNumber();
  const [open, setOpen] = useState(false);
  const [pin, setPin] = useState("");

  const state = status.data;
  const tone = state ? PILL_TONE[state.status] : "";
  const canRegister = state ? whatsAppCanRegister(state.status) : false;

  const submit = () => {
    if (pin.length !== 6) return;
    register.mutate(
      { channelId, pin },
      {
        onSettled: () => setPin(""), // the PIN does not outlive the request
        onSuccess: (r) => {
          if (r.ok) {
            setOpen(false);
            onToast(r.alreadyRegistered ? "This number was already registered" : "Number registered with Meta");
          }
        },
        onError: (e) => onToast(e instanceof Error ? e.message : "Couldn't register the number"),
      },
    );
  };

  return (
    <div className="wareg">
      <div className="wareg__row">
        <span className="wareg__label">WhatsApp status</span>
        {status.isPending ? (
          <span className="connpill">
            <span className="connpill__dot" />
            Checking with Meta…
          </span>
        ) : state ? (
          <span className={"connpill " + tone}>
            <span className="connpill__dot" />
            {WHATSAPP_STATUS_LABEL[state.status]}
          </span>
        ) : (
          <span className="connpill bad">
            <span className="connpill__dot" />
            Couldn’t reach Meta
          </span>
        )}
        <div className="wareg__acts">
          <button
            type="button"
            className="btn-ghost sm"
            onClick={() => status.refetch()}
            disabled={status.isFetching}
          >
            {status.isFetching ? "Checking…" : "Re-check"}
          </button>
          {canRegister && !open && (
            <button type="button" className="btn-primary sm" onClick={() => setOpen(true)}>
              Register number
            </button>
          )}
        </div>
      </div>

      {state?.detail && <p className="wareg__detail">{state.detail}</p>}
      {/* Meta's own words for the number, for a support conversation that needs
          to quote something more precise than our five buckets. */}
      {state?.metaStatus && state.status !== "connected" && (
        <p className="wareg__meta">
          Meta reports: {state.metaStatus}
          {state.codeVerificationStatus ? ` · verification ${state.codeVerificationStatus}` : ""}
        </p>
      )}

      {open && (
        <div className="wareg__form">
          <WhatsAppPinField value={pin} onChange={setPin} autoFocus />
          <div className="wareg__formacts">
            <button
              type="button"
              className="btn-ghost sm"
              onClick={() => {
                setOpen(false);
                setPin("");
              }}
            >
              Cancel
            </button>
            <button
              type="button"
              className="btn-primary sm"
              onClick={submit}
              disabled={pin.length !== 6 || register.isPending}
            >
              {register.isPending ? "Registering…" : "Register with Meta"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
