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
    // If deviceName specified or window.print invoked
    if (options && options.deviceName) {
      ipcRenderer.send("silent-print", options);
    } else {
      window.print();
    }
  },
};
