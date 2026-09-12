const { app, BrowserWindow, Menu, ipcMain, shell } = require("electron");
const path = require("path");

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
  const args = process.argv.slice(1);
  for (const arg of args) {
    if (arg.startsWith("--portal=")) {
      const p = arg.split("=")[1].toLowerCase();
      if (PORTALS[p]) return p;
    }
  }
  const appName = (app.getName() || "").toLowerCase();
  if (appName.includes("superadmin") || appName.includes("admin")) return "superadmin";
  if (appName.includes("franchise")) return "franchise";
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

  if (portalKey === "pos") {
    Menu.setApplicationMenu(null);
  } else {
    buildMenu(portalKey);
  }
}

function buildMenu(activePortal) {
  const template = [
    {
      label: "Portals",
      submenu: [
        {
          label: "POS Billing Terminal",
          type: "radio",
          checked: activePortal === "pos",
          click: () => switchPortal("pos"),
        },
        {
          label: "Franchise Owner Portal",
          type: "radio",
          checked: activePortal === "franchise",
          click: () => switchPortal("franchise"),
        },
        {
          label: "SuperAdmin Workspace",
          type: "radio",
          checked: activePortal === "superadmin",
          click: () => switchPortal("superadmin"),
        },
        { type: "separator" },
        { label: "Exit App", role: "quit" },
      ],
    },

    {
      label: "View",
      submenu: [
        { role: "reload" },
        { role: "forceReload" },
        { role: "toggleDevTools" },
        { type: "separator" },
        { role: "resetZoom" },
        { role: "zoomIn" },
        { role: "zoomOut" },
        { type: "separator" },
        { role: "togglefullscreen" },
      ],
    },
    {
      label: "Help",
      submenu: [
        {
          label: "Open Bombay Falooda Support",
          click: async () => {
            await shell.openExternal("https://bombayfalooda.com");
          },
        },
      ],
    },
  ];

  const menu = Menu.buildFromTemplate(template);
  Menu.setApplicationMenu(menu);
}

function switchPortal(portalKey) {
  if (PORTALS[portalKey] && mainWindow) {
    mainWindow.setTitle(PORTALS[portalKey].title);
    mainWindow.loadURL(PORTALS[portalKey].url);
    buildMenu(portalKey);
  }
}

app.commandLine.appendSwitch('kiosk-printing');

// Handle silent print IPC from preload.js (intercepts window.print() before OS dialog appears)
ipcMain.on("silent-print", () => {
  if (mainWindow) {
    mainWindow.webContents.print({ silent: true, printBackground: true }, (success, errorType) => {
      if (!success) console.error("Silent print failed:", errorType);
    });
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
