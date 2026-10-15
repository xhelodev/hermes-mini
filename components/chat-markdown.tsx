import * as Clipboard from 'expo-clipboard';
import * as Linking from 'expo-linking';
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Platform, Pressable, ScrollView, StyleSheet, View } from 'react-native';

import { StreamCursor } from '@/components/stream-status';
import { Text } from '@/components/ui/text';
import { useTheme } from '@/contexts/theme-context';
import { codeForCopy, fenceLanguage, parseMarkdown } from '@/lib/markdown';
import type { ThemeTokens } from '@/lib/themes';

type MarkdownToken = ReturnType<typeof parseMarkdown>[number];

type ChatMarkdownProps = {
  source: string;
  streaming?: boolean;
};

const MONO = Platform.select({ ios: 'Menlo', android: 'monospace', default: 'monospace' });

function openLink(url: string) {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return;
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:' && parsed.protocol !== 'mailto:') {
    return;
  }
  void Linking.openURL(url).catch(() => undefined);
}

function headingSize(tag: string): number {
  if (tag === 'h1') return 22;
  if (tag === 'h2') return 20;
  if (tag === 'h3') return 18;
  return 16;
}

function readInline(
  tokens: MarkdownToken[],
  index: number,
  until: string | null,
  keyPrefix: string,
  tokensTheme: ThemeTokens,
): { nodes: ReactNode[]; next: number } {
  const nodes: ReactNode[] = [];
  let i = index;
  while (i < tokens.length) {
    const token = tokens[i];
    if (!token) break;
    if (until && token.type === until) return { nodes, next: i };

    if (token.type === 'text') {
      nodes.push(token.content);
      i += 1;
      continue;
    }
    if (token.type === 'softbreak' || token.type === 'hardbreak') {
      nodes.push('\n');
      i += 1;
      continue;
    }
    if (token.type === 'code_inline') {
      nodes.push(
        <Text key={`${keyPrefix}-${i}`} style={[styles.inlineCode, { color: tokensTheme.fg, backgroundColor: tokensTheme.bg }]}>
          {token.content}
        </Text>,
      );
      i += 1;
      continue;
    }
    if (token.type === 'strong_open' || token.type === 'em_open' || token.type === 's_open') {
      const closeType = token.type.replace('_open', '_close');
      const inner = readInline(tokens, i + 1, closeType, `${keyPrefix}-${i}`, tokensTheme);
      const style =
        token.type === 'strong_open'
          ? styles.strong
          : token.type === 'em_open'
            ? styles.em
            : styles.strike;
      nodes.push(
        <Text key={`${keyPrefix}-${i}`} style={style}>
          {inner.nodes}
        </Text>,
      );
      i = inner.next + 1;
      continue;
    }
    if (token.type === 'link_open') {
      const href = String(token.attrGet('href') ?? '');
      const inner = readInline(tokens, i + 1, 'link_close', `${keyPrefix}-${i}`, tokensTheme);
      nodes.push(
        <Text
          key={`${keyPrefix}-${i}`}
          accessibilityRole="link"
          style={[styles.link, { color: tokensTheme.fg }]}
          onPress={() => openLink(href)}
        >
          {inner.nodes}
        </Text>,
      );
      i = inner.next + 1;
      continue;
    }
    if (token.type === 'image') {
      const src = String(token.attrGet('src') ?? '');
      const alt = readInline(token.children ?? [], 0, null, `${keyPrefix}-${i}-alt`, tokensTheme).nodes;
      const label = alt.length > 0 ? alt : src || 'imagen';
      nodes.push(
        src ? (
          <Text
            key={`${keyPrefix}-${i}`}
            accessibilityRole="link"
            style={[styles.link, { color: tokensTheme.fg }]}
            onPress={() => openLink(src)}
          >
            {label}
          </Text>
        ) : (
          <Text key={`${keyPrefix}-${i}`}>{label}</Text>
        ),
      );
      i += 1;
      continue;
    }
    if (token.type === 'html_inline') {
      nodes.push(token.content);
      i += 1;
      continue;
    }
    if (token.children) {
      nodes.push(...readInline(token.children, 0, null, `${keyPrefix}-${i}`, tokensTheme).nodes);
    } else if (token.content) {
      nodes.push(token.content);
    }
    i += 1;
  }
  return { nodes, next: i };
}

function matchingClose(tokens: MarkdownToken[], openIndex: number): number {
  const open = tokens[openIndex]?.type ?? '';
  const close = open.replace(/_open$/, '_close');
  let depth = 0;
  for (let i = openIndex; i < tokens.length; i += 1) {
    const type = tokens[i]?.type;
    if (type === open) depth += 1;
    else if (type === close) {
      depth -= 1;
      if (depth === 0) return i;
    }
  }
  return tokens.length;
}

function CodeBlock({ code, language, theme }: { code: string; language: string; theme: ThemeTokens }) {
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  function onCopy() {
    void Clipboard.setStringAsync(code).then(() => {
      setCopied(true);
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => setCopied(false), 1600);
    });
  }

  return (
    <View style={[styles.codeBlock, { borderColor: theme.bd, backgroundColor: theme.bg }]}>
      <View style={[styles.codeHeader, { borderBottomColor: theme.bd }]}>
        <Text style={[styles.codeLang, { color: theme.mut }]}>{language}</Text>
        <Pressable accessibilityRole="button" accessibilityLabel="Copiar código" onPress={onCopy}>
          <Text style={[styles.codeLang, { color: theme.mut }]}>{copied ? 'Copiado' : 'Copiar'}</Text>
        </Pressable>
      </View>
      <ScrollView horizontal nestedScrollEnabled showsHorizontalScrollIndicator={false}>
        <Text selectable style={[styles.codeText, { color: theme.fg }]}>
          {code}
        </Text>
      </ScrollView>
    </View>
  );
}

function tableRows(tokens: MarkdownToken[]): { header: boolean; cells: MarkdownToken[] }[] {
  const rows: { header: boolean; cells: MarkdownToken[] }[] = [];
  let i = 0;
  while (i < tokens.length) {
    const token = tokens[i];
    if (token?.type !== 'tr_open') {
      i += 1;
      continue;
    }
    const close = matchingClose(tokens, i);
    const cells: MarkdownToken[] = [];
    let header = false;
    for (let cell = i + 1; cell < close; cell += 1) {
      const current = tokens[cell];
      if (current?.type !== 'th_open' && current?.type !== 'td_open') continue;
      if (current.type === 'th_open') header = true;
      const cellClose = matchingClose(tokens, cell);
      const inline = tokens.slice(cell + 1, cellClose).find((child) => child.type === 'inline');
      if (inline) cells.push(inline);
      cell = cellClose;
    }
    if (cells.length > 0) rows.push({ header, cells });
    i = close + 1;
  }
  return rows;
}

function MarkdownTable({ tokens, theme }: { tokens: MarkdownToken[]; theme: ThemeTokens }) {
  const rows = tableRows(tokens);
  if (rows.length === 0) return null;

  return (
    <ScrollView horizontal nestedScrollEnabled showsHorizontalScrollIndicator={false}>
      <View style={[styles.table, { borderColor: theme.bd }]}>
        {rows.map((row, rowIndex) => (
          <View
            key={`row-${rowIndex}`}
            style={[styles.tableRow, rowIndex > 0 ? { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: theme.bd } : null]}
          >
            {row.cells.map((cell, cellIndex) => (
              <View
                key={`cell-${rowIndex}-${cellIndex}`}
                style={[
                  styles.tableCell,
                  cellIndex > 0 ? { borderLeftWidth: StyleSheet.hairlineWidth, borderLeftColor: theme.bd } : null,
                  { backgroundColor: row.header ? theme.bg : theme.card },
                ]}
              >
                <Text selectable style={[styles.tableText, row.header ? styles.strong : null, { color: theme.fg }]}>
                  {readInline(cell.children ?? [], 0, null, `cell-${rowIndex}-${cellIndex}`, theme).nodes}
                </Text>
              </View>
            ))}
          </View>
        ))}
      </View>
    </ScrollView>
  );
}

function renderBlocks(tokens: MarkdownToken[], keyPrefix: string, theme: ThemeTokens): ReactNode[] {
  const nodes: React.ReactNode[] = [];
  let i = 0;
  while (i < tokens.length) {
    const token = tokens[i];
    if (!token) break;
    const key = `${keyPrefix}-${i}`;

    if (token.type === 'fence' || token.type === 'code_block') {
      nodes.push(
        <CodeBlock
          key={key}
          code={codeForCopy(token.content)}
          language={token.type === 'fence' ? fenceLanguage(token.info) : ''}
          theme={theme}
        />,
      );
      i += 1;
      continue;
    }
    if (token.type === 'hr') {
      nodes.push(<View key={key} style={[styles.hr, { backgroundColor: theme.bd }]} />);
      i += 1;
      continue;
    }
    if (token.type === 'html_block') {
      nodes.push(
        <Text key={key} selectable style={{ color: theme.fg }}>
          {token.content}
        </Text>,
      );
      i += 1;
      continue;
    }
    if (token.type === 'table_open') {
      const close = matchingClose(tokens, i);
      nodes.push(<MarkdownTable key={key} tokens={tokens.slice(i + 1, close)} theme={theme} />);
      i = close + 1;
      continue;
    }
    if (token.type === 'paragraph_open' || token.type === 'heading_open') {
      const close = matchingClose(tokens, i);
      const inline = tokens.slice(i + 1, close).find((child) => child.type === 'inline');
      const body = readInline(inline?.children ?? [], 0, null, key, theme).nodes;
      if (token.type === 'heading_open') {
        nodes.push(
          <Text key={key} selectable style={[styles.heading, { color: theme.fg, fontSize: headingSize(token.tag) }]}>
            {body}
          </Text>,
        );
      } else {
        nodes.push(
          <Text key={key} selectable style={{ color: theme.fg }}>
            {body}
          </Text>,
        );
      }
      i = close + 1;
      continue;
    }
    if (token.nesting === 1 && token.type.endsWith('_open')) {
      const close = matchingClose(tokens, i);
      const inner = renderBlocks(tokens.slice(i + 1, close), key, theme);
      if (token.type === 'blockquote_open') {
        nodes.push(
          <View key={key} style={[styles.quote, { borderLeftColor: theme.bd }]}>
            {inner}
          </View>,
        );
      } else if (token.type === 'list_item_open') {
        const marker = token.info ? `${token.info}${token.markup}` : '•';
        nodes.push(
          <View key={key} style={styles.item}>
            <Text style={[styles.marker, { color: theme.fg }]}>{marker}</Text>
            <View style={styles.itemBody}>{inner}</View>
          </View>,
        );
      } else {
        nodes.push(
          <View key={key} style={styles.stack}>
            {inner}
          </View>,
        );
      }
      i = close + 1;
      continue;
    }
    if (token.type === 'inline') {
      nodes.push(
        <Text key={key} selectable style={{ color: theme.fg }}>
          {readInline(token.children ?? [], 0, null, key, theme).nodes}
        </Text>,
      );
      i += 1;
      continue;
    }
    i += 1;
  }
  return nodes;
}

export function ChatMarkdown({ source, streaming = false }: ChatMarkdownProps) {
  const { theme } = useTheme();
  const tokens = useMemo(() => {
    try {
      return parseMarkdown(source);
    } catch {
      return null;
    }
  }, [source]);

  if (!tokens) {
    return (
      <Text selectable style={{ color: theme.tokens.fg }}>
        {source}
      </Text>
    );
  }

  return (
    <View style={styles.root}>
      {renderBlocks(tokens, 'md', theme.tokens)}
      {streaming ? <StreamCursor color={theme.tokens.fg} /> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { gap: 8 },
  heading: { fontWeight: '600' },
  strong: { fontWeight: '600' },
  em: { fontStyle: 'italic' },
  strike: { textDecorationLine: 'line-through' },
  link: { textDecorationLine: 'underline' },
  inlineCode: { fontFamily: MONO, fontSize: 14 },
  quote: { gap: 8, borderLeftWidth: 3, paddingLeft: 10 },
  stack: { gap: 4 },
  item: { flexDirection: 'row', gap: 8 },
  marker: { minWidth: 20 },
  itemBody: { flex: 1, minWidth: 0, gap: 4 },
  hr: { height: StyleSheet.hairlineWidth, marginVertical: 4 },
  codeBlock: { overflow: 'hidden', borderRadius: 12, borderWidth: 1 },
  codeHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderBottomWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  codeLang: { fontSize: 13 },
  codeText: { fontFamily: MONO, fontSize: 13, padding: 12 },
  table: { borderWidth: 1, borderRadius: 12, overflow: 'hidden' },
  tableRow: { flexDirection: 'row' },
  tableCell: { width: 120, paddingHorizontal: 10, paddingVertical: 8 },
  tableText: { fontSize: 14 },
});
