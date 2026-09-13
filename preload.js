const { ipcRenderer } = require("electron");

window.isElectron = true;
window.electronAPI = {
  getPrinters: async () => {
    try {
      return await ipcRenderer.invoke("get-printers");
    } catch (e) {
      return [];
    }
  },
  printSilent: (options) => {
    ipcRenderer.send("silent-print", options || {});
  },
};

// With contextIsolation: false, this runs in the SAME context as the page
// So window.print is actually overridden on the page — no OS dialog ever fires
window.print = function (options) {
  ipcRenderer.send("silent-print", options || {});
};
