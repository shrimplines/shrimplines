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
        var sub = entry.target.id;
        if (sub === currentSubsection) return;
        currentSubsection = sub;
        setActiveChild(section, sub);
        history.replaceState({ section: section, subsection: sub }, "", buildPath(section, sub));
      });
    }, {
      root: contentArea,
      // Treat a section as "current" once it's within the top ~30% of the
      // viewport, so the URL updates a beat before it reaches the very top.
      rootMargin: "-10% 0px -70% 0px",
      threshold: 0
    });

    els.forEach(function (el) { currentObserver.observe(el); });
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