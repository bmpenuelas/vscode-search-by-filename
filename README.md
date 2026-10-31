# 🔎 Search by filename

Find files across your VS Code workspace with straightforward filename matching,
optional regular expressions, and optional include ignored files.

Fast search even on large workspaces with thousands of untracked files.

No changing search settings, no complicated workarounds, no searching through file contents. Just the filenames you need.

- **⌨️ Quick Search** — jump to a file from a native, keyboard-first picker. Run
  **Search by filename: Quick Search** from the Command Palette, or press
  **Ctrl+Alt+P** (**Cmd+Option+P** on macOS).
- **📂 A dedicated sidebar** — keep a search panel open while you work.
- **👀 Look beyond exclusions** — include files inside ignored folders such as
  `node_modules`, `dist`, and `build` when you need them.
- **🎯 Literal or regex matching** — use a simple substring or a precise pattern.
- **🔤 Your choice of case** — switch between case-insensitive and case-sensitive matching.
- **🗂️ Multi-root friendly** — search all open workspace folders and see where each match lives.
- **💾 Remembered preferences** — both search interfaces share your workspace's toggle choices.
- **🔒 Private and minimal** — no external binaries, telemetry, or network requests.

## 🚀 Get started

1. Open a folder or workspace in VS Code.
2. Press **Ctrl+Alt+P** on Windows/Linux or **Cmd+Option+P** on macOS.
3. Type part of a filename, choose a result with the arrow keys, and press **Enter**.

Prefer a panel? Click the **folder-and-magnifying-glass icon** in the Activity Bar,
or run **Search by filename: Focus Search** from the Command Palette.

> 💡 Your usual **Ctrl+P / Cmd+P** shortcut is unchanged. Search by filename has its own shortcut.

## 🎛️ Three small toggles, more control

Both the sidebar and Quick Search put these options inside the search field.
Changing one keeps your search text intact.

| Toggle | What it does | Default |
|---|---|---|
| **Aa · Ignore case** | Match `App.ts` when you type `app`. Turn it off to match case exactly. | On |
| **.* · Regular expression** | Treat your query as a JavaScript regex instead of a literal substring. | Off |
| **⊘ · Include ignored** | Also look inside ignored and excluded folders, and include excluded files. | Off |

**Need a file your normal search doesn't show?** Turn on **Include ignored** to
search beyond `.gitignore`, nested ignore files, and the usual file/search exclusions.
Dotfiles such as `.env` are discoverable too.

> 📌 Toggle choices are remembered per workspace. Explicit user/workspace settings take
> precedence when you reload the window or change the relevant option settings.

## 🧩 Try a few searches

| Search | Mode | Example matches |
|---|---|---|
| `app` | Literal, ignore case on | `App.ts`, `app.test.ts`, `MyApp.tsx` |
| `package.json` | Literal | `package.json` |
| `.test.` | Literal | `app.test.ts`, `login.test.js` |
| `^app.*\.tsx?$` | Regex, ignore case on | `App.ts`, `app.test.tsx` |
| `\.test\.[tj]s$` | Regex | `app.test.ts`, `login.test.js` |

Searches match **filenames**, not folder paths. In literal mode, exact names and
filename prefixes appear ahead of other substring matches. In regex mode, enter the pattern without
surrounding `/` characters; invalid patterns show an error so you can correct them.

### Commands

Find these in the Command Palette:

| Command | What it does |
|---|---|
| **Search by filename: Quick Search** | Open the keyboard-first file picker |
| **Search by filename: Focus Search** | Open and focus the sidebar search |
| **Search by filename: Refresh Index** | Update the file list manually; also available in the sidebar toolbar |

To change the shortcut, open **Preferences: Open Keyboard Shortcuts** and search
for **Search by filename: Quick Search**.

## ⚙️ Settings

Find these options in VS Code Settings by searching for **Search by filename**.

| Setting | Default | What you can change |
|---|---|---|
| `searchByFilename.ignoreCase` | `true` | Start with case-insensitive matching |
| `searchByFilename.useRegex` | `false` | Start in regex mode |
| `searchByFilename.includeIgnored` | `false` | Include ignored and excluded files by default |
| `searchByFilename.openInPreview` | `true` | Open results in preview editors |
| `searchByFilename.maxResults` | `200` | Initial result count, from 1 to 2,000 |
| `searchByFilename.maxIndexedFiles` | `500000` | Maximum cached files; increase it if the file-limit warning appears |

## 💡 Good to know

- **First search still loading?** Large workspaces can take a little time to prepare.
  Including ignored dependency/generated folders can take longer and use more memory.
- **Created, renamed, or deleted a file?** The list updates automatically where filesystem
  notifications are available. If a change is missing, run **Refresh Index**.
- **Seeing an "INCOMPLETE" warning?** A file limit or an unreadable location prevented a
  complete search. Increase the configured limit or check access, then refresh.
- **Using unusual ignore rules?** Global and parent-directory ignore files are not applied,
  and symbolic links are skipped. This is not an exact copy of VS Code's built-in search behavior.
- **Working remotely?** Local and multi-root workspaces, Remote SSH, WSL, and Dev Containers
  are supported when the filesystem provider supports the necessary operations.
  Requires **VS Code 1.109+**; browser-only VS Code is not supported.

The extension searches filenames and opens your selected files. It does not modify,
delete, rename, or upload your workspace files.

## 🤝 Feedback & more

Found a bug or have an idea? [Open an issue](https://github.com/bmpenuelas/vscode-search-by-filename/issues).

- [Source code](https://github.com/bmpenuelas/vscode-search-by-filename)
- [Changelog](CHANGELOG.md)
- [Developer guide](DEVELOPMENT.md) — architecture, implementation details, compatibility
  notes, building, debugging, testing, benchmarks, and publishing
- [License](LICENSE) · [Third-party notices](THIRD_PARTY_NOTICES.md)
