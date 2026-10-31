# Developer guide

Architecture, implementation details, maintenance, and release instructions for
**Search by filename**. For features and everyday usage, see the [README](README.md).

## Project map

| Component | Responsibility |
|---|---|
| `src/extension.ts` | Activation, shared services, commands, and disposal |
| `src/indexing/FileScanner.ts` | Bounded, iterative filesystem traversal |
| `src/indexing/IgnoreRules.ts` | Inherited ignore rules and compiled setting globs |
| `src/indexing/FileIndex.ts` | Shared URI index, normal/expanded discovery, and reconciliation |
| `src/indexing/IndexWatcher.ts` | Filesystem event batching and configuration invalidation |
| `src/search/match.ts` | Literal/regex matching, deterministic ranking, and bounded top-K selection |
| `src/search/SearchEngine.ts` and `worker.ts` | Worker mirror, deadlines, cancellation, and recovery |
| `src/settings/SettingsManager.ts` | Shared option state, workspace persistence, and configuration precedence |
| `src/ui/` | Shared search sessions, native QuickPick, sidebar, and validated file opening |
| `media/` and `resources/` | Bundled sidebar assets and theme-aware icons |
| `src/test/` and `scripts/` | Unit/integration tests, build tooling, and benchmarks |

## Search behavior and ordering

Literal search matches filename substrings, not paths or contents. For example, `app` matches `App.ts`; `^app.*\.ts$` works in regex mode. Invalid expressions show an error with no stale matches. Literal ranking is exact name, prefix, then substring; ties prefer shorter filenames, shorter paths, then deterministic path/URI order. Regex and empty-query results use the same deterministic tie-breakers.

Initial results are limited to 200. **Show more results** increases the limit up to 2,000; counts distinguish matching files from rendered files. Files open in preview editors unless configured otherwise. Non-text resources/providers that cannot open in a text editor produce a concise error.

## How discovery works

The extension activates only when its commands or view are used. `FileScanner` traverses with `workspace.fs.readDirectory`, an iterative queue, eight concurrent directory reads, and event-loop yields (including within very large directories). It never reads ordinary file contents. Bounded ignore files are the only workspace content read.

**Normal mode** loads root/nested `.gitignore`, `.ignore`, and `.rgignore` rules, in that order, honoring negation, anchoring, directory patterns and inherited rules. It applies effective per-root `files.exclude` and `search.exclude` settings. Excluded directories are recorded as a frontier and **not traversed**. Already-listed excluded files are retained with a normal-mode visibility flag. Dotfiles are not inherently hidden. `search.useIgnoreFiles: false` disables ignore-file rules, but not setting-based exclusions.

**Include ignored** traverses that pruned frontier with filtering disabled. This really reads directories such as `node_modules` and `dist`; it does not depend on the completeness of native search results. Already-scanned normal directories are reused. Switching back filters the same metadata rather than rescanning. Both modes use a single URI-keyed host index, not two complete filesystem indexes. The cached expanded index remains available until refresh/reconfiguration.

Multiple roots retain separate URI identities and ignore contexts; paths include workspace names when needed. Exact original URIs, including non-file schemes, are used to open files. The extension runs in the workspace extension host for Remote SSH, WSL, and containers; arbitrary filesystem providers must implement `readDirectory`, `readFile`, and `stat` reliably. Browser-only VS Code is not supported because search isolation uses Node worker threads.

## Incremental maintenance and invalidation

- Per-root VS Code watchers collect creation/deletion/change events in 150 ms batches. Changed parents are reconciled once per batch. Existing subdirectories are not walked again; new subtrees are scanned, deleted descendants are purged in a batched pass. Renames work as delete/create pairs, including file/directory replacements.
- Sibling-dependent excludes (`{"when":"$(basename).ts"}`) are reevaluated when that directory changes.
- Ignore-file edits rebuild the affected **workspace root**, preserving other roots. This conservative scope refreshes inherited nested rule contexts correctly.
- Exclusion/ignore settings and index-limit changes refresh the index. Workspace-folder changes recreate watchers and rebuild the roots, releasing removed metadata. Typing never invalidates filesystem caches or initiates a workspace traversal.
- Provider watcher events may be missed and recursive watchers can respect `files.watcherExclude`, especially inside dependency/generated directories. There is **no periodic full scan**. Newly reported subtrees get targeted scans; use manual refresh for unreported changes. `files.watcherExclude` is not treated as a search exclusion.

## Settings and persistence

| Setting | Default | Purpose |
|---|---|---|
| `searchByFilename.ignoreCase` | `true` | Initial case toggle |
| `searchByFilename.useRegex` | `false` | Initial regex toggle |
| `searchByFilename.includeIgnored` | `false` | Initial ignored-files toggle |
| `searchByFilename.openInPreview` | `true` | Preview editors |
| `searchByFilename.maxResults` | `200` | Initial result page size (1–2,000) |
| `searchByFilename.maxIndexedFiles` | `500000` | Cached file cap across all roots (1,000–2,000,000) |

Runtime toggles are saved in workspace state without modifying settings or ignore files. On activation or option-configuration changes: **explicit workspace settings > explicit user settings > saved workspace toggle state > defaults**. During a session a toggle is an immediate override until the next reload or relevant configuration change. Options are workspace-window-wide; exclusion rules remain folder-specific.

The index cap includes excluded files already seen in scanned directories. A cap or read error explicitly reports **INCOMPLETE**, preserving completed work. Increase the cap and refresh to continue. All symlinks (including file symlinks) are skipped, so the extension never follows directory cycles or symlink targets outside workspace roots. There is intentionally no follow-symlink option.

## Performance and safety

Search uses a dedicated, lazily initialized worker with an incremental compact metadata mirror. This additional memory is intentional: JavaScript regex can block inside a single `.test()`, so cooperative cancellation alone is insufficient. Queries are at most 512 characters; regex searches have a 1.5 s wall-clock budget, literal searches 15 s. Exceeding the budget terminates the worker and clears results; a later query rebuilds the mirror. Cancelling a running regex also terminates that worker, which may cancel another interface's concurrent search; retry if shown an error. Budgets include worker queue/transport overhead, not just regex evaluation, and can reject a legitimate expensive expression. This is a responsiveness guard, not a claim to statically identify unsafe regex.

Names are normalized once during discovery. Each query compiles its matcher once without stateful `g`/`y` flags. A bounded max heap selects top K in O(N log K), retaining O(K) results instead of sorting every match. Search yields between batches. Generation IDs and abort signals prevent late queries from replacing newer results. Native QuickPick items use `alwaysShow` to prevent secondary fuzzy filtering from hiding regex matches. UI updates are debounced 45 ms; index progress is throttled while index deltas remain incremental. No heavyweight trigram index is built.

The minimal sidebar uses only bundled assets, a nonce/CSP, DOM `textContent`, accessible buttons, theme colors and bounded rendering (at most 2,000 results). Host messages validate option/query types; opaque result tokens resolve only to current indexed URIs. The extension never writes, deletes, renames or uploads workspace files, executes shell commands, or launches external search tools. Build/test tooling is separate and does use standard development processes.

### Known compatibility limits

- This is not perfect parity with VS Code's internal ripgrep search. Global Git excludes, `.git/info/exclude`, parent-directory ignore files, and `search.useGlobalIgnoreFiles` / `search.useParentIgnoreFiles` are not implemented. Ignore-file inputs larger than 1 MiB are skipped with an incomplete-index warning. Git-style re-inclusion cannot resurrect a file beneath a pruned ignored parent: re-include the parent first.
- Conditional excludes support `$(basename)` and same-directory siblings, not arbitrary expressions. Glob matching uses picomatch's compatible common glob syntax; unusual escaping/absolute-path patterns can differ from VS Code. For an identical settings key, `search.exclude` overrides `files.exclude`; false cancels that merged rule.
- Ignore/glob case behavior follows the workspace extension host platform (insensitive on Windows/macOS, sensitive on Linux); unusual case-sensitive macOS volumes and custom providers with different casing rules can differ.
- Providers may return an entire giant directory in one `readDirectory` call; that provider-owned allocation cannot be streamed or cancelled. Work is bounded/yielded after the call. Some providers omit watcher events or unsupported file types; refresh is the recovery mechanism. All symbolic-link entries are skipped.
- Expanded discovery can be I/O- and memory-intensive. The worker mirror adds memory beyond the host URI index. Lower `maxIndexedFiles` on constrained remote machines. A file cap does not bound the number of empty directories or filesystem-provider response size.

## Build, debug, test, install

Use Node.js 22+ and npm. On Windows PowerShell with script execution disabled, use `npm.cmd` instead of `npm`.

```sh
npm ci
npm run compile
npm run lint
npm test
npm run test:integration
npm run test:debug
npm run test:ui
npm run benchmark
npm run package
```

Open this folder in VS Code and press **F5** to launch an Extension Development Host. `npm run watch` rebuilds during development.

### Debug launch configuration

Select **Run Search by filename** and press **F5**. The launch configuration has
been restored to its original development-path-only arguments: no forced runtime,
no extra workspace argument, and no disabling of other installed extensions.
The attach-only fallback remains removed. We are reintroducing the earlier
workaround settings **one at a time** to identify which change affects the crash.
The first experiment sets only `debug.javascript.enableNetworkView` to `false` in
workspace settings; all launch arguments remain at their original values.

For this experiment, run **Developer: Reload Window**, select **Run Search by
filename**, and try F5 several times. Record whether the host stays open before
changing another setting. If disabling network inspection appears to help,
temporarily remove that override and repeat the same launches to confirm the
result. Do not infer the cause from a single successful start: the prior failure
was intermittent. The result in the user's installed editor is still pending.

If startup problems return, **Ctrl+F5** helps distinguish a debugger/bootstrap
issue from an extension activation failure. Check the Extension Host and main
logs before changing editor settings. No global user settings were changed by
the earlier workaround or its removal.

`npm run test:debug` remains available as an optional real-debugger smoke test.
It uses an isolated profile and temporary driver extension, launches the configured
`extensionHost`, waits ten seconds, and checks that the child host responds to
debugger evaluation. It uses available workspace settings without forcing network
inspection off. The runner must use a different driver extension from the target
and clear the child's inherited `--extensionTestsPath`, to avoid reloading the
runner or recursively executing tests in the debuggee. It accepts `VSCODE_VERSION`
and `VSCODE_EXECUTABLE_PATH`; the default version is stable. Earlier passing smoke
results with the workaround do not verify F5 with the restored defaults.

Unit tests use a test-only VS Code adapter plus real temporary workspace files and real worker threads. They exercise matching/ranking, ignore rules, expanded discovery, batched watcher updates, symlink skipping, limits/errors, remote URI preservation, QuickPick toggles/filter bypass, persistence, stale-result cancellation and opening validation. The integration runner downloads VS Code **1.109.0** and checks manifest contributions, activation, real directory discovery, stable inline-toggle APIs and commands. Set `VSCODE_VERSION` to another version or `stable`, or `VSCODE_EXECUTABLE_PATH` to a local executable. Visual theme/screen-reader behavior still warrants manual testing on target platforms; API tests do not assert rendered pixels.

`npm run package` produces `search-by-filename-1.0.0.vsix`. Install with **Extensions: Install from VSIX…**, or `code --install-extension search-by-filename-1.0.0.vsix`. The VSIX contains only the host/worker bundles, sidebar assets, icon, manifest and notices/docs; runtime JavaScript dependencies are bundled. Nothing is published automatically. The publisher ID is `bmpenuelas` and the extension ID is `bmpenuelas.search-by-filename`. Source and issues are hosted at [bmpenuelas/vscode-search-by-filename](https://github.com/bmpenuelas/vscode-search-by-filename).

## Dependencies

- **ignore**: established, pure-JavaScript Git-style rule/negation matching; avoids an incomplete home-grown parser.
- **picomatch**: pure-JavaScript glob matching for VS Code-style setting excludes; compiled matchers are reused.
- Three bundled **Microsoft Codicons** SVGs (CC BY 4.0) provide the native option-toggle shapes without a runtime icon/font dependency. The Activity Bar uses a custom theme-tinted folder-and-magnifying-glass SVG to distinguish it from native Search.
- Development only: TypeScript, pinned minimum-version VS Code types, Node/picomatch types, esbuild, ESLint/typescript-eslint, `@vscode/test-electron`, `@vscode/vsce`, and `playwright-core` for browser layout tests. Open VSX publishing invokes `ovsx` through npx, matching the sibling project. No development package is required by the installed extension. See `THIRD_PARTY_NOTICES.md` for bundled licenses.

### Sidebar layout and browser verification

The filename input and three toggles share one flex-based search control with a
single themed background, border and focus outline. The input shrinks independently
of the fixed-width toggle group, preventing text overlap and keeping the buttons
inside the field at narrow widths. The toggles remain normal keyboard-focusable
buttons with accessible names and `aria-pressed` state. `src/ui/sidebarHtml.ts`
provides the same restrictive-CSP HTML to the real webview and browser tests.

Run `npm run test:ui` with Microsoft Edge installed, or set
`UI_BROWSER_EXECUTABLE` to an existing Chrome/Chromium-compatible executable.
The test does not download a browser. It serves only bundled assets over loopback,
uses a temporary headless browser profile, and checks dark, light and high-contrast
theme variables at widths of 360, 220 and 150 pixels. Checks cover field/toggle
geometry, horizontal overflow, query retention, option messages, pressed states,
keyboard focus and CSP/browser errors. Theme screenshots are written under
`.test-workspaces/sidebar-ui/`. These tests emulate the webview's theme variables;
they do not replace screen-reader or real VS Code theme testing.

## Verification and benchmarks

See `BENCHMARKS.json` for reproducible raw measurements. On Windows x64 / Node 24.21.0, warmed median search times (five runs, top 200) were:

| Synthetic files | Construct metadata | Literal | Sensitive | Regex | Empty-query top K |
|---:|---:|---:|---:|---:|---:|
| 1,000 | 1.02 ms | 0.27 ms | 0.10 ms | 0.13 ms | 0.46 ms |
| 10,000 | 11.24 ms | 2.14 ms | 0.66 ms | 0.92 ms | 0.97 ms |
| 100,000 | 114.50 ms | 7.11 ms | 7.18 ms | 5.49 ms | 6.07 ms |
| 500,000 | 662.29 ms | 27.24 ms | 26.24 ms | 21.93 ms | 18.06 ms |

These measure in-memory synthetic construction/search, **not filesystem discovery, worker startup/transport or UI latency**. At 500,000 entries, insertion/deletion of 1,000 entries took 0.47/0.05 ms; approximate unforced-GC metadata heap delta was 180.6 MiB (excludes Uri objects and worker mirror). Metadata construction/memory dominate warmed matching, so the implementation avoids heavyweight search indexes, reuses excluded-directory discovery, compiles globs once, streams worker initialization in yielding chunks and avoids resending unchanged sibling entries. Real traversal latency depends strongly on storage/providers. There are no timing assertions in ordinary tests.

## Documentation and licensing maintenance

`THIRD_PARTY_NOTICES.md` retains the bundled libraries' MIT texts and the copied
Codicons' CC BY attribution. Update it if bundled libraries or artwork change.
The Activity Bar folder-and-magnifying-glass icon is original MIT-licensed project
artwork. `.vscodeignore` explicitly includes the README, this guide, and notices
in the VSIX alongside the runtime assets.

## Store and Activity Bar icons

The top-level manifest icon references the supplied 256x256 PNG at
`resources/icon.png`. It is included in the VSIX without being regenerated or
modified by the build. `resources/search.svg` is a separate 24px monochrome
folder-and-magnifying-glass design matching the PNG composition, with simplified
list marks for small sizes. VS Code tints the Activity Bar SVG to match the theme;
the Marketplace retains the PNG's original colors.
