import MarkdownIt from 'markdown-it';

type Parser = InstanceType<typeof MarkdownIt>;
type Token = ReturnType<Parser['parse']>[number];

const FENCE = /^( {0,3})(`{3,}|~{3,})(.*)$/;

/** Cierra un bloque de código que todavía no tiene fence de cierre, para poder pintarlo mientras llega el stream. */
export function closeOpenFence(source: string): string {
  let open: { char: string; length: number } | null = null;

  for (const rawLine of source.split('\n')) {
    const line = rawLine.replace(/\r$/, '');
    const match = FENCE.exec(line);
    if (!match) continue;
    const marker = match[2] ?? '';
    const rest = match[3] ?? '';
    const char = marker[0] ?? '';
    if (!open) {
      open = { char, length: marker.length };
      continue;
    }
    if (char !== open.char || marker.length < open.length) continue;
    if (rest.trim() !== '') continue;
    open = null;
  }

  if (!open) return source;
  const close = open.char.repeat(open.length);
  return source.endsWith('\n') ? `${source}${close}\n` : `${source}\n${close}\n`;
}

function strikethroughPlugin(md: Parser): void {
  md.inline.ruler.before('emphasis', 'strikethrough', (state, silent) => {
    const start = state.pos;
    if (state.src.charCodeAt(start) !== 0x7e || state.src.charCodeAt(start + 1) !== 0x7e) return false;
    if (state.src.charCodeAt(start + 2) === 0x7e) return false;

    const end = state.src.indexOf('~~', start + 2);
    if (end === -1) return false;
    const content = state.src.slice(start + 2, end);
    if (!content.trim() || content.includes('\n')) return false;
    if (silent) return true;

    state.pos = end + 2;
    const open = state.push('s_open', 's', 1);
    open.markup = '~~';
    const children: Token[] = [];
    state.md.inline.parse(content, state.md, state.env, children);
    for (const child of children) state.tokens.push(child);
    const close = state.push('s_close', 's', -1);
    close.markup = '~~';
    return true;
  });
}

const parser = new MarkdownIt({ html: false, linkify: true, breaks: true }).use(strikethroughPlugin);

export function parseMarkdown(source: string): Token[] {
  return parser.parse(closeOpenFence(source), {});
}

export function fenceLanguage(info: string): string {
  return info.trim().split(/\s+/)[0] ?? '';
}

export function codeForCopy(content: string): string {
  return content.replace(/\n$/, '');
}
