const { ipcRenderer } = require("electron");

// With contextIsolation: false, this runs in the SAME context as the page
// So window.print is actually overridden on the page — no OS dialog ever fires
window.print = function () {
  ipcRenderer.send("silent-print");
};
