/*
 * The NestChat launcher — the one-line embed.
 *
 *   <script>window.NestChatSettings = { key: "nc_...", host: "https://your-app" };</script>
 *   <script src="https://your-app/nestchat.js" defer></script>
 *
 * Plain ES5-ish JavaScript with no build step and no dependencies, because this
 * runs on somebody else's website: it must not assume a bundler, a framework, or
 * a modern-only browser, and it must not leave anything behind in the global
 * scope beyond one namespaced object.
 *
 * All it does is draw a bubble and put the real widget in an iframe. Everything
 * else — the conversation, the visitor's identity, the business's colours —
 * lives inside that iframe, on our own origin, where the host page can't reach
 * it and we don't need to trust the host page either.
 *
 * Configuration deliberately comes from `window.NestChatSettings` first, and
 * from this tag's own data- attributes only as a fallback. That is not a style
 * preference — it is the difference between working and not on a site running
 * an optimiser. WordPress plugins like SiteGround Optimizer, WP Rocket and
 * Autoptimize concatenate every external script into one bundle, and when they
 * do, the original `<script>` element (and every attribute on it) is gone:
 *   - `document.currentScript` becomes the combined bundle, which has no
 *     data-key, so the widget reports a missing key and stops;
 *   - and the bundle is served from the *customer's* domain, so deriving our
 *     origin from `script.src` would point the iframe at their site.
 * A settings object is code, so it survives being combined and minified.
 */
(function () {
  "use strict";

  if (window.NestChat && window.NestChat.mounted) return;

  /** The `<script>` element that loaded us, when it still exists as itself. */
  function ownTag() {
    var current = document.currentScript;
    // Only trust currentScript if it really is our file: after combination it
    // is the bundle, which knows nothing about us.
    if (current && current.src && current.src.indexOf("nestchat.js") !== -1) return current;
    var all = document.getElementsByTagName("script");
    for (var i = all.length - 1; i >= 0; i--) {
      if (all[i].src && all[i].src.indexOf("nestchat.js") !== -1) return all[i];
    }
    // Not combined, but moved or re-executed by a tag manager — the attributes
    // may still be on the element even if the src doesn't name us.
    return current || null;
  }

  var tag = ownTag();
  var settings = window.NestChatSettings || window.nestChatSettings || {};
  // An element carrying the key survives combination too, for anyone who would
  // rather put it in their HTML than in a script block.
  var marked = document.querySelector ? document.querySelector("[data-nestchat-key]") : null;

  function option(name, settingsKey) {
    if (settings[settingsKey] != null && settings[settingsKey] !== "") return String(settings[settingsKey]);
    if (tag && tag.getAttribute("data-" + name)) return tag.getAttribute("data-" + name);
    if (marked && marked.getAttribute("data-nestchat-" + name)) {
      return marked.getAttribute("data-nestchat-" + name);
    }
    return null;
  }

  function warn(message) {
    if (window.console && console.warn) console.warn("[NestChat] " + message);
  }

  var key = option("key", "key");
  if (!key) {
    warn(
      "No widget key found. If your site combines or minifies JavaScript, the " +
        "data-key attribute is stripped — use the snippet that sets " +
        "window.NestChatSettings instead (Settings › NestChat widget › Install).",
    );
    return;
  }

  // Where to load the chat itself from. `host` in the settings object is the
  // reliable answer; our own src works when the tag survived; and a bundle's
  // src is the customer's own domain, which is never right.
  var origin = "";
  var host = option("host", "host");
  if (host) {
    origin = String(host).replace(/\/+$/, "");
  } else if (tag && tag.src && tag.src.indexOf("nestchat.js") !== -1) {
    origin = new URL(tag.src, window.location.href).origin;
  }
  if (!origin) {
    warn(
      "Can't tell which Nest Connect server to load the chat from. Add " +
        "host to window.NestChatSettings (Settings › NestChat widget › Install).",
    );
    return;
  }

  var position = option("position", "position") === "left" ? "left" : "right";
  var accent = option("accent", "accent") || "#2563eb";
  var label = option("label", "label") || "Chat with us";
  var open = false;

  var side = position === "left" ? "left" : "right";

  var frame = document.createElement("iframe");
  // Stable ids on both elements. A customer's own stylesheet is written against
  // their page, not ours, and a bare `button {}` rule is common enough that the
  // launcher needs something to be addressed by — for them to override, and for
  // us to point at when someone asks why it's sitting behind their footer.
  frame.id = "nestchat-frame";
  frame.src = origin + "/widget.html?key=" + encodeURIComponent(key);
  frame.title = label;
  frame.setAttribute("aria-hidden", "true");
  // The iframe is same-origin with our API but cross-origin to the host page,
  // so the host page cannot read the conversation and we cannot read the host.
  frame.allow = "clipboard-write";
  frame.style.cssText = [
    "position:fixed",
    "bottom:88px",
    side + ":20px",
    "width:380px",
    "height:min(620px, calc(100vh - 120px))",
    "max-width:calc(100vw - 40px)",
    "border:0",
    "border-radius:16px",
    "box-shadow:0 12px 40px rgba(16,24,40,.22)",
    "background:transparent",
    "z-index:2147483646",
    "display:none",
    "opacity:0",
    "transform:translateY(12px)",
    "transition:opacity .16s ease, transform .16s ease",
  ].join(";");

  var button = document.createElement("button");
  button.id = "nestchat-launcher";
  button.type = "button";
  button.setAttribute("aria-label", label);
  button.setAttribute("aria-expanded", "false");
  button.title = label;
  button.style.cssText = [
    "position:fixed",
    "bottom:20px",
    side + ":20px",
    "width:56px",
    "height:56px",
    "border:0",
    "border-radius:50%",
    "background:" + accent,
    "color:#fff",
    "cursor:pointer",
    "box-shadow:0 6px 20px rgba(16,24,40,.28)",
    "z-index:2147483647",
    "display:flex",
    "align-items:center",
    "justify-content:center",
    "padding:0",
  ].join(";");

  var bubbleIcon =
    '<svg width="26" height="26" viewBox="0 0 24 24" fill="none" aria-hidden="true">' +
    '<path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z" ' +
    'stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  var closeIcon =
    '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden="true">' +
    '<path d="M18 6 6 18M6 6l12 12" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/></svg>';
  button.innerHTML = bubbleIcon;

  function setOpen(next) {
    open = next;
    button.setAttribute("aria-expanded", open ? "true" : "false");
    button.innerHTML = open ? closeIcon : bubbleIcon;
    frame.setAttribute("aria-hidden", open ? "false" : "true");
    if (open) {
      frame.style.display = "block";
      // One frame of layout before the transition, or it starts from its end
      // state and nothing animates.
      requestAnimationFrame(function () {
        frame.style.opacity = "1";
        frame.style.transform = "translateY(0)";
      });
    } else {
      frame.style.opacity = "0";
      frame.style.transform = "translateY(12px)";
      setTimeout(function () {
        if (!open) frame.style.display = "none";
      }, 180);
    }
  }

  button.addEventListener("click", function () {
    setOpen(!open);
  });
  document.addEventListener("keydown", function (e) {
    if (e.key === "Escape" && open) setOpen(false);
  });

  function mount() {
    document.body.appendChild(frame);
    document.body.appendChild(button);
  }
  if (document.body) mount();
  else document.addEventListener("DOMContentLoaded", mount);

  window.NestChat = {
    mounted: true,
    open: function () {
      setOpen(true);
    },
    close: function () {
      setOpen(false);
    },
    toggle: function () {
      setOpen(!open);
    },
  };
})();
