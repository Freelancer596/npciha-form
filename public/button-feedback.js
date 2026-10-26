/* NPCIH-A button interaction feedback. Existing handlers and API calls remain authoritative. */
(function () {
  "use strict";

  const config = {
    go:     { busy: "Submitting registration…", status: "msg" },
    unlock: { busy: "Checking credentials…", status: "pwm" },
    fgo:    { busy: "Searching members…", status: "fmsg" },
    fsum:   { busy: "Preparing summary…", status: "fmsg" },
    fexp:   { busy: "Exporting CSV…", status: "fmsg" },
    faud:   { busy: "Loading audit log…", status: "fmsg" },
    flo:    { busy: "Signing out…", status: "fmsg" },
    dl:     { busy: "Preparing PDF…", status: "msg" },
    wa:     { busy: "Opening WhatsApp…", status: "msg" }
  };

  const style = document.createElement("style");
  style.textContent = [
    ".npciha-spinner{display:inline-block;width:15px;height:15px;flex:0 0 15px;border:2px solid currentColor;border-right-color:transparent;border-radius:50%;vertical-align:-3px;animation:npciha-spin .7s linear infinite}",
    ".npciha-busy-label{display:inline-flex;align-items:center;justify-content:center;gap:9px}",
    "@keyframes npciha-spin{to{transform:rotate(360deg)}}",
    "@media(prefers-reduced-motion:reduce){.npciha-spinner{animation:none;border-right-color:currentColor}}"
  ].join("");
  document.head.appendChild(style);

  function announce(id, message) {
    const node = id && document.getElementById(id);
    if (!node) return;
    node.setAttribute("role", "status");
    node.setAttribute("aria-live", "polite");
    node.setAttribute("aria-atomic", "true");
    if (message) node.textContent = message;
  }

  function labelFor(button) {
    if (config[button.id]) return config[button.id].busy;
    const label = (button.textContent || "").trim();
    if (/load more/i.test(label)) return "Loading more members…";
    if (/^view$/i.test(label)) return "Loading details…";
    if (/^pdf$/i.test(label) || /download pdf/i.test(label)) return "Preparing PDF…";
    if (/^manage$/i.test(label)) return "Opening options…";
    if (/delete|reject|approve|set pending|save district|change selected field|update|save/i.test(label)) return "Saving changes…";
    if (/search/i.test(label)) return "Searching…";
    return "Please wait…";
  }

  function decorate(button) {
    const label = (button.textContent || "").trim();
    if (/delete record|\bdelete\b|\breject\b/i.test(label)) {
      button.classList.add("is-danger");
      button.dataset.npcihaKind = "danger";
    }
    if (/approve|saved|approved/i.test(label)) {
      button.dataset.npcihaKind = "success";
    }
  }

  function enhance(button) {
    if (!button || button.dataset.npcihaWrapped === "1") return;
    decorate(button);
    if (typeof button.onclick !== "function") return;

    const original = button.onclick;
    const originalHTML = button.innerHTML;
    button.dataset.npcihaWrapped = "1";

    button.onclick = async function (event) {
      if (button.dataset.npcihaRunning === "1" || button.disabled) {
        if (event && event.preventDefault) event.preventDefault();
        return false;
      }

      const statusId = (config[button.id] && config[button.id].status) ||
        (document.getElementById("fmsg") ? "fmsg" :
          (document.getElementById("msg") ? "msg" : ""));
      const wasDisabled = button.disabled;
      const busyText = labelFor(button);

      button.dataset.npcihaRunning = "1";
      button.disabled = true;
      button.setAttribute("aria-busy", "true");
      button.setAttribute("aria-disabled", "true");
      button.replaceChildren();

      const wrap = document.createElement("span");
      wrap.className = "npciha-busy-label";
      const spinner = document.createElement("span");
      spinner.className = "npciha-spinner";
      spinner.setAttribute("aria-hidden", "true");
      const text = document.createElement("span");
      text.textContent = busyText;
      wrap.append(spinner, text);
      button.append(wrap);

      if (statusId && button.id !== "go") announce(statusId, busyText);

      try {
        // Invoke synchronously in the click gesture to preserve downloads and popups.
        const result = original.call(this, event);
        if (result && typeof result.then === "function") await result;
      } catch (error) {
        console.error("[NPCIH-A] Button action failed:", button.id || label, error);
        if (statusId) {
          const node = document.getElementById(statusId);
          if (node && !node.textContent.trim()) announce(statusId, "Action failed. Please try again.");
        }
      } finally {
        button.innerHTML = originalHTML;
        button.disabled = wasDisabled;
        button.removeAttribute("aria-busy");
        button.removeAttribute("aria-disabled");
        delete button.dataset.npcihaRunning;
      }
    };
  }

  function scan(root) {
    if (!root) return;
    if (root.nodeType === 1 && root.matches && root.matches("button")) enhance(root);
    if (root.querySelectorAll) root.querySelectorAll("button").forEach(enhance);
  }

  function init() {
    scan(document);
    ["msg", "pwm", "fmsg"].forEach(id => announce(id));
    if ("MutationObserver" in window && document.body) {
      const observer = new MutationObserver(records => {
        records.forEach(record => record.addedNodes.forEach(node => {
          if (node.nodeType === 1) scan(node);
        }));
      });
      observer.observe(document.body, { childList: true, subtree: true });
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init, { once: true });
  } else {
    init();
  }
})();
