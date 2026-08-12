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
  var sectionOrder = [];
  var intersecting = {};
  var isProgrammaticScroll = false;
  var scrollLockTimer = null;
  var bottomCheckScheduled = false;

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
    sectionOrder = Array.prototype.map.call(els, function (el) { return el.id; });
    intersecting = {};
    if (!els.length) return;

    currentObserver = new IntersectionObserver(function (entries) {
      if (isProgrammaticScroll) return;

      entries.forEach(function (entry) {
        intersecting[entry.target.id] = entry.isIntersecting;
      });

      var active = null;
      for (var i = 0; i < sectionOrder.length; i++) {
        if (intersecting[sectionOrder[i]]) {
          active = sectionOrder[i];
          break;
        }
      }

      markCurrentSubsection(section, active);
    }, {
      root: contentArea,
      // Reading-line approach: a thin (~1%) band positioned ~20% down the
      // pane, rather than a wide zone. A section only becomes "active" once
      // it actually reaches this reading position, and it holds that state
      // until the next section's top crosses the same line — this is what
      // prevents a sliver of the next section triggering a premature switch.
      rootMargin: "-20% 0px -79% 0px",
      threshold: 0
    });

    els.forEach(function (el) { currentObserver.observe(el); });

    contentArea.removeEventListener("scroll", handleScrollBottomCheck);
    contentArea.addEventListener("scroll", handleScrollBottomCheck, { passive: true });
  }

  function handleScrollBottomCheck() {
    if (isProgrammaticScroll || bottomCheckScheduled) return;
    bottomCheckScheduled = true;
    window.requestAnimationFrame(function () {
      bottomCheckScheduled = false;
      var atBottom = contentArea.scrollTop + contentArea.clientHeight >= contentArea.scrollHeight - 2;
      if (!atBottom || !sectionOrder.length) return;
      var last = sectionOrder[sectionOrder.length - 1];
      markCurrentSubsection(currentSection, last);
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

  function scrollToTop(behavior) {
    isProgrammaticScroll = true;
    contentArea.scrollTo({ top: 0, behavior: behavior });
    window.clearTimeout(scrollLockTimer);
    scrollLockTimer = window.setTimeout(function () {
      isProgrammaticScroll = false;
    }, 600);
  }

  function navigateTo(section, subsection, opts) {
    opts = opts || {};
    var pushHistory = opts.pushHistory !== false;
    var scrollBehavior = opts.initial ? "auto" : "smooth";

    function finish() {
      setActiveSection(section);
      setActiveChild(section, subsection);
      if (pushHistory) {
        var path = buildPath(section, subsection);
        if (opts.replace) {
          history.replaceState({ section: section, subsection: subsection }, "", path);
        } else {
          history.pushState({ section: section, subsection: subsection }, "", path);
        }
      }
      currentSection = section;
      currentSubsection = subsection;

      if (subsection) {
        scrollToSubsection(subsection, scrollBehavior);
      } else {
        scrollToTop(scrollBehavior);
      }
    }

    if (section === currentSection && contentArea.dataset.loadedSection === section) {
      finish();
      return;
    }

    loadContent(section).then(function () {
      contentArea.dataset.loadedSection = section;
      setupSubsectionObserver(section);
      finish();
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