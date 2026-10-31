import { Options } from '../search/SearchTypes';

interface SidebarAssets {
    nonce: string;
    cspSource: string;
    styleUri: string;
    scriptUri: string;
    options: Options;
}

/** Only trusted extension asset URIs and option booleans enter this template. */
export function sidebarHtml(assets: SidebarAssets): string {
    const toggle = (key: keyof Options, label: string, icon: string) =>
        `<button type="button" data-option="${key}" aria-label="${label}" aria-pressed="${assets.options[key]}" title="${label}"><span class="codicon ${icon}" aria-hidden="true"></span></button>`;
    return `<!doctype html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${assets.cspSource}; img-src ${assets.cspSource}; script-src 'nonce-${assets.nonce}';">
  <link rel="stylesheet" href="${assets.styleUri}">
</head>
<body>
  <div class="search" role="search" aria-label="Search by filename">
    <input id="query" type="text" aria-label="Search filenames" placeholder="Search filenames" maxlength="512" spellcheck="false" autocomplete="off">
    <div class="toggles" role="group" aria-label="Search options">
      ${toggle('ignoreCase', 'Ignore case', 'case-sensitive')}
      ${toggle('useRegex', 'Regular expression', 'regex')}
      ${toggle('includeIgnored', 'Include ignored and excluded files', 'exclude')}
    </div>
  </div>
  <p id="status" role="status" aria-live="polite">Preparing search…</p>
  <div id="results" aria-label="Matching files"></div>
  <button id="more" type="button" hidden>Show more results</button>
  <script nonce="${assets.nonce}" src="${assets.scriptUri}"></script>
</body>
</html>`;
}
