import { Lexer, type Token, type Tokens } from 'marked';

// ─── Types ─────────────────────────────────────────────────────────────────

interface FormatCtx {
    type: 'strong' | 'em' | 'del' | 'codespan';
    open: string;
    close: string;
}

export interface ContentRun {
    text: string;
    formats: FormatCtx[];
}

export interface FlattenResult {
    runs: ContentRun[];
    contentLength: number;
}

// ─── Helpers ───────────────────────────────────────────────────────────────

function formatsEqual(a: FormatCtx[], b: FormatCtx[]): boolean {
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) {
        if (a[i].type !== b[i].type || a[i].open !== b[i].open) return false;
    }
    return true;
}

function detectDelimiter(raw: string, type: 'strong' | 'em' | 'del' | 'codespan'): { open: string; close: string } {
    if (type === 'del') return { open: '~~', close: '~~' };
    if (type === 'codespan') return { open: '`', close: '`' };
    if (type === 'strong') {
        return raw.startsWith('**') ? { open: '**', close: '**' } : { open: '__', close: '__' };
    }
    // em
    return raw.startsWith('*') ? { open: '*', close: '*' } : { open: '_', close: '_' };
}

// ─── flattenMarkdown ───────────────────────────────────────────────────────

export function flattenMarkdown(markdown: string): FlattenResult {
    const tokens = Lexer.lex(markdown, { gfm: true });
    const runs: ContentRun[] = [];

    function pushRun(text: string, formats: FormatCtx[]): void {
        if (!text) return;
        if (runs.length > 0 && formatsEqual(runs[runs.length - 1].formats, formats)) {
            runs[runs.length - 1].text += text;
        } else {
            runs.push({ text, formats: [...formats] });
        }
    }

    function walkInline(toks: Token[], formatStack: FormatCtx[]): void {
        for (const tok of toks) {
            switch (tok.type) {
                case 'strong':
                case 'em':
                case 'del': {
                    const t = tok as Tokens.Strong | Tokens.Em | Tokens.Del;
                    const delim = detectDelimiter(t.raw, tok.type);
                    const ctx: FormatCtx = { type: tok.type, ...delim };
                    const newStack = [...formatStack, ctx];
                    if (t.tokens.length > 0) {
                        walkInline(t.tokens, newStack);
                    } else {
                        pushRun(t.text, newStack);
                    }
                    break;
                }
                case 'codespan': {
                    const t = tok as Tokens.Codespan;
                    const ctx: FormatCtx = { type: 'codespan', open: '`', close: '`' };
                    pushRun(t.text, [...formatStack, ctx]);
                    break;
                }
                case 'text': {
                    const t = tok as Tokens.Text;
                    if (t.tokens && t.tokens.length > 0) {
                        walkInline(t.tokens, formatStack);
                    } else {
                        pushRun(t.text, formatStack);
                    }
                    break;
                }
                case 'escape': {
                    pushRun((tok as Tokens.Escape).text, formatStack);
                    break;
                }
                case 'br': {
                    pushRun('\n', formatStack);
                    break;
                }
                case 'link': {
                    const t = tok as Tokens.Link;
                    if (t.tokens.length > 0) {
                        walkInline(t.tokens, formatStack);
                    } else {
                        pushRun(t.text, formatStack);
                    }
                    break;
                }
                case 'image': {
                    pushRun((tok as Tokens.Image).text, formatStack);
                    break;
                }
                default:
                    if ('text' in tok && typeof tok.text === 'string') {
                        pushRun(tok.text, formatStack);
                    }
                    break;
            }
        }
    }

    function walkBlock(blockToks: Token[]): void {
        for (let i = 0; i < blockToks.length; i++) {
            const tok = blockToks[i];

            switch (tok.type) {
                case 'paragraph': {
                    const t = tok as Tokens.Paragraph;
                    if (t.tokens.length > 0) {
                        walkInline(t.tokens, []);
                    } else {
                        pushRun(t.text, []);
                    }
                    if (i < blockToks.length - 1) {
                        pushRun('\n\n', []);
                    }
                    break;
                }
                case 'heading': {
                    const t = tok as Tokens.Heading;
                    const prefix = '#'.repeat(t.depth) + ' ';
                    pushRun(prefix, []);
                    if (t.tokens.length > 0) {
                        walkInline(t.tokens, []);
                    } else {
                        pushRun(t.text, []);
                    }
                    if (i < blockToks.length - 1) {
                        pushRun('\n\n', []);
                    }
                    break;
                }
                case 'blockquote': {
                    const t = tok as Tokens.Blockquote;
                    pushRun('> ', []);
                    if (t.tokens.length > 0) {
                        walkBlock(t.tokens);
                    }
                    if (i < blockToks.length - 1) {
                        pushRun('\n\n', []);
                    }
                    break;
                }
                case 'list': {
                    const t = tok as Tokens.List;
                    for (let j = 0; j < t.items.length; j++) {
                        const item = t.items[j];
                        const startNum = t.start !== '' ? t.start + j : j + 1;
                        const marker = t.ordered ? `${String(startNum)}. ` : '- ';
                        pushRun(marker, []);
                        if (item.tokens.length > 0) {
                            walkBlock(item.tokens);
                        } else {
                            pushRun(item.text, []);
                        }
                        if (j < t.items.length - 1) {
                            pushRun('\n', []);
                        }
                    }
                    if (i < blockToks.length - 1) {
                        pushRun('\n\n', []);
                    }
                    break;
                }
                case 'hr': {
                    pushRun('---', []);
                    if (i < blockToks.length - 1) {
                        pushRun('\n\n', []);
                    }
                    break;
                }
                case 'code': {
                    pushRun((tok as Tokens.Code).text, []);
                    if (i < blockToks.length - 1) {
                        pushRun('\n\n', []);
                    }
                    break;
                }
                case 'space': {
                    pushRun('\n\n', []);
                    break;
                }
                default: {
                    if ('tokens' in tok && Array.isArray(tok.tokens)) {
                        walkInline(tok.tokens, []);
                    } else if ('text' in tok && typeof tok.text === 'string') {
                        pushRun(tok.text, []);
                    }
                    if (i < blockToks.length - 1) {
                        pushRun('\n\n', []);
                    }
                    break;
                }
            }
        }
    }

    walkBlock(tokens);

    let contentLength = 0;
    for (const run of runs) {
        contentLength += run.text.length;
    }

    return { runs, contentLength };
}

// ─── reconstructMarkdown ───────────────────────────────────────────────────

export function reconstructMarkdown(runs: ContentRun[], contentTarget: number): string {
    let out = '';
    let emitted = 0;
    const openFormats: FormatCtx[] = [];

    for (const run of runs) {
        if (emitted >= contentTarget) break;

        // Compute format transition: find longest common prefix
        let commonLen = 0;
        while (
            commonLen < openFormats.length &&
            commonLen < run.formats.length &&
            openFormats[commonLen].type === run.formats[commonLen].type &&
            openFormats[commonLen].open === run.formats[commonLen].open
        ) {
            commonLen++;
        }

        // Close removed formats inner→outer
        for (let i = openFormats.length - 1; i >= commonLen; i--) {
            out += openFormats[i].close;
        }
        openFormats.length = commonLen;

        // Open new formats outer→inner
        for (let i = commonLen; i < run.formats.length; i++) {
            out += run.formats[i].open;
            openFormats.push(run.formats[i]);
        }

        // Emit content (possibly truncated)
        const remaining = contentTarget - emitted;
        if (run.text.length <= remaining) {
            out += run.text;
            emitted += run.text.length;
        } else {
            out += run.text.slice(0, remaining);
            emitted += remaining;
        }
    }

    // Close all remaining open formats inner→outer
    for (let i = openFormats.length - 1; i >= 0; i--) {
        out += openFormats[i].close;
    }

    return out;
}

// ─── reconstructMarkdownPartial ────────────────────────────────────────────

/**
 * Like `reconstructMarkdown` but only applies formatting delimiters to FULLY
 * revealed runs. The currently-being-typed (partial) run gets no delimiters,
 * avoiding CommonMark flicker where `*text *` (space before closing `*`) toggles
 * between italic and literal on each character.
 *
 * Parent formatting from earlier complete runs is preserved through partial runs
 * (e.g. if an outer `**strong**` span is still open, the partial text inside it
 * remains bold).
 */
export function reconstructMarkdownPartial(runs: ContentRun[], contentTarget: number): string {
    let out = '';
    let emitted = 0;
    const openFormats: FormatCtx[] = [];

    /**
     * Close formats from `openFormats[from]` down to `openFormats[to]` (inclusive).
     * Moves trailing whitespace in `out` outside the closing delimiters so that
     * CommonMark doesn't reject them (e.g. `**bold **` → `**bold** `).
     */
    function closeFormats(from: number, to: number): void {
        if (from < to) return;

        // Extract trailing spaces so closing delimiters are adjacent to non-space text
        let trailing = '';
        while (out.length > 0 && out[out.length - 1] === ' ') {
            trailing += ' ';
            out = out.slice(0, -1);
        }

        for (let i = from; i >= to; i--) {
            out += openFormats[i].close;
        }
        openFormats.length = to;

        out += trailing;
    }

    for (const run of runs) {
        if (emitted >= contentTarget) break;

        const remaining = contentTarget - emitted;
        const isFullyRevealed = run.text.length <= remaining;

        // Find longest common prefix between current open formats and run's formats
        let commonLen = 0;
        while (
            commonLen < openFormats.length &&
            commonLen < run.formats.length &&
            openFormats[commonLen].type === run.formats[commonLen].type &&
            openFormats[commonLen].open === run.formats[commonLen].open
        ) {
            commonLen++;
        }

        if (isFullyRevealed) {
            // Full run — apply formatting transitions normally
            closeFormats(openFormats.length - 1, commonLen);

            for (let i = commonLen; i < run.formats.length; i++) {
                out += run.formats[i].open;
                openFormats.push(run.formats[i]);
            }

            out += run.text;
            emitted += run.text.length;
        } else {
            // Partial run — close formats not in this run's stack,
            // but DON'T open new formats (avoids flicker)
            closeFormats(openFormats.length - 1, commonLen);

            out += run.text.slice(0, remaining);
            emitted += remaining;
        }
    }

    // Close all remaining open formats
    closeFormats(openFormats.length - 1, 0);

    return out;
}

// ─── extractCleanText ──────────────────────────────────────────────────────

export function extractCleanText(markdown: string): string {
    const tokens = Lexer.lex(markdown, { gfm: true });
    const parts: string[] = [];

    function walkInline(toks: Token[]): void {
        for (const tok of toks) {
            switch (tok.type) {
                case 'strong':
                case 'em':
                case 'del': {
                    const t = tok as Tokens.Strong | Tokens.Em | Tokens.Del;
                    if (t.tokens.length > 0) {
                        walkInline(t.tokens);
                    } else {
                        parts.push(t.text);
                    }
                    break;
                }
                case 'codespan': {
                    parts.push((tok as Tokens.Codespan).text);
                    break;
                }
                case 'text': {
                    const t = tok as Tokens.Text;
                    if (t.tokens && t.tokens.length > 0) {
                        walkInline(t.tokens);
                    } else {
                        parts.push(t.text);
                    }
                    break;
                }
                case 'escape': {
                    parts.push((tok as Tokens.Escape).text);
                    break;
                }
                case 'br': {
                    parts.push(' ');
                    break;
                }
                case 'link': {
                    const t = tok as Tokens.Link;
                    if (t.tokens.length > 0) {
                        walkInline(t.tokens);
                    } else {
                        parts.push(t.text);
                    }
                    break;
                }
                case 'image': {
                    parts.push((tok as Tokens.Image).text);
                    break;
                }
                default:
                    if ('text' in tok && typeof tok.text === 'string') {
                        parts.push(tok.text);
                    }
                    break;
            }
        }
    }

    function walkBlock(blockToks: Token[]): void {
        for (let i = 0; i < blockToks.length; i++) {
            const tok = blockToks[i];

            switch (tok.type) {
                case 'paragraph': {
                    const t = tok as Tokens.Paragraph;
                    if (t.tokens.length > 0) {
                        walkInline(t.tokens);
                    } else {
                        parts.push(t.text);
                    }
                    if (i < blockToks.length - 1) parts.push(' ');
                    break;
                }
                case 'heading': {
                    const t = tok as Tokens.Heading;
                    if (t.tokens.length > 0) {
                        walkInline(t.tokens);
                    } else {
                        parts.push(t.text);
                    }
                    if (i < blockToks.length - 1) parts.push(' ');
                    break;
                }
                case 'blockquote': {
                    const t = tok as Tokens.Blockquote;
                    if (t.tokens.length > 0) {
                        walkBlock(t.tokens);
                    }
                    if (i < blockToks.length - 1) parts.push(' ');
                    break;
                }
                case 'list': {
                    const t = tok as Tokens.List;
                    for (const item of t.items) {
                        if (item.tokens.length > 0) {
                            walkBlock(item.tokens);
                        } else {
                            parts.push(item.text);
                        }
                        parts.push(' ');
                    }
                    break;
                }
                case 'code': {
                    parts.push((tok as Tokens.Code).text);
                    if (i < blockToks.length - 1) parts.push(' ');
                    break;
                }
                case 'hr':
                case 'space':
                    if (i < blockToks.length - 1) parts.push(' ');
                    break;
                default: {
                    if ('tokens' in tok && Array.isArray(tok.tokens)) {
                        walkInline(tok.tokens);
                    } else if ('text' in tok && typeof tok.text === 'string') {
                        parts.push(tok.text);
                    }
                    if (i < blockToks.length - 1) parts.push(' ');
                    break;
                }
            }
        }
    }

    walkBlock(tokens);

    return parts.join('')
        .replace(/\s+/g, ' ')
        .trim();
}
