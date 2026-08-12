document.addEventListener("DOMContentLoaded", function () {
  var buttons = document.querySelectorAll(".nav-label");
  var sections = document.querySelectorAll(".nav-section");
  var contentArea = document.getElementById("content-area");
  var baseurl = document.body.dataset.baseurl || "";
  var defaultSection = "about";

  var validSections = Array.prototype.map.call(sections, function (s) {
    return s.dataset.section;
  });

  function loadContent(target) {
    fetch(baseurl + "/content/" + target + ".html")
      .then(function (res) {
        if (!res.ok) throw new Error("Failed to load " + target);
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

  function activate(target, updateHash) {
    if (validSections.indexOf(target) === -1) {
      target = defaultSection;
    }

    sections.forEach(function (s) {
      s.classList.toggle("active", s.dataset.section === target);
    });

    loadContent(target);

    if (updateHash !== false && window.location.hash !== "#" + target) {
      window.location.hash = target;
    }
  }

  function sectionFromHash() {
    var hash = window.location.hash.replace(/^#/, "");
    // Extension point: child hashes look like "notes/thoughts".
    // Only the top-level segment is used to activate a section for now.
    var topLevel = hash.split("/")[0];
    return topLevel || defaultSection;
  }

  buttons.forEach(function (btn) {
    btn.addEventListener("click", function () {
      activate(btn.dataset.target);
    });
  });

  window.addEventListener("hashchange", function () {
    activate(sectionFromHash(), false);
  });

  activate(sectionFromHash(), false);
});