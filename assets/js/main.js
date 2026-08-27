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
  var sectionOrder = [];
  var isProgrammaticScroll = false;
  var scrollLockTimer = null;
  var scrollComputeScheduled = false;

  function firstChildOf(section) {
    var el = document.querySelector('.nav-section[data-section="' + section + '"]');
    return (el && el.dataset.firstChild) || null;
  }

  // A child segment appears in the URL only when the active child is NOT
  // the section's first child. This lets "just opened" and "explicitly on
  // the first child" both resolve to the plain parent URL, per the
  // first-child URL allowance in the brief.
  function buildPath(section, subsection) {
    var first = firstChildOf(section);
    var sub = (subsection && subsection !== first) ? subsection : null;
    return baseurl + "/" + section + (sub ? "/" + sub : "");
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

  function loadContent(section) {
    return fetch(baseurl + "/content/" + section + ".html")
      .then(function (res) {
        if (!res.ok) throw new Error("Failed to load " + section);
        return res.text();
      })
      .then(function (html) {
        contentArea.innerHTML = html;
        document.dispatchEvent(new CustomEvent("shrimplines:content-loaded", { detail: { section: section } }));
      })
      .catch(function (err) {
        contentArea.innerHTML = "<p>Could not load content.</p>";
        console.error(err);
      });
  }

  // Reading-position calculation: finds the section whose top has passed a
  // fixed line 20% down the content pane. This replaces the previous
  // IntersectionObserver/rootMargin approach, which required continual
  // threshold tuning and still switched sections too early.
  function computeActiveSubsection() {
    if (!sectionOrder.length) return null;
    var containerRect = contentArea.getBoundingClientRect();
    var lineY = containerRect.top + containerRect.height * 0.2;
    var active = sectionOrder[0];

    for (var i = 0; i < sectionOrder.length; i++) {
      var el = document.getElementById(sectionOrder[i]);
      if (!el) continue;
      var rect = el.getBoundingClientRect();
      if (rect.top <= lineY) {
        active = sectionOrder[i];
      } else {
        break;
      }
    }
    return active;
  }

  function updateSubsectionFromScroll(sub) {
    if (!sub || sub === currentSubsection) return;
    currentSubsection = sub;
    setActiveChild(currentSection, sub);
    history.replaceState({ section: currentSection, subsection: sub }, "", buildPath(currentSection, sub));
  }

  function handleScroll() {
    if (isProgrammaticScroll || scrollComputeScheduled) return;
    scrollComputeScheduled = true;
    window.requestAnimationFrame(function () {
      scrollComputeScheduled = false;
      if (!sectionOrder.length) return;

      var atBottom = contentArea.scrollTop + contentArea.clientHeight >= contentArea.scrollHeight - 2;
      var sub = atBottom ? sectionOrder[sectionOrder.length - 1] : computeActiveSubsection();
      updateSubsectionFromScroll(sub);
    });
  }

  function setupScrollTracking(section) {
    var els = contentArea.querySelectorAll(".content-section");
    sectionOrder = Array.prototype.map.call(els, function (el) { return el.id; });

    contentArea.removeEventListener("scroll", handleScroll);
    if (sectionOrder.length) {
      contentArea.addEventListener("scroll", handleScroll, { passive: true });
    }
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

  // subsection is non-null only for an explicit child click, or a URL that
  // names a child directly. Opening a parent (subsection === null) always
  // defaults the highlighted child to the section's first child.
  function navigateTo(section, subsection, opts) {
    opts = opts || {};
    var pushHistory = opts.pushHistory !== false;
    var scrollBehavior = opts.initial ? "auto" : "smooth";
    var explicitChild = !!subsection;

    function finish() {
      var activeChild = subsection || firstChildOf(section);

      setActiveSection(section);
      setActiveChild(section, activeChild);

      if (pushHistory) {
        var path = buildPath(section, activeChild);
        if (opts.replace) {
          history.replaceState({ section: section, subsection: activeChild }, "", path);
        } else {
          history.pushState({ section: section, subsection: activeChild }, "", path);
        }
      }

      currentSection = section;
      currentSubsection = activeChild;

      if (explicitChild) {
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
      setupScrollTracking(section);
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