using System;
using System.Diagnostics;
using System.IO;
using System.Reflection;
using System.Text;
using System.Windows.Forms;

[assembly: AssemblyTitle("EMS-IPAM Client")]
[assembly: AssemblyProduct("EMS-IPAM Client")]
[assembly: AssemblyDescription("EMS-IPAM connection launcher")]
[assembly: AssemblyVersion("0.8.0.0")]
[assembly: AssemblyFileVersion("0.8.0.0")]

internal static class EmsLauncher
{
    [STAThread]
    private static int Main(string[] args)
    {
        try
        {
            string root = AppDomain.CurrentDomain.BaseDirectory;
            if (args.Length == 0)
            {
                MessageBox.Show("EMS-IPAM Client 0.8.0 is installed.\n\nIn your browser, choose this program for emsipam-client links:\n" +
                    Path.Combine(root, "EMS-IPAM-Client.exe") +
                    "\n\nChoose WinBox only inside the EMS-IPAM tool selection window.\nUse Configure-WinBox.cmd to change its path.", "EMS-IPAM Client");
                return 0;
            }
            if (args.Length != 1) throw new ArgumentException("Expected one EMS-IPAM link.");
            string script = Path.Combine(root, "EMS-IPAM-Protocol.ps1");
            if (!File.Exists(script)) throw new FileNotFoundException("Run Install.cmd again. The protocol script is missing.");
            // Base64 keeps untrusted URL text out of PowerShell's command syntax.
            string encoded = Convert.ToBase64String(Encoding.UTF8.GetBytes(args[0]));
            string powershell = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.System),
                @"WindowsPowerShell\v1.0\powershell.exe");
            ProcessStartInfo start = new ProcessStartInfo(powershell);
            start.UseShellExecute = false;
            start.CreateNoWindow = true;
            start.WorkingDirectory = root;
            start.Arguments = "-NoLogo -NoProfile -STA -ExecutionPolicy Bypass -File \"" + script +
                "\" " + (args[0] == "--configure-winbox" ? "-ConfigureWinBox" : "-UriBase64 " + encoded);
            using (Process process = Process.Start(start))
            {
                process.WaitForExit();
                return process.ExitCode;
            }
        }
        catch (Exception error)
        {
            MessageBox.Show(error.Message, "EMS-IPAM Client", MessageBoxButtons.OK, MessageBoxIcon.Error);
            return 1;
        }
    }
}
