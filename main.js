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
  try {
    const installedPrinters = mainWindow ? await mainWindow.webContents.getPrintersAsync() : [];
    let targetDeviceName = undefined;

    if (options && options.deviceName) {
      const found = installedPrinters.find(
        (p) => p.name.toLowerCase() === options.deviceName.toLowerCase()
      );
      if (found) {
        targetDeviceName = found.name;
      }
    }

    if (!targetDeviceName && installedPrinters.length > 0) {
      const defaultP = installedPrinters.find((p) => p.isDefault) || installedPrinters[0];
      if (defaultP) targetDeviceName = defaultP.name;
    }

    // If receipt HTML is provided, print via dedicated clean offscreen worker window
    if (options && options.html) {
      const workerWin = new BrowserWindow({
        show: false,
        width: 300,
        height: 600,
        webPreferences: {
          nodeIntegration: false,
          contextIsolation: true,
        },
      });

      const fullHtml = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <style>
    @page { margin: 0; size: 80mm auto; }
    * { box-sizing: border-box; -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; color: #000000 !important; }
    html, body {
      margin: 0 !important;
      padding: 1mm 1.5mm !important;
      background: #ffffff !important;
      color: #000000 !important;
      font-family: 'Courier New', Courier, monospace, Arial, sans-serif !important;
      font-size: 11px !important;
      font-weight: 700 !important;
      line-height: 1.25 !important;
      width: 68mm !important;
      max-width: 68mm !important;
      word-break: break-word !important;
    }
    table { width: 100% !important; border-collapse: collapse !important; }
    th, td { padding: 2px 0 !important; color: #000000 !important; }
  </style>
</head>
<body>
  ${options.html}
</body>
</html>`;

      // Save debug copy for inspection
      try {
        const debugPath = path.join(app.getPath("temp"), "last-pos-print.html");
        fs.writeFileSync(debugPath, fullHtml, "utf8");
      } catch (e) {}

      // 1. Attach listener BEFORE loadURL to avoid race conditions
      workerWin.webContents.once("did-finish-load", async () => {
        try {
          // 2. Wait for fonts and layout to completely settle
          try {
            await workerWin.webContents.executeJavaScript(
              `document.fonts && document.fonts.ready ? document.fonts.ready.then(() => true) : true`
            );
          } catch (e) {}
          await new Promise((resolve) => setTimeout(resolve, 300));

          // 3. Pass explicit thermal roll pageSize and deviceName
          const printOpts = {
            silent: true,
            printBackground: true,
            margins: { marginType: "none" },
            pageSize: {
              width: 80000,
              height: 250000,
            },
          };
          if (targetDeviceName) {
            printOpts.deviceName = targetDeviceName;
          }

          workerWin.webContents.print(printOpts, (success, errorType) => {
            if (!success) {
              console.error("Worker silent print failed:", errorType);
            }
            setTimeout(() => {
              try { workerWin.destroy(); } catch (e) {}
            }, 1000);
          });
        } catch (err) {
          console.error("Worker print execution error:", err);
          try { workerWin.destroy(); } catch (e) {}
        }
      });

      // Load URL after listener is attached
      await workerWin.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(fullHtml)}`);
      return;
    }

    console.warn("Silent print requested but no receipt HTML was captured; skipping to prevent blank print.");
  } catch (err) {
    console.error("Print exception:", err);
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
