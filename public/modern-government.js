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

    const revealSelector = "#v1, #v2, #lock, #tb, .portal-section-heading, .portal-admin-intro, #list > div:not(.msg)";
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


/* Premium 3D hero: presentation-only, keeping the existing registration and admin flows intact. */
(function () {
  "use strict";

  function addPremiumHero() {
    const main = document.querySelector("main");
    const formCard = document.getElementById("v1");
    if (!main || !formCard || document.getElementById("portal-hero-3d")) return;

    const mapSvg = '<svg class="portal-globe-map-piece" viewBox="0 0 400 400" role="presentation" aria-hidden="true" xmlns="http://www.w3.org/2000/svg"><g>' +
      '<path d="M49 94 70 79 91 83 103 72 127 83 143 101 131 115 116 119 107 137 91 145 82 163 63 155 58 136 45 123 40 106Z"/>' +
      '<path d="M122 177 144 171 158 187 163 209 153 235 147 265 135 289 124 267 117 238 112 216 115 194Z"/>' +
      '<path d="M187 104 203 91 218 98 224 110 241 112 244 125 229 133 220 146 211 161 199 151 194 135 180 124Z"/>' +
      '<path d="M201 158 220 151 236 165 242 190 235 216 224 241 209 255 198 231 193 207 184 187 189 170Z"/>' +
      '<path d="M232 99 256 79 283 83 303 96 331 101 347 119 333 134 311 130 301 148 281 151 269 137 247 139 237 121Z"/>' +
      '<path d="M303 161 323 156 340 169 335 187 320 195 310 184Z"/>' +
      '<path d="M62 66 81 54 101 60 108 70 94 82 76 80Z"/>' +
      '</g></svg>';

    const hero = document.createElement("section");
    hero.id = "portal-hero-3d";
    hero.className = "portal-hero-3d";
    hero.setAttribute("aria-labelledby", "portal-hero-title");
    hero.innerHTML =
      '<div class="portal-hero-copy">' +
        '<div class="portal-hero-eyebrow">NPCIH-A &nbsp;•&nbsp; DIGITAL COMMAND PORTAL</div>' +
        '<h2 class="portal-hero-title" id="portal-hero-title">INTELLIGENCE.<br><span>INNOVATION.</span><br><em>INTEGRITY.</em></h2>' +
        '<p class="portal-hero-description">A modern platform for membership registration, trusted information management, and professional institutional coordination.</p>' +
        '<div class="portal-hero-actions">' +
          '<a class="portal-hero-cta" href="#v1">Explore Platform <svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M5 12h13M13 6l6 6-6 6" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg></a>' +
          '<button class="portal-hero-cta secondary" type="button" data-portal-admin-access>Access Dashboard <svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><rect x="4" y="10" width="16" height="10" rx="2" stroke="currentColor" stroke-width="1.7"/><path d="M8 10V7a4 4 0 0 1 8 0v3" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/></svg></button>' +
        '</div>' +
        '<div class="portal-hero-proof">' +
          '<span><svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="m5 12 4 4L19 6" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>Validated submissions</span>' +
          '<span><svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M12 3 19 6v5c0 4.7-3.1 7.8-7 10-3.9-2.2-7-5.3-7-10V6l7-3Z" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/><path d="m9 12 2 2 4-4" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/></svg>Role-aware access</span>' +
        '</div>' +
      '</div>' +
      '<div class="portal-hero-visual" aria-hidden="true">' +
        '<div class="portal-globe-aura"></div>' +
        '<div class="portal-globe-orbit orbit-one"></div>' +
        '<div class="portal-globe-orbit orbit-two"></div>' +
        '<div class="portal-globe-orbit orbit-three"></div>' +
        '<div class="portal-globe">' +
          '<div class="portal-globe-map">' + mapSvg + mapSvg + '</div>' +
          '<svg class="portal-globe-graticule" viewBox="0 0 400 400" preserveAspectRatio="none"><ellipse cx="200" cy="200" rx="174" ry="174"/><ellipse cx="200" cy="200" rx="100" ry="174"/><ellipse cx="200" cy="200" rx="42" ry="174"/><ellipse cx="200" cy="200" rx="174" ry="75"/><ellipse cx="200" cy="200" rx="174" ry="125"/><path d="M26 200h348M200 26v348"/></svg>' +
          '<div class="portal-globe-shine"></div><div class="portal-globe-pin"></div>' +
        '</div>' +
        '<div class="portal-globe-label label-left"><span class="label-icon"><svg viewBox="0 0 24 24" fill="none"><path d="M4 7h16M7 4v6m10-6v6M5 12h14v8H5z" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/></svg></span><span>MEMBERSHIP RECORDS<small>Validated submission flow</small></span></div>' +
        '<div class="portal-globe-label label-right"><span class="label-icon gold"><svg viewBox="0 0 24 24" fill="none"><path d="M12 3 19 6v5c0 4.7-3.1 7.8-7 10-3.9-2.2-7-5.3-7-10V6l7-3Z" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/><path d="m9 12 2 2 4-4" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/></svg></span><span>ACCESS CONTROL<small>Role-based administration</small></span></div>' +
        '<div class="portal-globe-caption">PRECISION · TRUST · COORDINATION</div>' +
      '</div>';

    formCard.insertAdjacentElement("beforebegin", hero);

    const adminAccess = hero.querySelector("[data-portal-admin-access]");
    if (adminAccess) {
      adminAccess.addEventListener("click", function () {
        const adminToggle = document.querySelector(".fab");
        if (adminToggle) {
          adminToggle.click();
        } else {
          const adminPanel = document.getElementById("v2");
          if (adminPanel) adminPanel.scrollIntoView({ behavior: "smooth", block: "start" });
        }
      });
    }

    const reducedMotion = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const finePointer = window.matchMedia && window.matchMedia("(hover: hover) and (pointer: fine)").matches;
    const visual = hero.querySelector(".portal-hero-visual");
    if (visual && finePointer && !reducedMotion) {
      visual.addEventListener("pointermove", function (event) {
        if (event.pointerType !== "mouse") return;
        const rect = visual.getBoundingClientRect();
        if (!rect.width || !rect.height) return;
        const x = (event.clientX - rect.left) / rect.width - 0.5;
        const y = (event.clientY - rect.top) / rect.height - 0.5;
        visual.style.setProperty("--hero-tilt-x", (-y * 2.8).toFixed(2) + "deg");
        visual.style.setProperty("--hero-tilt-y", (x * 3.2).toFixed(2) + "deg");
      }, { passive: true });
      visual.addEventListener("pointerleave", function () {
        visual.style.setProperty("--hero-tilt-x", "0deg");
        visual.style.setProperty("--hero-tilt-y", "0deg");
      }, { passive: true });
    }

    document.documentElement.classList.add("portal-hero-ready");
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", addPremiumHero, { once: true });
  } else {
    addPremiumHero();
  }
})();


/* Keep the public landing hero out of the admin workspace; restore it on Back to Form. */
(function () {
  "use strict";
  function bindHeroView() {
    const hero = document.getElementById("portal-hero-3d");
    const adminToggle = document.getElementById("t2");
    const backButton = document.getElementById("back");
    const adminPanel = document.getElementById("v2");
    if (!hero || !adminToggle || !adminPanel) return;

    adminToggle.addEventListener("click", function () {
      hero.classList.toggle("portal-hero-hidden", !adminPanel.classList.contains("hide"));
    });
    if (backButton) {
      backButton.addEventListener("click", function () {
        hero.classList.remove("portal-hero-hidden");
      });
    }
  }
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", bindHeroView, { once: true });
  } else {
    bindHeroView();
  }
})();
