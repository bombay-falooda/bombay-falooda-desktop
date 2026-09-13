const { app, BrowserWindow, Menu, ipcMain, shell } = require("electron");
const path = require("path");
const fs = require("fs");

let mainWindow = null;
let tray = null;

const isDev = process.env.NODE_ENV === "development" || process.argv.includes("--dev");

const PORTALS = {
  superadmin: {
    title: "Bombay Falooda - SuperAdmin Workspace",
    url: isDev ? "http://localhost:3000" : "https://admin.bombayfalooda.com/login",
    width: 1440,
    height: 900,
  },
  franchise: {
    title: "Bombay Falooda - Franchise Owner Portal",
    url: isDev ? "http://localhost:3001" : "https://franchise.bombayfalooda.com/login",
    width: 1400,
    height: 880,
  },
  pos: {
    title: "Bombay Falooda - POS Billing Terminal",
    url: isDev ? "http://localhost:3002/terminal" : "https://pos.bombayfalooda.com/terminal",
    width: 1366,
    height: 768,
  },
};

function getRequestedPortal() {
  if (process.env.TARGET_PORTAL && PORTALS[process.env.TARGET_PORTAL]) {
    return process.env.TARGET_PORTAL;
  }

  const args = process.argv.slice(1);
  for (const arg of args) {
    if (arg.startsWith("--portal=")) {
      const p = arg.split("=")[1].toLowerCase();
      if (PORTALS[p]) return p;
    }
  }

  const fullStr = `${process.execPath || ""} ${app.getName() || ""} ${process.title || ""}`.toLowerCase();
  if (fullStr.includes("superadmin") || fullStr.includes("super-admin") || fullStr.includes("admin")) {
    return "superadmin";
  }
  if (fullStr.includes("franchise")) {
    return "franchise";
  }
  if (fullStr.includes("pos") || fullStr.includes("terminal")) {
    return "pos";
  }

  return "pos"; // Default to POS Terminal
}

function createWindow(portalKey = "pos") {
  const portal = PORTALS[portalKey] || PORTALS.pos;

  mainWindow = new BrowserWindow({
    title: portal.title,
    icon: path.join(__dirname, "build", "icon.ico"),
    width: portal.width,
    height: portal.height,
    minWidth: 1024,
    minHeight: 700,
    show: false,
    autoHideMenuBar: portalKey === "pos",
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
      webSecurity: true,
      preload: path.join(__dirname, "preload.js"),
    },
  });

  mainWindow.loadURL(portal.url);

  mainWindow.webContents.on("ready-to-show", () => {
    mainWindow.show();
    mainWindow.focus();
  });



  mainWindow.on("closed", () => {
    mainWindow = null;
  });

  // Dedicated clean window without top menu bar (fullscreen, reload, zoom shortcuts work natively)
  Menu.setApplicationMenu(null);
}

app.commandLine.appendSwitch('kiosk-printing');

// Handle get-printers IPC from renderer (returns all Windows installed printers)
ipcMain.handle("get-printers", async () => {
  if (mainWindow) {
    try {
      return await mainWindow.webContents.getPrintersAsync();
    } catch (err) {
      console.error("Failed to get printers:", err);
      return [];
    }
  }
  return [];
});

// Handle silent print IPC from preload.js (intercepts window.print() before OS dialog appears)
ipcMain.on("silent-print", async (event, options = {}) => {
  if (mainWindow) {
    try {
      const installedPrinters = await mainWindow.webContents.getPrintersAsync();
      const printOpts = {
        silent: true,
        printBackground: true,
      };

      if (options && options.deviceName) {
        const found = installedPrinters.find(
          (p) => p.name.toLowerCase() === options.deviceName.toLowerCase()
        );
        if (found) {
          printOpts.deviceName = found.name;
        }
      }

      mainWindow.webContents.print(printOpts, (success, errorType) => {
        if (!success) {
          console.error("Direct silent print failed:", errorType);
        }
      });
    } catch (err) {
      console.error("Print exception:", err);
    }
  }
});

app.whenReady().then(() => {
  const targetPortal = getRequestedPortal();
  createWindow(targetPortal);

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow(targetPortal);
    }
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});
