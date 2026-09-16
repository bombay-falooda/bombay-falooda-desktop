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

const { execFile } = require("child_process");

// Native Win32 Spooler Raw ESC/POS Print Handler (Zero-Dialog, Instant 0ms Thermal Printing)
ipcMain.handle("raw-print", async (event, payload = {}) => {
  try {
    let targetPrinter = payload.printerName || "POS-80";
    const base64Data = payload.base64Data || "";

    if (!base64Data) {
      return { success: false, error: "No data payload provided" };
    }

    const psScript = `
$code = @"
using System;
using System.IO;
using System.Runtime.InteropServices;
public class RawPrinterHelper {
    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Ansi)]
    public class DOCINFOA {
        [MarshalAs(UnmanagedType.LPStr)] public string pDocName;
        [MarshalAs(UnmanagedType.LPStr)] public string pOutputFile;
        [MarshalAs(UnmanagedType.LPStr)] public string pDataType;
    }
    [DllImport("winspool.Drv", EntryPoint = "OpenPrinterA", SetLastError = true, CharSet = CharSet.Ansi, ExactSpelling = true, CallingConvention = CallingConvention.StdCall)]
    public static extern bool OpenPrinter([MarshalAs(UnmanagedType.LPStr)] string szPrinter, out IntPtr hPrinter, IntPtr pd);
    [DllImport("winspool.Drv", EntryPoint = "ClosePrinter", SetLastError = true, ExactSpelling = true, CallingConvention = CallingConvention.StdCall)]
    public static extern bool ClosePrinter(IntPtr hPrinter);
    [DllImport("winspool.Drv", EntryPoint = "StartDocPrinterA", SetLastError = true, CharSet = CharSet.Ansi, ExactSpelling = true, CallingConvention = CallingConvention.StdCall)]
    public static extern bool StartDocPrinter(IntPtr hPrinter, int level, [In, MarshalAs(UnmanagedType.LPStruct)] DOCINFOA di);
    [DllImport("winspool.Drv", EntryPoint = "EndDocPrinter", SetLastError = true, ExactSpelling = true, CallingConvention = CallingConvention.StdCall)]
    public static extern bool EndDocPrinter(IntPtr hPrinter);
    [DllImport("winspool.Drv", EntryPoint = "StartPagePrinter", SetLastError = true, ExactSpelling = true, CallingConvention = CallingConvention.StdCall)]
    public static extern bool StartPagePrinter(IntPtr hPrinter);
    [DllImport("winspool.Drv", EntryPoint = "EndPagePrinter", SetLastError = true, ExactSpelling = true, CallingConvention = CallingConvention.StdCall)]
    public static extern bool EndPagePrinter(IntPtr hPrinter);
    [DllImport("winspool.Drv", EntryPoint = "WritePrinter", SetLastError = true, ExactSpelling = true, CallingConvention = CallingConvention.StdCall)]
    public static extern bool WritePrinter(IntPtr hPrinter, IntPtr pBytes, int dwCount, out int dwWritten);
    public static bool SendBytesToPrinter(string szPrinterName, byte[] pBytes) {
        IntPtr hPrinter = new IntPtr(0);
        DOCINFOA di = new DOCINFOA();
        bool bSuccess = false;
        di.pDocName = "Bombay Falooda POS";
        di.pDataType = "RAW";
        if (OpenPrinter(szPrinterName.Normalize(), out hPrinter, IntPtr.Zero)) {
            if (StartDocPrinter(hPrinter, 1, di)) {
                if (StartPagePrinter(hPrinter)) {
                    IntPtr pUnmanagedBytes = Marshal.AllocCoTaskMem(pBytes.Length);
                    Marshal.Copy(pBytes, 0, pUnmanagedBytes, pBytes.Length);
                    int dwWritten = 0;
                    bSuccess = WritePrinter(hPrinter, pUnmanagedBytes, pBytes.Length, out dwWritten);
                    Marshal.FreeCoTaskMem(pUnmanagedBytes);
                    EndPagePrinter(hPrinter);
                }
                EndDocPrinter(hPrinter);
            }
            ClosePrinter(hPrinter);
        }
        return bSuccess;
    }
}
"@
if (-not ([System.Management.Automation.PSTypeName]'RawPrinterHelper').Type) {
    Add-Type -TypeDefinition $code
}

Add-Type -AssemblyName System.Drawing
$target = "${targetPrinter}".Trim()
$installed = [System.Drawing.Printing.PrinterSettings]::InstalledPrinters

# Match target printer case-insensitively or find any installed thermal/Posiflex printer
$exactOrFuzzy = $installed | Where-Object { $_ -eq $target -or $_ -like "*$target*" } | Select-Object -First 1
if ($exactOrFuzzy) {
    $target = $exactOrFuzzy
} else {
    $match = $installed | Where-Object { $_ -match "Posiflex" -or $_ -match "POS-80" -or $_ -match "POS" -or $_ -match "80" -or $_ -match "Thermal" -or $_ -match "576" -or $_ -match "Receipt" } | Select-Object -First 1
    if ($match) {
        $target = $match
    } else {
        $def = (New-Object System.Drawing.Printing.PrinterSettings).PrinterName
        if ($def) { $target = $def }
    }
}

$bytes = [System.Convert]::FromBase64String("${base64Data}")
$result = [RawPrinterHelper]::SendBytesToPrinter($target, $bytes)
if ($result) {
    Write-Output "SUCCESS:$target"
} else {
    Write-Error "Failed to print to $target"
}
`;

    return new Promise((resolve) => {
      execFile("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", psScript], (err, stdout, stderr) => {
        if (err) {
          console.error("Native spooler raw print error:", err, stderr);
          resolve({ success: false, error: stderr || err.message });
        } else {
          const out = (stdout || "").trim();
          const printerUsed = out.startsWith("SUCCESS:") ? out.replace("SUCCESS:", "") : targetPrinter;
          resolve({ success: true, printer: printerUsed });
        }
      });
    });
  } catch (err) {
    console.error("raw-print error:", err);
    return { success: false, error: String(err) };
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
