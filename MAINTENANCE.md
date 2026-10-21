# mdlight Maintenance Log

This is the chronological maintenance record for confirmed defects, fixes, verification evidence, and outstanding acceptance work. Statuses describe only what the linked evidence supports; automated CI does not count as manual desktop acceptance.

## 2026-10-21 — Restore split-view loading for a second Markdown document

### Status

- **Code fix:** merged into `main`.
- **Automated verification:** PR CI and post-merge `main` CI passed.
- **Manual Windows desktop acceptance:** pending.
- **Release:** no new version was published as part of this fix.

### Defect and root cause

The split-view feature requests a second Markdown file through `GET /api/doc?path=<encoded-path>`. The route was broken in both server implementations, in different ways:

1. The native C# host tried to match the query string against the URL path. The path component does not include the query string, so the second-document branch was not reached reliably.
2. The Node host did not implement the corresponding `GET /api/doc` route, leaving the two host implementations inconsistent.

The result was that the second Markdown document could fail to load in split view.

### Fix

- Added the missing Node `GET /api/doc` route. It reads the requested path from `url.searchParams` and returns the document source, SHA-256, path, and filename.
- Updated the native host to read the requested path from `HttpListenerRequest.QueryString`, rather than parsing it out of the path component.
- Aligned the native response to include the `name` field.
- Added regression assertions for second-document loading to:
  - `test/harden-check.mjs` (Node host)
  - `test/native-check.mjs` (native host)

### Commit and CI evidence

| Item | Result |
|---|---|
| Fix PR | [#1 — Restore split-view loading](https://github.com/lm846802297-bit/mdlight/pull/1) |
| PR head SHA tested | `9b4dfe5b842c08e5fee6023a03783827f1bfe54a` |
| PR CI | [Run 39522295392](https://github.com/lm846802297-bit/mdlight/actions/runs/39522295392) — **success** |
| Merge commit on `main` | `d0da3fa4044cd47ff7e8372e4466fbc9e4d122ff` |
| Post-merge `main` CI | [Run 39522920848](https://github.com/lm846802297-bit/mdlight/actions/runs/39522920848) — **success** |
| Verified main HEAD at time of recording | `d0da3fa4044cd47ff7e8372e4466fbc9e4d122ff` |

The post-merge Windows workflow completed dependency installation, WebView2 setup and DLL checks, Node bundle generation, native EXE build, the full `npm test` suite, and artifact upload successfully.

### Build artifact

- GitHub Actions artifact: `mdlight-exe`
- Reported artifact archive size: 2,368,938 bytes
- GitHub artifact digest: `sha256:be03169c4d207222d0d4d19badab1730f2224e01a06d2fe6b24bdc3fca1faf67`
- [Workflow artifacts](https://github.com/lm846802297-bit/mdlight/actions/runs/39522920848)
- Artifact expiration reported by GitHub: 2026-10-28 00:46:14 UTC

The digest above is the GitHub Actions artifact digest, not a separately calculated checksum of the extracted `mdlight.exe`.

### Pending manual acceptance

These checks have **not** been marked complete by CI and still need to be performed on a real Windows desktop:

- [ ] Launch the generated `mdlight.exe` and open a first Markdown document.
- [ ] Enable split view and load a second Markdown document; confirm the second pane renders the expected content.
- [ ] Repeat with a path containing spaces and/or non-ASCII characters.
- [ ] Confirm normal open, edit, save, and reload behavior for a document is unchanged.
- [ ] Confirm a missing or invalid second-document path fails gracefully rather than breaking the existing document view.

### Acceptance rule

Close the manual-acceptance items only after recording the actual Windows build/version tested and the observed results. If any check fails, record the reproduction steps and fix that defect before adding unrelated features.
