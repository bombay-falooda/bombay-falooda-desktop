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
    let savedName = undefined;
    try {
      savedName = localStorage.getItem("pos_printer_name") || undefined;
    } catch (e) {}

    let html = options && options.html;
    if (!html && typeof document !== "undefined") {
      const el = document.getElementById("print-ticket-root");
      if (el) html = el.innerHTML;
    }

    const opts = Object.assign({}, options || {}, {
      deviceName: (options && options.deviceName) || savedName,
      html: html,
    });
    ipcRenderer.send("silent-print", opts);
  },
};

// Override window.print so NO OS dialog ever fires in the POS app
window.print = function (options) {
  let savedName = undefined;
  try {
    savedName = localStorage.getItem("pos_printer_name") || undefined;
  } catch (e) {}

  let html = options && options.html;
  if (!html && typeof document !== "undefined") {
    const el = document.getElementById("print-ticket-root");
    if (el) html = el.innerHTML;
  }

  const opts = Object.assign({}, options || {}, {
    deviceName: (options && options.deviceName) || savedName,
    html: html,
  });
  ipcRenderer.send("silent-print", opts);
};

