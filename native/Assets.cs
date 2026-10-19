using System;
using System.Collections.Generic;
using System.IO;
using System.Reflection;
using System.Text;

namespace Mdlight
{
    /// <summary>
    /// Reads the single packed asset blob embedded as the manifest resource
    /// "mdl.pack" (written by tools/build-native.mjs).
    ///
    /// Layout:  MAGIC "MDLPACK1" (8) | u32le indexLen | index | payload
    /// index:   "served/path\toffset\tlength\n" per asset
    ///
    /// One blob instead of ~130 individual resources: ManageEmbeddedResources
    /// lookups stay cheap and the exe has a single opaque payload.
    /// </summary>
    internal static class Assets
    {
        private struct Slice
        {
            public int Offset;
            public int Length;
        }

        private static Dictionary<string, Slice> index;
        private static byte[] payload;
        private static readonly object gate = new object();

        public static void Init()
        {
            lock (gate)
            {
                if (index != null) return;

                Assembly asm = Assembly.GetExecutingAssembly();
                using (Stream st = asm.GetManifestResourceStream("mdl.pack"))
                {
                    if (st == null)
                        throw new InvalidOperationException(
                            "资源包 mdl.pack 缺失 — 这个 exe 是用不完整的方式构建的");
                    byte[] all = Util.ReadAll(st);
                    if (all.Length < 12 ||
                        Encoding.ASCII.GetString(all, 0, 8) != "MDLPACK1")
                        throw new InvalidOperationException("资源包格式不符");

                    int idxLen = BitConverter.ToInt32(all, 8);
                    string text = Encoding.UTF8.GetString(all, 12, idxLen);
                    payload = new byte[all.Length - 12 - idxLen];
                    Buffer.BlockCopy(all, 12 + idxLen, payload, 0, payload.Length);

                    Dictionary<string, Slice> map =
                        new Dictionary<string, Slice>(StringComparer.Ordinal);
                    string[] lines = text.Split('\n');
                    for (int i = 0; i < lines.Length; i++)
                    {
                        string line = lines[i];
                        if (line.Length == 0) continue;
                        string[] p = line.Split('\t');
                        if (p.Length != 3) continue;
                        Slice s;
                        s.Offset = int.Parse(p[1]);
                        s.Length = int.Parse(p[2]);
                        map[p[0]] = s;
                    }
                    index = map;
                }
            }
        }

        public static bool Has(string name)
        {
            Init();
            return index.ContainsKey(name);
        }

        /// <summary>Returns a fresh copy, or null when the pack has no such asset.</summary>
        public static byte[] Get(string name)
        {
            Init();
            Slice s;
            if (!index.TryGetValue(name, out s)) return null;
            byte[] buf = new byte[s.Length];
            Buffer.BlockCopy(payload, s.Offset, buf, 0, s.Length);
            return buf;
        }

        public static string GetText(string name)
        {
            byte[] b = Get(name);
            return b == null ? null : Encoding.UTF8.GetString(b);
        }

        public static int Count
        {
            get { Init(); return index.Count; }
        }
    }
}
