/* NPCIH-A responsive action feedback. Wraps existing handlers without replacing API/PDF logic. */
(function () {
  "use strict";

  const labels = {
    go: { busy: "Processing registration…", status: "msg" },
    unlock: { busy: "Checking credentials…", status: "pwm" },
    fgo: { busy: "Searching members…", status: "fmsg" },
    fsum: { busy: "Preparing summary…", status: "fmsg" },
    fexp: { busy: "Preparing CSV…", status: "fmsg" },
    faud: { busy: "Loading audit log…", status: "fmsg" },
    flo: { busy: "Signing out…", status: "fmsg" },
    dl: { busy: "Preparing PDF…", status: "msg" },
    wa: { busy: "Opening WhatsApp…", status: "msg" }
  };

  const spinner = '<span class="npciha-action-spinner" aria-hidden="true"></span>';
  const style = document.createElement("style");
  style.textContent = [
    ".npciha-action-spinner{display:inline-block;width:15px;height:15px;border:2px solid currentColor;border-right-color:transparent;border-radius:50%;vertical-align:-3px;margin-right:9px;animation:npcihaActionSpin .7s linear infinite}",
    "@keyframes npcihaActionSpin{to{transform:rotate(360deg)}}",
    "button[aria-busy=true]{cursor:wait!important;opacity:.88}",
    "button:disabled{cursor:wait}",
    "@media(prefers-reduced-motion:reduce){.npciha-action-spinner{animation:none;border-right-color:currentColor}}"
  ].join("");
  document.head.appendChild(style);

  function live(id, message) {
    const node = id && document.getElementById(id);
    if (!node) return;
    node.setAttribute("role", "status");
    node.setAttribute("aria-live", "polite");
    node.setAttribute("aria-atomic", "true");
    if (message) node.textContent = message;
  }

  function busyLabel(button) {
    if (labels[button.id]) return labels[button.id].busy;
    const label = (button.textContent || "").trim();
    if (/load more/i.test(label)) return "Loading more…";
    if (/^view$/i.test(label)) return "Loading record…";
    if (/^pdf$/i.test(label)) return "Preparing PDF…";
    if (/^manage$/i.test(label)) return "Opening controls…";
    if (/approve|reject|pending|save district|change selected field|delete record/i.test(label)) return "Saving changes…";
    return "Please wait…";
  }

  function enhance(button) {
    if (!button || button.dataset.npcihaBusyWrapped === "true") return;
    if (!button.matches(".btn, #unlock, #fgo, #fsum, #fexp, #faud, #flo, #go, #dl, #wa, .more")) return;
    if (typeof button.onclick !== "function") return;

    const original = button.onclick;
    const originalHTML = button.innerHTML;
    button.dataset.npcihaBusyWrapped = "true";
    button.onclick = async function (event) {
      if (button.dataset.npcihaActionRunning === "true" || button.disabled) {
        if (event && event.preventDefault) event.preventDefault();
        return;
      }

      const config = labels[button.id] || {};
      const statusId = config.status || (document.getElementById("fmsg") ? "fmsg" : "");
      const wasDisabled = button.disabled;
      button.dataset.npcihaActionRunning = "true";
      button.disabled = true;
      button.setAttribute("aria-busy", "true");
      button.setAttribute("aria-disabled", "true");
      button.innerHTML = spinner + busyLabel(button);

      if (statusId && button.id !== "go") live(statusId, busyLabel(button));

      try {
        // Call immediately within the click gesture so WhatsApp popup/share behavior remains valid.
        const result = original.call(this, event);
        if (statusId && button.id !== "go") {
          const node = document.getElementById(statusId);
          if (node && !node.textContent.trim()) live(statusId, busyLabel(button));
        }
        if (result && typeof result.then === "function") await result;
      } catch (error) {
        console.error("[NPCIH-A] Action failed:", button.id || button.textContent.trim(), error);
        if (statusId) live(statusId, "The action could not be completed. Please try again.");
      } finally {
        button.innerHTML = originalHTML;
        button.disabled = wasDisabled;
        button.removeAttribute("aria-busy");
        button.removeAttribute("aria-disabled");
        delete button.dataset.npcihaActionRunning;
      }
    };
  }

  function scan(root) {
    if (!root) return;
    if (root.nodeType === 1) enhance(root);
    if (root.querySelectorAll) root.querySelectorAll("button").forEach(enhance);
  }

  function boot() {
    scan(document);
    if ("MutationObserver" in window) {
      const observer = new MutationObserver(records => {
        records.forEach(record => record.addedNodes.forEach(node => {
          if (node.nodeType === 1) scan(node);
        }));
      });
      observer.observe(document.body, { childList: true, subtree: true });
    }
    ["msg", "pwm", "fmsg", "ps"].forEach(id => {
      const node = document.getElementById(id);
      if (node) {
        node.setAttribute("role", "status");
        node.setAttribute("aria-live", "polite");
        node.setAttribute("aria-atomic", "true");
      }
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot, { once: true });
  } else {
    boot();
  }
})();
