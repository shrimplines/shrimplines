document.addEventListener("DOMContentLoaded", function () {
  var sections = document.querySelectorAll(".nav-section");
  var topButtons = document.querySelectorAll(".nav-label");
  var childButtons = document.querySelectorAll(".nav-child");
  var contentArea = document.getElementById("content-area");
  var baseurl = document.body.dataset.baseurl || "";
  var defaultSection = "about";

  var validSections = Array.prototype.map.call(sections, function (s) {
    return s.dataset.section;
  });

  var currentSection = null;
  var currentSubsection = null;
  var currentObserver = null;
  var isProgrammaticScroll = false;
  var scrollLockTimer = null;
  var bottomCheckScheduled = false;

  function firstChildOf(section) {
    var el = document.querySelector('.nav-section[data-section="' + section + '"]');
    return (el && el.dataset.firstChild) || null;
  }

  function buildPath(section, subsection) {
    return baseurl + "/" + section + (subsection ? "/" + subsection : "");
  }

  function parsePath() {
    var path = window.location.pathname;
    if (baseurl && path.indexOf(baseurl) === 0) {
      path = path.slice(baseurl.length);
    }
    path = path.replace(/^\/|\/$/g, "");
    if (!path) {
      return { section: defaultSection, subsection: null };
    }
    var parts = path.split("/");
    if (validSections.indexOf(parts[0]) === -1) {
      return { section: defaultSection, subsection: null };
    }
    return { section: parts[0], subsection: parts[1] || null };
  }

  function setActiveSection(section) {
    sections.forEach(function (s) {
      s.classList.toggle("active", s.dataset.section === section);
    });
  }

  function setActiveChild(section, sub) {
    childButtons.forEach(function (btn) {
      btn.classList.toggle("active", !!sub && btn.dataset.target === section + "/" + sub);
    });
  }

  function markCurrentSubsection(section, sub) {
    if (sub === currentSubsection) return;
    currentSubsection = sub;
    setActiveChild(section, sub);
    history.replaceState({ section: section, subsection: sub }, "", buildPath(section, sub));
  }

  function loadContent(section) {
    return fetch(baseurl + "/content/" + section + ".html")
      .then(function (res) {
        if (!res.ok) throw new Error("Failed to load " + section);
        return res.text();
      })
      .then(function (html) {
        contentArea.innerHTML = html;
      })
      .catch(function (err) {
        contentArea.innerHTML = "<p>Could not load content.</p>";
        console.error(err);
      });
  }

  function setupSubsectionObserver(section) {
    if (currentObserver) currentObserver.disconnect();
    var els = contentArea.querySelectorAll(".content-section");
    if (!els.length) return;

    currentObserver = new IntersectionObserver(function (entries) {
      if (isProgrammaticScroll) return;
      entries.forEach(function (entry) {
        if (!entry.isIntersecting) return;
        markCurrentSubsection(section, entry.target.id);
      });
    }, {
      root: contentArea,
      // Detection band: top 10%-45% of the content pane. Widened from the
      // previous -70% bottom margin, which left too little scrollable
      // distance for short/last sections (e.g. inspiration) to ever enter
      // the band before hitting the scroll ceiling.
      rootMargin: "-10% 0px -55% 0px",
      threshold: 0
    });

    els.forEach(function (el) { currentObserver.observe(el); });

    // Safeguard for the structural edge case IntersectionObserver can't
    // resolve on its own: once scrolled to the bottom of the pane, force
    // the last section active even if it never crossed the band above.
    contentArea.removeEventListener("scroll", handleScrollBottomCheck);
    contentArea.addEventListener("scroll", handleScrollBottomCheck, { passive: true });
  }

  function handleScrollBottomCheck() {
    if (isProgrammaticScroll || bottomCheckScheduled) return;
    bottomCheckScheduled = true;
    window.requestAnimationFrame(function () {
      bottomCheckScheduled = false;
      var atBottom = contentArea.scrollTop + contentArea.clientHeight >= contentArea.scrollHeight - 2;
      if (!atBottom) return;
      var els = contentArea.querySelectorAll(".content-section");
      if (!els.length) return;
      var last = els[els.length - 1];
      markCurrentSubsection(currentSection, last.id);
    });
  }

  function scrollToSubsection(id, behavior) {
    var el = document.getElementById(id);
    if (!el) return;
    isProgrammaticScroll = true;
    el.scrollIntoView({ behavior: behavior, block: "start" });
    window.clearTimeout(scrollLockTimer);
    scrollLockTimer = window.setTimeout(function () {
      isProgrammaticScroll = false;
    }, 600);
  }

  function navigateTo(section, subsection, opts) {
    opts = opts || {};
    var pushHistory = opts.pushHistory !== false;
    var scrollBehavior = opts.initial ? "auto" : "smooth";

    function finish(sub) {
      setActiveSection(section);
      setActiveChild(section, sub);
      if (pushHistory) {
        var path = buildPath(section, sub);
        if (opts.replace) {
          history.replaceState({ section: section, subsection: sub }, "", path);
        } else {
          history.pushState({ section: section, subsection: sub }, "", path);
        }
      }
      currentSection = section;
      currentSubsection = sub;
      if (sub) scrollToSubsection(sub, scrollBehavior);
    }

    if (section === currentSection && contentArea.dataset.loadedSection === section) {
      finish(subsection || firstChildOf(section));
      return;
    }

    loadContent(section).then(function () {
      contentArea.dataset.loadedSection = section;
      setupSubsectionObserver(section);
      finish(subsection || firstChildOf(section));
    });
  }

  topButtons.forEach(function (btn) {
    btn.addEventListener("click", function () {
      navigateTo(btn.dataset.target, null, { pushHistory: true });
    });
  });

  childButtons.forEach(function (btn) {
    btn.addEventListener("click", function () {
      var parts = btn.dataset.target.split("/");
      navigateTo(parts[0], parts[1], { pushHistory: true });
    });
  });

  window.addEventListener("popstate", function () {
    var parsed = parsePath();
    navigateTo(parsed.section, parsed.subsection, { pushHistory: false });
  });

  var initial = parsePath();
  navigateTo(initial.section, initial.subsection, {
    pushHistory: true,
    replace: true,
    initial: true
  });
});