(function () {
  "use strict";

  /* ---------- count-up stats ---------- */
  var reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  var values = Array.prototype.slice.call(document.querySelectorAll(".stat-value"));

  function format(n, decimals, suffix) {
    return n.toFixed(decimals) + suffix;
  }

  function countUp(el, index) {
    var target = parseFloat(el.dataset.target);
    var decimals = parseInt(el.dataset.decimals, 10) || 0;
    var suffix = el.dataset.suffix || "";
    var duration = 1500 + index * 80;
    var start = null;

    function frame(ts) {
      if (start === null) start = ts;
      var p = Math.min((ts - start) / duration, 1);
      var eased = 1 - Math.pow(1 - p, 3);
      el.textContent = format(target * eased, decimals, suffix);
      if (p < 1) requestAnimationFrame(frame);
    }

    setTimeout(function () {
      requestAnimationFrame(frame);
    }, 480 + index * 90);
  }

  if (reduced) {
    values.forEach(function (el) {
      el.textContent = format(
        parseFloat(el.dataset.target),
        parseInt(el.dataset.decimals, 10) || 0,
        el.dataset.suffix || ""
      );
    });
  } else {
    var observer = new IntersectionObserver(
      function (entries) {
        entries.forEach(function (entry) {
          if (!entry.isIntersecting) return;
          countUp(entry.target, values.indexOf(entry.target));
          observer.unobserve(entry.target);
        });
      },
      { threshold: 0.25 }
    );
    values.forEach(function (el) {
      observer.observe(el);
    });
  }

  /* ---------- background video ---------- */
  // Some browsers park an autoplaying video when it is attached while the tab
  // is backgrounded, or after the buffer stalls. Nudge it back into playback.
  var video = document.querySelector(".bg-video");
  if (video && !reduced) {
    var kick = function () {
      var p = video.play();
      if (p && p.catch) p.catch(function () {});
    };
    video.addEventListener("canplay", kick);
    video.addEventListener("stalled", kick);
    document.addEventListener("visibilitychange", function () {
      if (!document.hidden) kick();
    });
    kick();
  }

  /* ---------- mobile menu ---------- */
  var burger = document.querySelector(".burger");
  var menu = document.getElementById("mobile-menu");
  var overlay = document.querySelector(".menu-overlay");

  function setMenu(open) {
    burger.setAttribute("aria-expanded", String(open));
    menu.hidden = !open;
    overlay.hidden = !open;
    document.body.classList.toggle("menu-open", open);
  }

  burger.addEventListener("click", function () {
    setMenu(burger.getAttribute("aria-expanded") !== "true");
  });

  overlay.addEventListener("click", function () {
    setMenu(false);
  });

  menu.addEventListener("click", function (e) {
    if (e.target.closest("a")) setMenu(false);
  });

  document.addEventListener("keydown", function (e) {
    if (e.key === "Escape") setMenu(false);
  });

  window.addEventListener("resize", function () {
    if (window.innerWidth > 720) setMenu(false);
  });
})();
