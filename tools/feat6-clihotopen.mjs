// feat6: single-instance + CLI hot-send for native host
// Program.cs: add a named-mutex single-instance guard. When a second instance
// starts with a file argument, it writes the path to a named pipe that the
// primary instance's Server thread listens on; the primary then calls
// SwapDoc. No new dependencies — .NET Framework ships named pipes.
import { readFileSync, writeFileSync } from 'node:fs';

let pr = readFileSync('native/Program.cs', 'utf8');

// 1) Add the using for named pipes
const usingAnchor = "using System.Threading;\nusing System.Windows.Forms;";
if (pr.indexOf(usingAnchor) < 0) { console.log('using anchor not found'); process.exit(1); }
pr = pr.replace(usingAnchor, "using System.Threading;\nusing System.IO.Pipes;\nusing System.Windows.Forms;", 1);

// 2) Add single-instance fields and forwarding logic at the top of the class
//    (right after the AppTitle const).
const fieldAnchor = '        private const string AppTitle = "mdlight";';
if (pr.indexOf(fieldAnchor) < 0) { console.log('AppTitle anchor not found'); process.exit(1); }

const newFields = `        private const string AppTitle = "mdlight";
        private const string MutexName = "Global\\\\mdlight-single-" +
            Environment.GetEnvironmentVariable("USERNAME") ?? "default";
        // The named pipe the primary instance listens on; a second instance
        // connects, writes the file path, and the primary swaps its doc.
        private const string PipeName = "mdlight-hotopen";`;

// replace the anchor with itself + new fields
pr = pr.replace(fieldAnchor, newFields, 1);

// 3) Before "pick a document" (after the install/uninstall/unbind/settings
//    handling and before the file==null check), add the single-instance check.
const docAnchor = "            // ---- pick a document ------------------------------------------";
if (pr.indexOf(docAnchor) < 0) { console.log('pick-doc anchor not found'); process.exit(1); }

const singleInstanceBlock = `            // ---- single-instance + CLI hot-send ---------------------------------
            // If another mdlight window is already open, forward the file to it
            // via the named pipe and exit — no second window, no port clash.
            // --no-window and --export are exempt (they don't open a window).
            if (!noWindow && !export)
            {
                bool created;
                Mutex instanceMutex =
                    new Mutex(true, MutexName, out created);
                if (!created)
                {
                    Util.Log("second instance detected, forwarding to pipe");
                    bool forwarded = ForwardToPrimary(file);
                    instanceMutex.Close();
                    if (forwarded)
                    {
                        WriteConsole("已转发给正在运行的 mdlight: " +
                                      (file ?? "<当前文件>"));
                        return 0;
                    }
                    // forwarding failed: fall through and open a new window
                }
                else
                {
                    // we are the primary — start the hot-open pipe listener
                    StartPipeListener();
                    // keep the mutex alive for the process lifetime
                    Gc.KeepAlive(instanceMutex);
                }
            }

`;
pr = pr.replace(docAnchor, singleInstanceBlock + docAnchor, 1);

// 4) Add the ForwardToPrimary + StartPipeListener methods just before PickFile
const pickAnchor = "        private static string PickFile()";
if (pr.indexOf(pickAnchor) < 0) { console.log('PickFile anchor not found'); process.exit(1); }

const methodsBlock = `        // ---------------------------------------------------------------------

        private static bool ForwardToPrimary(string filePath)
        {
            // Connect to the primary instance's hot-open pipe. The path is
            // transmitted as UTF-8 with a 4-byte little-endian length prefix.
            if (filePath == null)
                return false; // nothing to forward (the picker runs in the primary)
            try
            {
                using (NamedPipeClientStream pipe =
                        new NamedPipeClientStream(".", PipeName,
                        PipeDirection.Out))
                {
                    pipe.Connect(3000);
                    byte[] data = Encoding.UTF8.GetBytes(filePath);
                    byte[] header = BitConverter.GetBytes(data.Length);
                    pipe.Write(header, 0, 4);
                    pipe.Write(data, 0, data.Length);
                    pipe.Flush();
                }
                return true;
            }
            catch (Exception e)
            {
                Util.Log("ForwardToPrimary failed: " + e.Message);
                return false;
            }
        }

        private static void StartPipeListener()
        {
            // One server-side pipe instance; each incoming connection is handled
            // on a background thread so the UI thread is never blocked.
            Thread t = new Thread(new ParameterizedThreadStart(delegate(object arg)
            {
                try
                {
                    while (true)
                    {
                        NamedPipeServerStream srv =
                            new NamedPipeServerStream(PipeName, PipeDirection.In,
                                                      1,
                                                      PipeTransmissionMode.Byte,
                                                      PipeOptions.Asynchronous);
                        srv.WaitForConnection();
                        int len = 0;
                        byte[] header = new byte[4];
                        srv.Read(header, 0, 4);
                        len = BitConverter.ToInt32(header, 0);
                        if (len <= 0 || len > 65536) continue;
                        byte[] buf = new byte[len];
                        int read = 0;
                        while (read < len)
                        {
                            int n = srv.Read(buf, read, len - read);
                            if (n <= 0) break;
                            read += n;
                        }
                        if (read != len) { srv.Close(); continue; }
                        string path = Encoding.UTF8.GetString(buf, 0, read);
                        Util.Log("hot-open request: " + path);
                        if (File.Exists(path))
                        {
                            // Signal the UI thread to swap the doc. The Server
                            // instance is the one currently serving; we find it
                            // via the static currentDoc holder set in Main.
                            if (CurrentServer != null)
                            {
                                CurrentServer.SwapDoc(new Doc(path));
                                CurrentServer.Reload();
                            }
                        }
                        srv.Close();
                    }
                }
                catch (Exception e) { Util.Log("pipe listener error: " + e.Message); }
            }));
            t.IsBackground = true;
            t.Start();
        }

`;
pr = pr.replace(pickAnchor, methodsBlock + pickAnchor, 1);

// 5) Add the static CurrentServer field and set it in Main before ShowWindow
const serveAnchor = "            Server server = new Server(doc);";
if (pr.indexOf(serveAnchor) < 0) { console.log('server anchor not found'); process.exit(1); }
pr = pr.replace(serveAnchor,
  "            Server server = new Server(doc);\n            CurrentServer = server;", 1);

// 6) Add the static field declaration near the top of the class
const finalNativeAnchor = "        private static string finalNativeDir;";
if (pr.indexOf(finalNativeAnchor) < 0) { console.log('finalNativeDir anchor not found'); process.exit(1); }
pr = pr.replace(finalNativeAnchor,
  "        private static Server CurrentServer;\n        private static string finalNativeDir;", 1);

writeFileSync('native/Program.cs', pr);
console.log('feat6 done');
