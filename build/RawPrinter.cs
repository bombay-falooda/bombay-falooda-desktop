using System;
using System.IO;
using System.Drawing.Printing;
using System.Runtime.InteropServices;

public class RawPrinter {
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

    public static bool SendBytes(string szPrinterName, byte[] pBytes) {
        IntPtr hPrinter = IntPtr.Zero;
        DOCINFOA di = new DOCINFOA();
        di.pDocName = "Bombay Falooda POS";
        di.pDataType = "RAW";
        bool bSuccess = false;

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

    public static int Main(string[] args) {
        try {
            string targetPrinter = args.Length > 0 ? args[0].Trim() : "";
            string base64Data = "";

            if (args.Length > 1) {
                base64Data = args[1];
            } else {
                using (var reader = new StreamReader(Console.OpenStandardInput())) {
                    base64Data = reader.ReadToEnd().Trim();
                }
            }

            if (string.IsNullOrEmpty(base64Data)) {
                Console.Error.WriteLine("ERROR: No base64 data provided");
                return 1;
            }

            // Find matching printer
            string matchedPrinter = null;
            if (!string.IsNullOrEmpty(targetPrinter) && targetPrinter != "Thermal Receipt Printer (80mm)") {
                foreach (string printer in PrinterSettings.InstalledPrinters) {
                    if (string.Equals(printer, targetPrinter, StringComparison.OrdinalIgnoreCase) ||
                        printer.IndexOf(targetPrinter, StringComparison.OrdinalIgnoreCase) >= 0) {
                        matchedPrinter = printer;
                        break;
                    }
                }
            }

            if (matchedPrinter == null) {
                foreach (string printer in PrinterSettings.InstalledPrinters) {
                    if (printer.IndexOf("Posiflex", StringComparison.OrdinalIgnoreCase) >= 0 ||
                        printer.IndexOf("HS3inch", StringComparison.OrdinalIgnoreCase) >= 0 ||
                        printer.IndexOf("POS-80", StringComparison.OrdinalIgnoreCase) >= 0 ||
                        printer.IndexOf("POS", StringComparison.OrdinalIgnoreCase) >= 0 ||
                        printer.IndexOf("80", StringComparison.OrdinalIgnoreCase) >= 0 ||
                        printer.IndexOf("Thermal", StringComparison.OrdinalIgnoreCase) >= 0 ||
                        printer.IndexOf("576", StringComparison.OrdinalIgnoreCase) >= 0) {
                        matchedPrinter = printer;
                        break;
                    }
                }
            }

            if (matchedPrinter == null) {
                matchedPrinter = new PrinterSettings().PrinterName;
            }

            if (string.IsNullOrEmpty(matchedPrinter)) {
                Console.Error.WriteLine("ERROR: No suitable printer found");
                return 2;
            }

            byte[] bytes = Convert.FromBase64String(base64Data);
            bool success = SendBytes(matchedPrinter, bytes);

            if (success) {
                Console.WriteLine("SUCCESS:" + matchedPrinter);
                return 0;
            } else {
                Console.Error.WriteLine("ERROR: Failed to write to " + matchedPrinter);
                return 3;
            }
        } catch (Exception ex) {
            Console.Error.WriteLine("ERROR: " + ex.Message);
            return 99;
        }
    }
}
