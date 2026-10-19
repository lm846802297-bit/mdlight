import { readFileSync, writeFileSync } from 'node:fs';
let s = readFileSync('mdlight.mjs', 'utf8');
// Find the buildPage call site for the live (non-export) path and set clientRender: true
// so the page renders via clientRender() like the native host, making parity meaningful.
// Locate where the page is served for live requests.
const i = s.indexOf("opts.clientRender");
console.log('clientRender refs:', s.match(/clientRender/g)?.length);
// Show context around buildPage definition
const j = s.indexOf('function buildPage');
console.log('buildPage at:', j);
process.exit(0);
