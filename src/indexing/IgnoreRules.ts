import ignore, { Ignore } from 'ignore';
import picomatch from 'picomatch';

export type Excludes = Record<string, boolean | { when: string }>;
export interface RuleLayer { base: string; matcher: Ignore }
interface ExcludeMatcher { matches: (path: string) => boolean; value: true | { when: string } }
export class IgnoreRules {
    private readonly patterns: ExcludeMatcher[];
    constructor(readonly layers: readonly RuleLayer[] = [], private readonly excludes: Excludes = {},
        private readonly ignoreCase = process.platform !== 'linux', patterns?: ExcludeMatcher[]) {
        this.patterns = patterns ?? Object.entries(excludes).filter((entry): entry is [string, true | { when: string }] => !!entry[1])
            .map(([pattern, value]) => ({ matches: picomatch(pattern, { dot: true, nocase: ignoreCase }), value }));
    }
    extend(base: string, contents: string[]): IgnoreRules {
        return new IgnoreRules([...this.layers, { base, matcher: ignore({ ignorecase: this.ignoreCase }).add(contents.join('\n')) }], this.excludes, this.ignoreCase, this.patterns);
    }
    excluded(path: string, directory: boolean, siblings: ReadonlySet<string> = new Set()): boolean {
        let ignored = false;
        for (const layer of this.layers) {
            if (layer.base && !path.startsWith(layer.base + '/')) { continue; }
            const relative = layer.base ? path.slice(layer.base.length + 1) : path;
            if (!relative) { continue; }
            const result = layer.matcher.test(relative + (directory ? '/' : ''));
            if (result.ignored) { ignored = true; }
            else if (result.unignored) { ignored = false; }
        }
        if (ignored) { return true; }
        for (const { matches, value } of this.patterns) {
            if (!matches(path)) { continue; }
            if (value === true) { return true; }
            const filename = path.slice(path.lastIndexOf('/') + 1);
            const basename = filename.replace(/\.[^.]*$/, '');
            if (siblings.has(value.when.replaceAll('$(basename)', basename))) { return true; }
        }
        return false;
    }
}
