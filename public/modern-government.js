/* Lightweight DOM enhancements for the Modern Government Portal.
   Existing IDs, event handlers, API calls and PDF drawing logic remain untouched. */
(function () {
  "use strict";
  function enhancePortal() {
    const form = document.getElementById("f");
    const admin = document.getElementById("v2");
    if (!form || !admin || document.getElementById("portal-admin-intro")) return;

    function heading(id, eyebrow, title, description) {
      const control = document.getElementById(id);
      if (!control) return;
      let anchor = control.closest(".row") || control;
      if (control.id === "name" || control.id === "res" || control.id === "photo") {
        anchor = control.previousElementSibling || control;
      }
      const section = document.createElement("section");
      section.className = "portal-section-heading";
      section.innerHTML = '<div class="portal-section-number">' + eyebrow + '</div><div><h2>' + title + '</h2><p>' + description + '</p></div>';
      anchor.parentNode.insertBefore(section, anchor);
    }

    heading("name", "01", "Personal details", "Tell us about yourself. Urdu labels are provided alongside English.");
    heading("designation", "02", "Organisation details", "Select your wing and provide your designation and location.");
    heading("res", "03", "Address & contact", "Enter a reachable mobile number and your current contact details.");
    heading("photo", "04", "Passport-size photograph", "Choose a clear photo. Your application PDF is prepared after the record is saved.");

    const back = document.getElementById("back");
    if (back) {
      const intro = document.createElement("section");
      intro.id = "portal-admin-intro";
      intro.className = "portal-admin-intro";
      intro.innerHTML = '<div class="portal-admin-mark" aria-hidden="true">A</div><div class="portal-admin-copy"><div class="portal-eyebrow">SECURE ADMINISTRATION</div><h2>Membership Control Center</h2><p>Review applications, manage member records and access authorised reports.</p></div><div class="portal-admin-status"><span></span> Restricted access</div>';
      back.insertAdjacentElement("afterend", intro);
    }

    const adminLabel = document.querySelector("#adm > b");
    if (adminLabel) {
      adminLabel.setAttribute("aria-label", "Registered members directory");
    }

    const search = document.getElementById("fq");
    if (search) {
      search.setAttribute("aria-label", "Search members by name, reference number or CNIC");
    }

    const photo = document.getElementById("photo");
    if (photo) photo.setAttribute("aria-label", "Upload passport-size photograph");

    document.documentElement.classList.add("modern-government-portal");
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", enhancePortal, { once: true });
  } else {
    enhancePortal();
  }
})();

/* Advanced motion system. Additive only: no existing IDs, submit handlers, APIs or PDF flow are changed. */
(function () {
  "use strict";
  const reduceMotion = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const finePointer = window.matchMedia && window.matchMedia("(hover: hover) and (pointer: fine)").matches;

  function bootMotion() {
    if (document.documentElement.dataset.portalMotionBooted === "true") return;
    document.documentElement.dataset.portalMotionBooted = "true";

    const progress = document.createElement("div");
    progress.className = "portal-scroll-progress";
    progress.setAttribute("aria-hidden", "true");
    document.body.appendChild(progress);

    ["one", "two"].forEach(function (variant) {
      const orb = document.createElement("div");
      orb.className = "portal-motion-orb " + variant;
      orb.setAttribute("aria-hidden", "true");
      document.body.appendChild(orb);
    });

    function updateProgress() {
      const root = document.documentElement;
      const max = Math.max(1, root.scrollHeight - window.innerHeight);
      const ratio = Math.min(1, Math.max(0, window.scrollY / max));
      progress.style.transform = "scaleX(" + ratio + ")";
    }
    let scrollQueued = false;
    window.addEventListener("scroll", function () {
      if (scrollQueued) return;
      scrollQueued = true;
      window.requestAnimationFrame(function () {
        updateProgress();
        scrollQueued = false;
      });
    }, { passive: true });
    window.addEventListener("resize", updateProgress, { passive: true });
    updateProgress();

    const revealSelector = "#v1, #v2, #lock, #tb, .portal-section-heading, .portal-admin-intro";
    function revealElements(root) {
      const nodes = [];
      if (root && root.matches && root.matches(revealSelector)) nodes.push(root);
      if (root && root.querySelectorAll) nodes.push.apply(nodes, root.querySelectorAll(revealSelector));
      nodes.forEach(function (node, index) {
        if (node.hasAttribute("data-motion-reveal")) return;
        node.setAttribute("data-motion-reveal", "");
        node.style.setProperty("--motion-delay", Math.min(index * 55, 220) + "ms");
        if (!reduceMotion && observer) observer.observe(node);
        else node.classList.add("motion-visible");
      });
    }

    let observer = null;
    if (!reduceMotion && "IntersectionObserver" in window) {
      observer = new IntersectionObserver(function (entries) {
        entries.forEach(function (entry) {
          if (!entry.isIntersecting) return;
          entry.target.classList.add("motion-visible");
          observer.unobserve(entry.target);
        });
      }, { threshold: 0.08, rootMargin: "0px 0px -28px 0px" });
    }

    if (!reduceMotion) document.documentElement.classList.add("portal-motion-ready");
    revealElements(document);
    if (observer) {
      const dynamicRoot = document.getElementById("list");
      if (dynamicRoot) {
        new MutationObserver(function (mutations) {
          mutations.forEach(function (mutation) {
            mutation.addedNodes.forEach(function (node) {
              if (node.nodeType === 1) revealElements(node);
            });
          });
        }).observe(dynamicRoot, { childList: true, subtree: true });
      }
    }

    /* Gentle 3D tilt on hover-capable devices only; no pointer capture or input interference. */
    function addTilt(node, strength) {
      if (!node || node.dataset.motionTiltBound === "true") return;
      node.dataset.motionTiltBound = "true";
      node.addEventListener("pointermove", function (event) {
        if (reduceMotion || event.pointerType !== "mouse") return;
        const rect = node.getBoundingClientRect();
        if (!rect.width || !rect.height) return;
        const x = (event.clientX - rect.left) / rect.width - 0.5;
        const y = (event.clientY - rect.top) / rect.height - 0.5;
        node.style.setProperty("--motion-tilt-x", (-y * strength).toFixed(2) + "deg");
        node.style.setProperty("--motion-tilt-y", (x * strength).toFixed(2) + "deg");
      }, { passive: true });
      node.addEventListener("pointerleave", function () {
        node.style.setProperty("--motion-tilt-x", "0deg");
        node.style.setProperty("--motion-tilt-y", "0deg");
      }, { passive: true });
    }

    if (finePointer && !reduceMotion) {
      document.querySelectorAll(".portal-admin-intro").forEach(function (node) { addTilt(node, 3.2); });
      const list = document.getElementById("list");
      if (list) {
        list.querySelectorAll(":scope > div:not(.msg)").forEach(function (node) { addTilt(node, 2.1); });
        new MutationObserver(function (mutations) {
          mutations.forEach(function (mutation) {
            mutation.addedNodes.forEach(function (node) {
              if (node.nodeType !== 1) return;
              if (node.matches && node.matches(":scope")) {
                if (node.parentElement === list && !node.classList.contains("msg")) addTilt(node, 2.1);
              }
              if (node.querySelectorAll) node.querySelectorAll(":scope > div:not(.msg)").forEach(function (card) { addTilt(card, 2.1); });
            });
          });
        }).observe(list, { childList: true });
      }
    }

    /* Give newly rendered success/error messages a restrained entrance, without changing their text. */
    const message = document.getElementById("msg");
    if (message && !reduceMotion && "MutationObserver" in window) {
      new MutationObserver(function () {
        if (!message.textContent.trim()) return;
        message.classList.remove("portal-message-enter");
        void message.offsetWidth;
        message.classList.add("portal-message-enter");
      }).observe(message, { childList: true, characterData: true, subtree: true });
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", bootMotion, { once: true });
  } else {
    bootMotion();
  }
})();
