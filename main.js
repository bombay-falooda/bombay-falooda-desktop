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

// Native Win32 Spooler Raw ESC/POS Print Handler (Zero-Dialog, Instant <30ms Thermal Printing)
ipcMain.handle("raw-print", async (event, payload = {}) => {
  let tempFilePath = null;
  try {
    let targetPrinter = (payload.printerName || "Posiflex HS3inch printer 576").trim();
    const base64Data = payload.base64Data || "";

    if (!base64Data) {
      return { success: false, error: "No data payload provided" };
    }

    const binaryBuffer = Buffer.from(base64Data, "base64");
    const os = require("os");
    tempFilePath = path.join(os.tmpdir(), `pos-print-${Date.now()}-${Math.random().toString(36).substring(7)}.bin`);
    fs.writeFileSync(tempFilePath, binaryBuffer);

    // Check for pre-compiled high-performance native binary helper
    const nativeHelperPaths = [
      path.join(__dirname, "raw-printer.exe"),
      path.join(process.resourcesPath || "", "raw-printer.exe"),
      path.join(app.getAppPath(), "raw-printer.exe"),
    ];
    const helperExe = nativeHelperPaths.find((p) => fs.existsSync(p));

    if (helperExe) {
      return new Promise((resolve) => {
        execFile(
          helperExe,
          [targetPrinter, tempFilePath],
          { maxBuffer: 10 * 1024 * 1024 },
          (err, stdout, stderr) => {
            try { if (tempFilePath && fs.existsSync(tempFilePath)) fs.unlinkSync(tempFilePath); } catch (e) {}
            if (err) {
              console.error("raw-printer.exe error:", err, stderr);
              resolve({ success: false, error: stderr || err.message });
            } else {
              const out = (stdout || "").trim();
              const printerUsed = out.startsWith("SUCCESS:") ? out.replace("SUCCESS:", "") : targetPrinter;
              resolve({ success: true, printer: printerUsed });
            }
          }
        );
      });
    }

    // Fallback: PowerShell script using the temp file
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

$bytes = [System.IO.File]::ReadAllBytes("${tempFilePath.replace(/\\/g, "\\\\")}")
$result = [RawPrinterHelper]::SendBytesToPrinter($target, $bytes)
if ($result) {
    Write-Output "SUCCESS:$target"
} else {
    Write-Error "Failed to print to $target"
}
`;

    return new Promise((resolve) => {
      execFile("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", psScript], (err, stdout, stderr) => {
        try { if (tempFilePath && fs.existsSync(tempFilePath)) fs.unlinkSync(tempFilePath); } catch (e) {}
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
    try { if (tempFilePath && fs.existsSync(tempFilePath)) fs.unlinkSync(tempFilePath); } catch (e) {}
    console.error("raw-print error:", err);
    return { success: false, error: String(err) };
  }
});

// Silent HTML / CSS Web Print Handler (Matches Chrome rendering exactly with Arial font)
ipcMain.on("silent-print", async (event, options = {}) => {
  try {
    const targetPrinter = options.deviceName || "Posiflex HS3inch printer 576";
    const printWindow = new BrowserWindow({
      show: false,
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
    * { -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; color: #000000 !important; box-sizing: border-box; }
    html, body { margin: 0 !important; padding: 0 !important; background: #ffffff !important; }
    body {
      width: 72mm !important;
      max-width: 72mm !important;
      padding: 1mm 2mm !important;
      font-family: Arial, Helvetica, sans-serif !important;
      font-size: 12px !important;
      font-weight: 400 !important;
      line-height: 1.3 !important;
      color: #000000 !important;
      -webkit-font-smoothing: antialiased !important;
      text-rendering: geometricPrecision !important;
    }
    body * { font-family: Arial, Helvetica, sans-serif !important; }
    #print-ticket-root {
      display: block !important;
      visibility: visible !important;
      width: 100% !important;
    }
    strong, b, th, .font-bold, .font-semibold {
      font-weight: 700 !important;
    }
    table { width: 100%; border-collapse: collapse; }
    th, td { padding: 2.5px 0; }
  </style>
</head>
<body>
  ${options.html || ""}
</body>
</html>`;

    await printWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(fullHtml)}`);

    // Give 300ms for all fonts & images (logo) to paint completely
    setTimeout(() => {
      if (printWindow.isDestroyed()) return;
      printWindow.webContents.print(
        {
          silent: true,
          printBackground: true,
          deviceName: targetPrinter,
          margins: { marginType: "none" },
        },
        (success, failureReason) => {
          if (!success) {
            console.warn("Silent print failed:", failureReason);
          }
          setTimeout(() => {
            if (!printWindow.isDestroyed()) {
              printWindow.close();
            }
          }, 1500);
        }
      );
    }, 300);
  } catch (err) {
    console.error("silent-print IPC error:", err);
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
