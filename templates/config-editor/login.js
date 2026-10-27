"use strict";

const input = document.getElementById("editor-url");
const error = document.getElementById("error");
const open = () => {
  try {
    const url = new URL(input.value.trim());
    if (url.origin !== location.origin || !/^\/[A-Za-z0-9_-]{43}\/$/.test(url.pathname) || url.search || url.hash || url.username || url.password) {
      throw new Error("invalid URL");
    }
    input.value = "";
    location.replace(url.href);
  } catch {
    error.textContent = "Paste the full editor URL from this terminal session.";
  }
};
document.getElementById("open-editor").addEventListener("click", open);
input.addEventListener("keydown", (event) => {
  if (event.key === "Enter") open();
});
