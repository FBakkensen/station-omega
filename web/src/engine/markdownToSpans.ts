import { Lexer, type Token, type Tokens } from 'marked';
import type { StyledSpan } from './types';

/**
 * Port of src/markdown-reveal.ts flattenMarkdown → StyledSpan[] for React.
 *
 * Parses markdown text once into styled spans with format flags (bold, italic,
 * code, strikethrough) and a base color. React components render these as
 * styled <span> elements.
 */

interface FormatCtx {
  type: 'strong' | 'em' | 'del' | 'codespan';
}

interface FlattenResult {
  spans: StyledSpan[];
  contentLength: number;
}

/** Parse markdown into StyledSpan[] with a base text color. */
export function markdownToSpans(markdown: string, baseColor: string): FlattenResult {
  const tokens = Lexer.lex(markdown, { gfm: true });
  const spans: StyledSpan[] = [];

  function pushSpan(text: string, formats: FormatCtx[]): void {
    if (!text) return;

    const span: StyledSpan = { text, color: baseColor };
    for (const fmt of formats) {
      switch (fmt.type) {
        case 'strong': span.bold = true; break;
        case 'em': span.italic = true; break;
        case 'del': span.strikethrough = true; break;
        case 'codespan': span.code = true; span.color = '#ff8844'; break;
      }
    }

    // Merge with previous span if same formatting
    if (spans.length > 0) {
      const prev = spans[spans.length - 1];
      if (
        prev.bold === span.bold &&
        prev.italic === span.italic &&
        prev.strikethrough === span.strikethrough &&
        prev.code === span.code &&
        prev.color === span.color
      ) {
        prev.text += text;
        return;
      }
    }

    spans.push(span);
  }

  function walkInline(toks: Token[], formatStack: FormatCtx[]): void {
    for (const tok of toks) {
      switch (tok.type) {
        case 'strong':
        case 'em':
        case 'del': {
          const t = tok as Tokens.Strong | Tokens.Em | Tokens.Del;
          const ctx: FormatCtx = { type: tok.type };
          const newStack = [...formatStack, ctx];
          if (t.tokens.length > 0) {
            walkInline(t.tokens, newStack);
          } else {
            pushSpan(t.text, newStack);
          }
          break;
        }
        case 'codespan': {
          const t = tok as Tokens.Codespan;
          pushSpan(t.text, [...formatStack, { type: 'codespan' }]);
          break;
        }
        case 'text': {
          const t = tok as Tokens.Text;
          if (t.tokens && t.tokens.length > 0) {
            walkInline(t.tokens, formatStack);
          } else {
            pushSpan(t.text, formatStack);
          }
          break;
        }
        case 'escape':
          pushSpan((tok as Tokens.Escape).text, formatStack);
          break;
        case 'br':
          pushSpan('\n', formatStack);
          break;
        case 'link': {
          const t = tok as Tokens.Link;
          if (t.tokens.length > 0) {
            walkInline(t.tokens, formatStack);
          } else {
            pushSpan(t.text, formatStack);
          }
          break;
        }
        case 'image':
          pushSpan((tok as Tokens.Image).text, formatStack);
          break;
        default:
          if ('text' in tok && typeof tok.text === 'string') {
            pushSpan(tok.text, formatStack);
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
            pushSpan(t.text, []);
          }
          if (i < blockToks.length - 1) pushSpan('\n\n', []);
          break;
        }
        case 'heading': {
          const t = tok as Tokens.Heading;
          pushSpan('#'.repeat(t.depth) + ' ', []);
          if (t.tokens.length > 0) {
            walkInline(t.tokens, []);
          } else {
            pushSpan(t.text, []);
          }
          if (i < blockToks.length - 1) pushSpan('\n\n', []);
          break;
        }
        case 'blockquote': {
          const t = tok as Tokens.Blockquote;
          pushSpan('> ', []);
          if (t.tokens.length > 0) walkBlock(t.tokens);
          if (i < blockToks.length - 1) pushSpan('\n\n', []);
          break;
        }
        case 'list': {
          const t = tok as Tokens.List;
          for (let j = 0; j < t.items.length; j++) {
            const item = t.items[j];
            const startNum = t.start !== '' ? (t.start) + j : j + 1;
            const marker = t.ordered ? `${String(startNum)}. ` : '- ';
            pushSpan(marker, []);
            if (item.tokens.length > 0) {
              walkBlock(item.tokens);
            } else {
              pushSpan(item.text, []);
            }
            if (j < t.items.length - 1) pushSpan('\n', []);
          }
          if (i < blockToks.length - 1) pushSpan('\n\n', []);
          break;
        }
        case 'hr':
          pushSpan('---', []);
          if (i < blockToks.length - 1) pushSpan('\n\n', []);
          break;
        case 'code':
          pushSpan((tok as Tokens.Code).text, []);
          if (i < blockToks.length - 1) pushSpan('\n\n', []);
          break;
        case 'space':
          pushSpan('\n\n', []);
          break;
        default:
          if ('tokens' in tok && Array.isArray(tok.tokens)) {
            walkInline(tok.tokens, []);
          } else if ('text' in tok && typeof tok.text === 'string') {
            pushSpan(tok.text, []);
          }
          if (i < blockToks.length - 1) pushSpan('\n\n', []);
          break;
      }
    }
  }

  walkBlock(tokens);

  let contentLength = 0;
  for (const span of spans) {
    contentLength += span.text.length;
  }

  return { spans, contentLength };
}

/** Truncate a StyledSpan array to at most `charLimit` visible characters. */
export function truncateSpans(spans: StyledSpan[], charLimit: number): StyledSpan[] {
  if (charLimit <= 0) return [];

  const result: StyledSpan[] = [];
  let remaining = charLimit;

  for (const span of spans) {
    if (remaining <= 0) break;

    if (span.text.length <= remaining) {
      result.push(span);
      remaining -= span.text.length;
    } else {
      result.push({ ...span, text: span.text.slice(0, remaining) });
      remaining = 0;
    }
  }

  return result;
}

/** Extract plain text from markdown (for TTS). */
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
          if (t.tokens.length > 0) walkInline(t.tokens);
          else parts.push(t.text);
          break;
        }
        case 'codespan': parts.push((tok as Tokens.Codespan).text); break;
        case 'text': {
          const t = tok as Tokens.Text;
          if (t.tokens && t.tokens.length > 0) walkInline(t.tokens);
          else parts.push(t.text);
          break;
        }
        case 'escape': parts.push((tok as Tokens.Escape).text); break;
        case 'br': parts.push(' '); break;
        case 'link': {
          const t = tok as Tokens.Link;
          if (t.tokens.length > 0) walkInline(t.tokens);
          else parts.push(t.text);
          break;
        }
        case 'image': parts.push((tok as Tokens.Image).text); break;
        default:
          if ('text' in tok && typeof tok.text === 'string') parts.push(tok.text);
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
          if (t.tokens.length > 0) walkInline(t.tokens);
          else parts.push(t.text);
          if (i < blockToks.length - 1) parts.push(' ');
          break;
        }
        case 'heading': {
          const t = tok as Tokens.Heading;
          if (t.tokens.length > 0) walkInline(t.tokens);
          else parts.push(t.text);
          if (i < blockToks.length - 1) parts.push(' ');
          break;
        }
        case 'blockquote': {
          const t = tok as Tokens.Blockquote;
          if (t.tokens.length > 0) walkBlock(t.tokens);
          if (i < blockToks.length - 1) parts.push(' ');
          break;
        }
        case 'list': {
          const t = tok as Tokens.List;
          for (const item of t.items) {
            if (item.tokens.length > 0) walkBlock(item.tokens);
            else parts.push(item.text);
            parts.push(' ');
          }
          break;
        }
        case 'code':
          parts.push((tok as Tokens.Code).text);
          if (i < blockToks.length - 1) parts.push(' ');
          break;
        case 'hr':
        case 'space':
          if (i < blockToks.length - 1) parts.push(' ');
          break;
        default:
          if ('tokens' in tok && Array.isArray(tok.tokens)) walkInline(tok.tokens);
          else if ('text' in tok && typeof tok.text === 'string') parts.push(tok.text);
          if (i < blockToks.length - 1) parts.push(' ');
          break;
      }
    }
  }

  walkBlock(tokens);
  return parts.join('').replace(/\s+/g, ' ').trim();
}
