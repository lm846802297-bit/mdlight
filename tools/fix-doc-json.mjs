import { readFileSync, writeFileSync } from 'node:fs';
let cs = readFileSync('native/Server.cs', 'utf8');
// SendJson takes (res, string jsonBody) — anonymous objects are invalid.
// Convert the three broken calls to string-concatenated JSON.
const old1 = 'SendJson(res, new { ok = false, error = "not found" });';
const new1 = 'SendJson(res, "{\\"ok\\":false,\\"error\\":\\"not found\\"}");';
cs = cs.replace(old1, new1);

const old2 = 'SendJson(res, new { ok = true, source = src, path = p, sha = sha });';
const new2 = 'SendJson(res, "{\\"ok\\":true,\\"source\\":" + Util.JsonStr(src) + ",\\"path\\":" + Util.JsonStr(p) + ",\\"sha\\":" + Util.JsonStr(sha) + "}");';
cs = cs.replace(old2, new2);

const old3 = 'SendJson(res, new { ok = false, error = ex.Message });';
const new3 = 'SendJson(res, "{\\"ok\\":false,\\"error\\":" + Util.JsonStr(ex.Message) + "}");';
cs = cs.replace(old3, new3);

writeFileSync('native/Server.cs', cs);
console.log('doc route SendJson calls fixed');
