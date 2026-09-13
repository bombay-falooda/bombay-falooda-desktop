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
  printRawEscPos: async (data, printerName) => {
    try {
      let base64 = "";
      if (typeof data === "string") {
        base64 = data;
      } else if (data instanceof Uint8Array || Array.isArray(data)) {
        base64 = Buffer.from(data).toString("base64");
      }
      const targetPrinter = printerName || localStorage.getItem("pos_printer_name") || "POS-80";
      return await ipcRenderer.invoke("raw-print", {
        base64Data: base64,
        printerName: targetPrinter,
      });
    } catch (e) {
      console.error("printRawEscPos error:", e);
      return { success: false, error: e.message };
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
      if (el) html = el.outerHTML || el.innerHTML;
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
    if (el) html = el.outerHTML || el.innerHTML;
  }

  const opts = Object.assign({}, options || {}, {
    deviceName: (options && options.deviceName) || savedName,
    html: html,
  });
  ipcRenderer.send("silent-print", opts);
};

