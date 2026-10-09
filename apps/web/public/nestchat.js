/*
 * The NestChat launcher — the one-line embed.
 *
 *   <script>window.NestChatSettings = { key: "nc_...", host: "https://your-app" };</script>
 *   <script src="https://your-app/nestchat.js" defer></script>
 *
 * A site with signed-in users adds `user: { id, hash, name, email }` (and,
 * optionally, `fields: { order_id: "…" }`) to the settings; the Install section
 * of Settings › NestChat widget shows the server side.
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

  /*
   * Who is signed in to the website, if anyone — `user: { id, hash, name,
   * email, phone }` in the settings, or NestChat.identify() later. `hash` is
   * HMAC-SHA256 of the id under the channel's signing secret, made by the
   * website's own server; without a valid one the chat stays anonymous.
   *
   * Handed to the chat by postMessage once it says it is listening, never in
   * the frame's URL: a URL is written into server logs and browser history,
   * and an email address does not belong in either.
   */
  var user = cleanUser(settings.user);
  var fields = cleanFields(settings.fields);
  var frameReady = false;

  function cleanUser(raw) {
    if (!raw || typeof raw !== "object" || raw.id == null || raw.id === "") return null;
    var out = { id: String(raw.id) };
    var keys = ["hash", "name", "email", "phone"];
    for (var i = 0; i < keys.length; i++) {
      if (raw[keys[i]] != null && raw[keys[i]] !== "") out[keys[i]] = String(raw[keys[i]]);
    }
    if (!out.hash) {
      warn(
        "user.hash is missing, so the chat will open as an anonymous visitor. Your server " +
          "signs the user id with the channel's signing secret (Settings › NestChat widget › Install).",
      );
    }
    return out;
  }

  function cleanFields(raw) {
    if (!raw || typeof raw !== "object") return null;
    var out = {};
    for (var k in raw) {
      if (Object.prototype.hasOwnProperty.call(raw, k) && raw[k] != null) out[k] = String(raw[k]);
    }
    return out;
  }

  function tellFrame() {
    if (!frameReady || !frame.contentWindow) return;
    frame.contentWindow.postMessage({ type: "nestchat:user", user: user, fields: fields }, origin);
  }

  /** Whether the chat fills the screen: it does whenever it's open on a phone,
   *  so the chat draws its own minimise button rather than relying on ours. */
  function tellLayout() {
    if (!frameReady || !frame.contentWindow) return;
    frame.contentWindow.postMessage(
      { type: "nestchat:layout", fullscreen: open && small(), keyboard: open && small() && keyboardUp() },
      origin,
    );
  }

  window.addEventListener("message", function (event) {
    // Only our own frame, from our own origin.
    if (event.origin !== origin || event.source !== frame.contentWindow) return;
    var type = event.data && event.data.type;
    if (type === "nestchat:ready") {
      frameReady = true;
      tellFrame();
      tellLayout();
    } else if (type === "nestchat:close") {
      // The minimise button inside the full-screen chat.
      setOpen(false);
    }
  });

  /*
   * A phone gets the chat full screen.
   *
   * A floating card is the right shape for a desktop, where it sits beside the
   * page. On a phone the same card is nearly the width of the screen but not
   * the height: the page shows and scrolls behind it, the keyboard shoves it
   * around, and our round button lands on top of the chat's own send button.
   * So below this width — or on a phone held sideways, which is short rather
   * than narrow — opening the chat takes the whole screen, the page behind it
   * is held still, and the chat shows its own minimise button.
   */
  var SMALL = "(max-width: 640px), (max-height: 500px) and (pointer: coarse)";
  function small() {
    return !!(window.matchMedia && window.matchMedia(SMALL).matches);
  }

  var CARD = [
    "top:auto",
    "left:auto",
    "right:auto",
    "bottom:88px",
    side + ":20px",
    "width:380px",
    "height:min(620px, calc(100vh - 120px))",
    "max-width:calc(100vw - 40px)",
    "max-height:none",
    "border-radius:16px",
    "box-shadow:0 12px 40px rgba(16,24,40,.22)",
  ];
  var FULL = [
    "top:0",
    "left:0",
    "right:0",
    "bottom:0",
    "width:100%",
    "height:100%",
    "max-width:none",
    "max-height:none",
    "border-radius:0",
    "box-shadow:none",
  ];

  /** Still fading out of full screen: it keeps that shape until it's gone,
   *  rather than snapping into a card on its way out. */
  var leaving = false;

  /** Put the frame in the shape this screen gets, keeping everything else. */
  function shape() {
    var rules = small() && (open || leaving) ? FULL : CARD;
    for (var i = 0; i < rules.length; i++) {
      var at = rules[i].indexOf(":");
      frame.style.setProperty(rules[i].slice(0, at), rules[i].slice(at + 1));
    }
    // Hidden while the chat covers the screen — the chat has its own minimise
    // button, and ours would sit on top of the composer.
    button.style.display = open && small() ? "none" : "flex";
  }

  /*
   * Hold the page still behind a full-screen chat, and put it back exactly
   * where it was afterwards. `overflow: hidden` alone is not enough on iOS,
   * which scrolls the page anyway; pinning the body at its scroll offset is
   * what stops it — and what has to be undone carefully, or the visitor is
   * dropped at the top of the page they were reading.
   */
  var locked = null;
  function lockPage(lock) {
    var body = document.body;
    var html = document.documentElement;
    if (!body) return;
    if (lock && !locked) {
      locked = {
        y: window.pageYOffset || html.scrollTop || 0,
        html: html.style.overflow,
        overflow: body.style.overflow,
        position: body.style.position,
        top: body.style.top,
        width: body.style.width,
      };
      html.style.overflow = "hidden";
      body.style.overflow = "hidden";
      body.style.position = "fixed";
      body.style.top = -locked.y + "px";
      body.style.width = "100%";
    } else if (!lock && locked) {
      var was = locked;
      locked = null;
      html.style.overflow = was.html;
      body.style.overflow = was.overflow;
      body.style.position = was.position;
      body.style.top = was.top;
      body.style.width = was.width;
      window.scrollTo(0, was.y);
    }
  }

  /*
   * Above the keyboard.
   *
   * The on-screen keyboard doesn't make the page shorter: it covers the bottom
   * of it, and iOS Safari then slides the whole screen up to show the box being
   * typed in, carrying the chat's header off the top. Following that slide
   * (moving the chat down by it) was the first attempt, and it fought Safari:
   * every move of the chat moved the box, Safari slid again to "reveal" it, and
   * the header and the composer took turns disappearing.
   *
   * So the slide is undone instead — scrolled back to the top — and the chat is
   * sized to what the keyboard leaves visible. The box is then already above
   * the keyboard, and Safari has no reason to slide again. A browser that won't
   * be scrolled back is followed (`offsetTop`) rather than fought. The chat is
   * told the keyboard is up, and folds its header to one line, as the Flutter
   * SDK does.
   */
  var viewport = window.visualViewport;
  function keyboardUp() {
    // Over a hundred and fifty pixels gone is a keyboard, not a URL bar.
    return !!viewport && window.innerHeight - viewport.height > 150;
  }
  var lastKeyboard = null;
  var fitQueued = false;
  var placed = { top: -1, height: -1 };
  /** Set once undoing the slide is seen not to work, so it isn't tried
   *  again — trying would be the same fight by another route. */
  var slideStays = false;
  var verifying = null;
  function fit() {
    fitQueued = false;
    if (!viewport || !(open && small())) return;
    var up = keyboardUp();
    var slid = viewport.offsetTop > 0 || window.pageYOffset > 0;
    var top;
    // Undo the slide — but only once the keyboard's size is known. Safari can
    // slide before it reports the keyboard; undoing it then, with the chat
    // still full height, would hide the box again and start the fight. The
    // page itself is pinned behind the chat (lockPage), so scrolling back
    // moves nothing the visitor can see but the slide.
    if (up && slid && !slideStays) {
      window.scrollTo(0, 0);
      top = 0;
      // Check it took. If the browser kept its slide, follow it from now on.
      clearTimeout(verifying);
      verifying = setTimeout(function () {
        if (viewport.offsetTop > 0 && keyboardUp()) slideStays = true;
        queueFit();
      }, 120);
    } else {
      top = Math.max(0, Math.round(viewport.offsetTop));
    }
    var height = Math.round(viewport.height);
    // Only when something changed: a write that changes nothing still moves
    // the box as far as Safari is concerned, and starts the fight again.
    if (top !== placed.top || height !== placed.height) {
      placed = { top: top, height: height };
      frame.style.top = top + "px";
      frame.style.height = height + "px";
      frame.style.bottom = "auto";
    }
    if (up !== lastKeyboard) {
      lastKeyboard = up;
      tellLayout();
    }
    if (!up) slideStays = false;
    debug();
  }

  /*
   * `?nestchat_debug=1` on the page's address: a small live readout of what
   * the browser reports about the screen and the keyboard. Phone keyboards
   * can't be raised in a test, so a screen recording with this on is how a
   * misbehaving phone gets diagnosed rather than guessed at. Off otherwise —
   * nothing is drawn and nothing is read.
   */
  var debugBox = null;
  function debug() {
    if (!/[?&]nestchat_debug=1\b/.test(window.location.search)) return;
    if (!debugBox) {
      debugBox = document.createElement("div");
      debugBox.style.cssText =
        "position:fixed;left:4px;top:4px;z-index:2147483647;padding:4px 6px;border-radius:6px;" +
        "background:rgba(0,0,0,.75);color:#0f0;font:11px/1.3 monospace;pointer-events:none;white-space:pre";
      document.body.appendChild(debugBox);
    }
    var r = frame.getBoundingClientRect();
    debugBox.textContent =
      "inner " + window.innerWidth + "x" + window.innerHeight + "  scrollY " + Math.round(window.pageYOffset) +
      "\nvv " + (viewport ? Math.round(viewport.width) + "x" + Math.round(viewport.height) + " @" + Math.round(viewport.offsetTop) : "none") +
      "\nframe " + Math.round(r.top) + "/" + Math.round(r.height) +
      "  kb " + (keyboardUp() ? "up" : "down") + (slideStays ? "  follow" : "");
  }

  function queueFit() {
    if (fitQueued) return;
    fitQueued = true;
    requestAnimationFrame(fit);
  }
  if (viewport) {
    viewport.addEventListener("resize", queueFit);
    viewport.addEventListener("scroll", queueFit);
    // Safari's slide can arrive as a scroll of the page rather than of the
    // viewport; either way it is undone.
    window.addEventListener("scroll", function () {
      if (open && small()) queueFit();
    });
  }

  /** Shape, page lock and the chat's minimise button, for the current screen. */
  function layout() {
    shape();
    lockPage(open && small());
    lastKeyboard = null;
    placed = { top: -1, height: -1 };
    fit();
    tellLayout();
  }
  if (window.matchMedia) {
    var query = window.matchMedia(SMALL);
    // Turning a phone, or a desktop window dragged narrow, while it's open.
    if (query.addEventListener) query.addEventListener("change", layout);
    else if (query.addListener) query.addListener(layout);
  }

  var frame = document.createElement("iframe");
  // Stable ids on both elements. A customer's own stylesheet is written against
  // their page, not ours, and a bare `button {}` rule is common enough that the
  // launcher needs something to be addressed by — for them to override, and for
  // us to point at when someone asks why it's sitting behind their footer.
  frame.id = "nestchat-frame";
  // `hs=1`: this page will say who is signed in, so the chat waits to hear
  // before opening a session rather than opening one as a stranger first.
  frame.src = origin + "/widget.html?key=" + encodeURIComponent(key) + "&hs=1";
  frame.title = label;
  frame.setAttribute("aria-hidden", "true");
  // The iframe is same-origin with our API but cross-origin to the host page,
  // so the host page cannot read the conversation and we cannot read the host.
  // A cross-origin frame gets no microphone unless the page delegates it — and
  // without it voice messages fail before the browser has even asked. The
  // visitor is still asked, by the browser, the first time they hold the mic.
  frame.allow = "microphone; clipboard-write";
  frame.style.cssText = [
    "position:fixed",
    "border:0",
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
    leaving = open && !next && small();
    open = next;
    button.setAttribute("aria-expanded", open ? "true" : "false");
    button.innerHTML = open ? closeIcon : bubbleIcon;
    frame.setAttribute("aria-hidden", open ? "false" : "true");
    layout();
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
        if (open) return;
        frame.style.display = "none";
        leaving = false;
        shape();
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
    shape();
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
    /** Somebody signed in after the page loaded — a single-page app. Same
     *  shape as `NestChatSettings.user`, and the same signature rule. */
    identify: function (next, nextFields) {
      user = cleanUser(next);
      if (nextFields !== undefined) fields = cleanFields(nextFields);
      tellFrame();
    },
    /** Signed out: the chat forgets them, so the next person on this browser
     *  starts as a stranger rather than inside somebody else's conversation. */
    logout: function () {
      user = null;
      fields = null;
      tellFrame();
    },
  };
})();
