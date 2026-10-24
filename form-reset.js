(function preventRestoredFormValues() {
  "use strict";

  var hasClearedCurrentPage = false;
  var observer;

  function isEditableControl(control) {
    if (!control || control.disabled) return false;
    if (control.tagName === "TEXTAREA" || control.tagName === "SELECT") return true;
    if (control.tagName !== "INPUT") return false;

    return [
      "hidden",
      "submit",
      "button",
      "reset",
      "image",
      "file",
    ].indexOf(control.type) === -1;
  }

  function disableAutocomplete() {
    document.documentElement.setAttribute("autocomplete", "off");
    Array.prototype.forEach.call(
      document.querySelectorAll("input, textarea, select"),
      function (control) {
        control.setAttribute("autocomplete", "off");
      },
    );
  }

  function clearVisibleControls() {
    var controls = document.querySelectorAll("input, textarea, select");

    Array.prototype.forEach.call(controls, function (control) {
      if (!isEditableControl(control)) return;

      if (control.type === "checkbox" || control.type === "radio") {
        control.checked = false;
        return;
      }

      if (control.tagName === "SELECT") {
        var emptyOption = Array.prototype.find.call(
          control.options,
          function (option) {
            return option.value === "";
          },
        );
        control.selectedIndex = emptyOption ? emptyOption.index : -1;
        return;
      }

      control.value = "";
    });
  }

  function clearWhenFormExists() {
    var controls = document.querySelectorAll("input, textarea, select");
    if (!controls.length) return false;

    disableAutocomplete();
    clearVisibleControls();
    hasClearedCurrentPage = true;
    if (observer) observer.disconnect();
    return true;
  }

  function watchForForm() {
    if (clearWhenFormExists()) return;

    if (observer) observer.disconnect();
    observer = new MutationObserver(function () {
      if (clearWhenFormExists()) return;
    });
    observer.observe(document.documentElement, {
      childList: true,
      subtree: true,
    });
  }

  window.addEventListener("pageshow", function () {
    hasClearedCurrentPage = false;
    watchForForm();
  });

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", watchForForm, { once: true });
  } else {
    watchForForm();
  }
})();
