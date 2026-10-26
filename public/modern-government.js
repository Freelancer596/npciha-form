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