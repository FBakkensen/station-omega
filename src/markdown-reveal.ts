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

interface FlattenResult {
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
