document.addEventListener("DOMContentLoaded", function () {
  var buttons = document.querySelectorAll(".nav-label");
  var sections = document.querySelectorAll(".nav-section");
  var contentArea = document.getElementById("content-area");
  var baseurl = document.body.dataset.baseurl || "";

  function activate(target) {
    sections.forEach(function (s) {
      s.classList.toggle("active", s.dataset.section === target);
    });

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

  buttons.forEach(function (btn) {
    btn.addEventListener("click", function () {
      activate(btn.dataset.target);
    });
  });

  activate("about");
});