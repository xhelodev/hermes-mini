import { closeOpenFence, parseMarkdown } from '@/lib/markdown';

describe('closeOpenFence', () => {
  it('deja igual un texto sin fence', () => {
    expect(closeOpenFence('hola\n**mundo**')).toBe('hola\n**mundo**');
  });

  it('deja igual un fence ya cerrado', () => {
    const source = '```ts\nconst x = 1\n```\n';
    expect(closeOpenFence(source)).toBe(source);
  });

  it('cierra un fence de backticks que sigue abierto', () => {
    expect(closeOpenFence('```ts\nconst x = 1')).toBe('```ts\nconst x = 1\n```\n');
  });

  it('cierra un fence de virgulillas', () => {
    expect(closeOpenFence('~~~py\nprint(1)')).toBe('~~~py\nprint(1)\n~~~\n');
  });

  it('solo cierra el fence que quedó abierto después de uno completo', () => {
    const source = '```\nuno\n```\n\n```js\nconst';
    expect(closeOpenFence(source)).toBe(`${source}\n\`\`\`\n`);
  });

  it('no cierra con un marcador más corto', () => {
    expect(closeOpenFence('````\ncode\n```')).toBe('````\ncode\n```\n````\n');
  });

  it('no trata como cierre una línea con texto después del marcador', () => {
    expect(closeOpenFence('```\n```js')).toBe('```\n```js\n```\n');
  });

  it('acepta espacios al final del cierre', () => {
    const source = '```\ncode\n```   \n';
    expect(closeOpenFence(source)).toBe(source);
  });
});

describe('parseMarkdown', () => {
  it('pinta como código un fence que todavía no cerró', () => {
    const tokens = parseMarkdown('```ts\nconst x = 1');
    const fence = tokens.find((token) => token.type === 'fence');
    expect(fence?.info.trim()).toBe('ts');
    expect(fence?.content).toBe('const x = 1\n');
  });

  it('reconoce una tabla', () => {
    const tokens = parseMarkdown('| A | B |\n|---|---|\n| 1 | 2 |');
    expect(tokens.some((token) => token.type === 'table_open')).toBe(true);
    expect(tokens.filter((token) => token.type === 'inline').map((token) => token.content)).toEqual([
      'A',
      'B',
      '1',
      '2',
    ]);
  });

  it('reconoce tachado', () => {
    const tokens = parseMarkdown('hola ~~mundo~~');
    const inline = tokens.find((token) => token.type === 'inline');
    expect(inline?.children?.some((token) => token.type === 's_open')).toBe(true);
  });
});
