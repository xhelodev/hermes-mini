import MarkdownIt from 'markdown-it';

type Parser = InstanceType<typeof MarkdownIt>;
type Token = ReturnType<Parser['parse']>[number];

const FENCE = /^( {0,3})(`{3,}|~{3,})(.*)$/;

type OpenFence = { char: string; length: number };

/** Estado del fence después de leer una línea: lo abre, lo cierra o lo deja igual. */
function nextFence(open: OpenFence | null, rawLine: string): OpenFence | null {
  const match = FENCE.exec(rawLine.replace(/\r$/, ''));
  if (!match) return open;
  const marker = match[2] ?? '';
  const rest = match[3] ?? '';
  const char = marker[0] ?? '';
  if (!open) return { char, length: marker.length };
  if (char !== open.char || marker.length < open.length) return open;
  if (rest.trim() !== '') return open;
  return null;
}

/** Cierra un bloque de código que todavía no tiene fence de cierre, para poder pintarlo mientras llega el stream. */
export function closeOpenFence(source: string): string {
  let open: OpenFence | null = null;
  for (const line of source.split('\n')) open = nextFence(open, line);

  if (!open) return source;
  const close = open.char.repeat(open.length);
  return source.endsWith('\n') ? `${source}${close}\n` : `${source}\n${close}\n`;
}

/**
 * Largo del prefijo que ya no cambia mientras llega el stream: hasta la última línea en
 * blanco fuera de un bloque de código. Así solo se vuelve a parsear el último párrafo.
 */
export function stableMarkdownLength(source: string): number {
  let open: OpenFence | null = null;
  let offset = 0;
  let stable = 0;
  for (const line of source.split('\n')) {
    const end = offset + line.length + 1;
    if (!open && line.trim() === '') stable = Math.min(end, source.length);
    open = nextFence(open, line);
    offset = end;
  }
  return stable;
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
