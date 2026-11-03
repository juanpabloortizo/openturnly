// Shows an OpenTurnly booking page inside another website. Where it should appear:
//
//   <div data-openturnly="your-business"></div>
//   <script src="https://your-openturnly-address/embed.js" async></script>
//
// Or a floating button that opens it over the page:
//
//   <div data-openturnly="your-business" data-mode="button" data-label="Book" data-color="#0f766e"></div>
//
// Settings → Booking page → "Add to your website" writes this code for each business.
(() => {
  const script = document.currentScript;
  if (window.OpenTurnly || !script) {
    window.OpenTurnly?.mount();
    return;
  }
  const origin = new URL(script.src).origin;
  const spanish = (document.documentElement.lang || navigator.language || "").startsWith("es");
  const frames = new Set();
  /** How to close each popup, by the frame inside it. */
  const closers = new Map();

  const frameFor = (slug, fill) => {
    const frame = document.createElement("iframe");
    frame.src = `${origin}/${encodeURIComponent(slug)}?embed=${fill ? "popup" : "1"}`;
    frame.title = spanish ? "Reservar una cita" : "Book an appointment";
    frame.style.cssText = `display:block;width:100%;border:0;background:transparent;height:${fill ? "100%" : "640px"}`;
    if (fill) frame.dataset.fill = "1";
    else frame.loading = "lazy";
    frames.add(frame);
    return frame;
  };

  // The page inside reports its height (so there is no inner scrollbar), each new step (so
  // the visitor sees its top, not the middle of the previous step) and Escape (in a popup).
  window.addEventListener("message", (event) => {
    const data = event.data;
    if (event.origin !== origin || !data || typeof data !== "object") return;
    for (const frame of frames) {
      if (frame.contentWindow !== event.source) continue;
      if (frame.dataset.fill) {
        if (data.type === "openturnly:close") closers.get(frame)?.();
        continue;
      }
      if (data.type === "openturnly:height" && data.height > 0) {
        frame.style.height = `${Math.ceil(data.height)}px`;
      }
      if (data.type === "openturnly:step" && frame.getBoundingClientRect().top < 0) {
        frame.scrollIntoView({ behavior: "smooth", block: "start" });
      }
    }
  });

  /** White or near-black text, whichever reads better on the button's colour. */
  const textOn = (hex) => {
    const [r, g, b] = [1, 3, 5].map((at) => Number.parseInt(hex.slice(at, at + 2), 16));
    return 0.299 * r + 0.587 * g + 0.114 * b > 170 ? "#18181b" : "#ffffff";
  };

  const floatingButton = (element, slug) => {
    const color = /^#[0-9a-f]{6}$/i.test(element.dataset.color ?? "")
      ? element.dataset.color
      : "#0f766e";
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = element.dataset.label || (spanish ? "Reservar" : "Book now");
    button.style.cssText = `position:fixed;right:20px;bottom:20px;z-index:2147483645;padding:13px 22px;border:0;border-radius:999px;background:${color};color:${textOn(color)};font:600 15px/1.2 system-ui,-apple-system,"Segoe UI",sans-serif;box-shadow:0 8px 24px rgba(0,0,0,.22);cursor:pointer`;

    let overlay = null;
    let overflow = "";
    const close = () => {
      overlay?.remove();
      document.body.style.overflow = overflow;
      document.removeEventListener("keydown", onKey);
      button.focus();
    };
    const onKey = (event) => {
      if (event.key === "Escape") close();
    };
    const open = () => {
      if (!overlay) {
        const phone = window.matchMedia("(max-width: 640px)").matches;
        overlay = document.createElement("div");
        overlay.setAttribute("role", "dialog");
        overlay.setAttribute("aria-modal", "true");
        overlay.style.cssText = `position:fixed;inset:0;z-index:2147483646;display:flex;align-items:center;justify-content:center;padding:${phone ? "0" : "24px"};background:rgba(15,15,25,.55)`;
        const panel = document.createElement("div");
        panel.style.cssText = `position:relative;width:100%;max-width:780px;height:100%;max-height:${phone ? "none" : "880px"};border-radius:${phone ? "0" : "20px"};overflow:hidden;background:#fff;box-shadow:0 24px 80px rgba(0,0,0,.35)`;
        const dismiss = document.createElement("button");
        dismiss.type = "button";
        dismiss.textContent = "×";
        dismiss.setAttribute("aria-label", spanish ? "Cerrar" : "Close");
        dismiss.style.cssText =
          "position:absolute;top:10px;right:10px;z-index:1;width:36px;height:36px;border:0;border-radius:999px;background:rgba(255,255,255,.92);color:#18181b;font:26px/36px system-ui,sans-serif;cursor:pointer;box-shadow:0 1px 4px rgba(0,0,0,.2)";
        dismiss.addEventListener("click", close);
        overlay.addEventListener("click", (event) => {
          if (event.target === overlay) close();
        });
        const frame = frameFor(slug, true);
        closers.set(frame, close);
        panel.append(frame, dismiss);
        overlay.append(panel);
      }
      overflow = document.body.style.overflow;
      document.body.style.overflow = "hidden";
      document.body.append(overlay);
      document.addEventListener("keydown", onKey);
    };
    button.addEventListener("click", open);
    document.body.append(button);
  };

  /** Turns every `data-openturnly` element on the page into a booking page or a button. */
  const mount = () => {
    for (const element of document.querySelectorAll("[data-openturnly]")) {
      const slug = element.dataset.openturnly;
      if (!slug || element.dataset.openturnlyReady) continue;
      element.dataset.openturnlyReady = "1";
      if (element.dataset.mode === "button") floatingButton(element, slug);
      else element.append(frameFor(slug, false));
    }
  };

  window.OpenTurnly = { mount };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", mount);
  else mount();
})();
