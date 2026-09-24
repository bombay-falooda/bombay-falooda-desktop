using System;
using System.IO;
using System.Runtime.InteropServices;
using System.Drawing.Printing;

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
        if (OpenPrinter(szPrinterName, out hPrinter, IntPtr.Zero)) {
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

    public static void Main(string[] args) {
        if (args.Length < 1) {
            Console.Error.WriteLine("Usage: raw-printer <printerName> [filePathOrBase64]");
            Environment.Exit(1);
        }
        string target = args[0].Trim();
        string resolvedPrinter = target;

        // Try exact match
        bool found = false;
        foreach (string p in PrinterSettings.InstalledPrinters) {
            if (string.Equals(p, target, StringComparison.OrdinalIgnoreCase)) {
                resolvedPrinter = p;
                found = true;
                break;
            }
        }
        // Try fuzzy match
        if (!found) {
            foreach (string p in PrinterSettings.InstalledPrinters) {
                if (p.IndexOf(target, StringComparison.OrdinalIgnoreCase) >= 0) {
                    resolvedPrinter = p;
                    found = true;
                    break;
                }
            }
        }
        // Try thermal keywords match
        if (!found) {
            foreach (string p in PrinterSettings.InstalledPrinters) {
                if (p.IndexOf("Posiflex", StringComparison.OrdinalIgnoreCase) >= 0 ||
                    p.IndexOf("POS-80", StringComparison.OrdinalIgnoreCase) >= 0 ||
                    p.IndexOf("POS", StringComparison.OrdinalIgnoreCase) >= 0 ||
                    p.IndexOf("80", StringComparison.OrdinalIgnoreCase) >= 0 ||
                    p.IndexOf("Thermal", StringComparison.OrdinalIgnoreCase) >= 0 ||
                    p.IndexOf("576", StringComparison.OrdinalIgnoreCase) >= 0 ||
                    p.IndexOf("Receipt", StringComparison.OrdinalIgnoreCase) >= 0) {
                    resolvedPrinter = p;
                    found = true;
                    break;
                }
            }
        }
        if (!found) {
            PrinterSettings ps = new PrinterSettings();
            if (!string.IsNullOrEmpty(ps.PrinterName)) {
                resolvedPrinter = ps.PrinterName;
            }
        }

        byte[] data = null;
        if (args.Length >= 2) {
            string secondArg = args[1];
            if (File.Exists(secondArg)) {
                data = File.ReadAllBytes(secondArg);
            } else {
                try {
                    data = Convert.FromBase64String(secondArg);
                } catch {
                    data = System.Text.Encoding.UTF8.GetBytes(secondArg);
                }
            }
        } else {
            using (MemoryStream ms = new MemoryStream()) {
                Console.OpenStandardInput().CopyTo(ms);
                data = ms.ToArray();
            }
        }

        if (data == null || data.Length == 0) {
            Console.Error.WriteLine("No byte data received");
            Environment.Exit(2);
        }

        bool ok = SendBytesToPrinter(resolvedPrinter, data);
        if (ok) {
            Console.WriteLine("SUCCESS:" + resolvedPrinter);
            Environment.Exit(0);
        } else {
            Console.Error.WriteLine("Failed to write RAW bytes to printer " + resolvedPrinter);
            Environment.Exit(3);
        }
    }
}
