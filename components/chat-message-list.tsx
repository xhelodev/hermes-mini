import { memo, useEffect, useRef, type RefObject } from 'react';
import { Image, Pressable, ScrollView, StyleSheet, View } from 'react-native';

import { ChatMarkdown } from '@/components/chat-markdown';
import { ReasoningFold, type ReasoningNote } from '@/components/reasoning-fold';
import { ThinkingRow } from '@/components/stream-status';
import { Text } from '@/components/ui/text';
import { useStrings } from '@/contexts/i18n-context';
import { useTheme } from '@/contexts/theme-context';
import { statusLabel, type StreamStatus } from '@/lib/stream-progress';

export type LineAttachment = { label: string; uri?: string };

export type ChatLine = {
  id: string;
  kind: 'user' | 'assistant';
  text: string;
  attachments: LineAttachment[];
  notes: ReasoningNote[];
  /** Mensaje del usuario mandado como corrección con el turno en curso. */
  steer?: boolean;
};

const SHOWABLE_IMAGE = /^(data:image\/|https?:\/\/|file:\/\/|content:\/\/|ph:\/\/|assets-library:\/\/)/i;

export function showableImage(uri: string | undefined): uri is string {
  return !!uri && SHOWABLE_IMAGE.test(uri);
}

function lastUserLineId(lines: ChatLine[]): string | undefined {
  for (let i = lines.length - 1; i >= 0; i -= 1) {
    const line = lines[i];
    if (line?.kind === 'user') return line.id;
  }
  return undefined;
}

/** Distancia al final (px) dentro de la cual seguimos pegados al último mensaje. */
const FOLLOW_THRESHOLD = 80;

type MessageListProps = {
  lines: ChatLine[];
  streamId: string | null;
  sending: boolean;
  status: StreamStatus | null;
  backgroundRun: boolean;
  copiedId: string | null;
  scrollRef: RefObject<ScrollView | null>;
  onOpenImage: (uri: string) => void;
  onCopy: (id: string, text: string) => void;
  onMore: (id: string, text: string) => void;
};

/**
 * Memoizada: escribir en el composer no la vuelve a pintar, y con cada token del stream
 * solo cambia la fila que se está escribiendo.
 */
export const MessageList = memo(function MessageList({
  lines,
  streamId,
  sending,
  status,
  backgroundRun,
  copiedId,
  scrollRef,
  onOpenImage,
  onCopy,
  onMore,
}: MessageListProps) {
  const { theme } = useTheme();
  const t = theme.tokens;
  const str = useStrings();
  // Si el usuario subió a leer, el stream no lo arrastra al final.
  const following = useRef(true);
  const lastUserId = lastUserLineId(lines);

  useEffect(() => {
    following.current = true;
  }, [lastUserId]);

  return (
    <ScrollView
      ref={scrollRef}
      style={styles.flex}
      contentContainerStyle={styles.content}
      keyboardShouldPersistTaps="handled"
      scrollEventThrottle={64}
      onScroll={(event) => {
        const { contentOffset, contentSize, layoutMeasurement } = event.nativeEvent;
        following.current =
          contentSize.height - layoutMeasurement.height - contentOffset.y < FOLLOW_THRESHOLD;
      }}
      onContentSizeChange={() => {
        if (following.current) scrollRef.current?.scrollToEnd({ animated: false });
      }}
    >
      {lines.length === 0 ? (
        <Text style={[styles.textSm, { color: t.mut }]}>{str.chat.firstMessage}</Text>
      ) : null}
      {lines.map((line) => {
        const live = line.kind === 'assistant' && sending && line.id === streamId;
        return (
          <MessageRow
            key={line.id}
            line={line}
            live={live}
            status={live ? status : null}
            copied={copiedId === line.id}
            onOpenImage={onOpenImage}
            onCopy={onCopy}
            onMore={onMore}
          />
        );
      })}
      {backgroundRun ? (
        <View style={[styles.bubbleWrap, { alignSelf: 'stretch' }]}>
          <View
            style={[
              styles.bubble,
              styles.assistantBubble,
              { backgroundColor: t.card, borderColor: t.bd, borderWidth: 1 },
            ]}
          >
            <ThinkingRow color={t.mut} label={str.sessions.responding} />
          </View>
        </View>
      ) : null}
    </ScrollView>
  );
});

type MessageRowProps = {
  line: ChatLine;
  /** Es la respuesta que se está recibiendo ahora. */
  live: boolean;
  /** En qué va esa respuesta; `null` en las demás filas para que no se vuelvan a pintar. */
  status: StreamStatus | null;
  copied: boolean;
  onOpenImage: (uri: string) => void;
  onCopy: (id: string, text: string) => void;
  onMore: (id: string, text: string) => void;
};

const MessageRow = memo(function MessageRow({
  line,
  live,
  status,
  copied,
  onOpenImage,
  onCopy,
  onMore,
}: MessageRowProps) {
  const { theme } = useTheme();
  const t = theme.tokens;
  const str = useStrings();
  const mine = line.kind === 'user';
  const hasText = Boolean(line.text.trim());
  const waiting = live && !hasText;
  const streaming = live && hasText;
  // Con texto en pantalla el cursor alcanza mientras escribe; si hace otra cosa (una
  // herramienta, razonar) o el servidor no manda nada, lo decimos debajo.
  const showStatus = streaming && status !== null && (status.phase.kind !== 'writing' || status.slow);

  return (
    <View
      style={[styles.bubbleWrap, mine ? { alignSelf: 'flex-end', maxWidth: '90%' } : { alignSelf: 'stretch' }]}
    >
      {line.attachments.map((item, index) =>
        showableImage(item.uri) ? (
          <Pressable
            key={`${line.id}-file-${index}`}
            accessibilityRole="button"
            accessibilityLabel={str.chat.viewImage}
            onPress={() => {
              if (item.uri) onOpenImage(item.uri);
            }}
          >
            <Image
              source={{ uri: item.uri }}
              accessibilityLabel={item.label}
              resizeMode="cover"
              style={[styles.preview, { backgroundColor: t.card }]}
            />
          </Pressable>
        ) : (
          <View
            key={`${line.id}-file-${index}`}
            style={[styles.attachment, { borderColor: t.bd, backgroundColor: t.card }]}
          >
            <Text style={[styles.textSm, { color: t.fg }]}>{item.label}</Text>
          </View>
        ),
      )}
      {waiting ? (
        <View
          style={[
            styles.bubble,
            styles.assistantBubble,
            { backgroundColor: t.card, borderColor: t.bd, borderWidth: 1 },
          ]}
        >
          <ThinkingRow
            color={t.mut}
            label={status ? statusLabel(status) : str.stream.thinking}
            since={status?.since}
          />
        </View>
      ) : line.text ? (
        <View
          style={[
            styles.bubble,
            mine ? null : styles.assistantBubble,
            {
              backgroundColor: mine ? t.pri : t.card,
              borderWidth: mine ? 0 : 1,
              borderColor: t.bd,
            },
          ]}
        >
          {mine && line.steer ? (
            <Text style={[styles.steerLabel, { color: t.pfg }]}>{str.steer.label}</Text>
          ) : null}
          {mine ? (
            <Text selectable style={{ color: t.pfg }}>
              {line.text}
            </Text>
          ) : (
            <ChatMarkdown source={line.text} streaming={streaming} />
          )}
        </View>
      ) : null}
      {showStatus ? (
        <View style={styles.liveStatus}>
          <ThinkingRow color={t.mut} label={statusLabel(status)} since={status.since} />
        </View>
      ) : null}
      {mine ? null : <ReasoningFold notes={line.notes} />}
      {!mine && line.text.trim() ? (
        <View style={styles.actions}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={str.chat.copyMessage}
            onPress={() => onCopy(line.id, line.text)}
          >
            <Text style={[styles.textSm, { color: t.mut }]}>{copied ? str.chat.copied : str.chat.copy}</Text>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={str.chat.moreActions}
            onPress={() => onMore(line.id, line.text)}
          >
            <Text style={[styles.textSm, { color: t.mut }]}>{str.chat.more}</Text>
          </Pressable>
        </View>
      ) : null}
    </View>
  );
});

const styles = StyleSheet.create({
  flex: { flex: 1 },
  content: { padding: 16, gap: 12, flexGrow: 1 },
  textSm: { fontSize: 14 },
  steerLabel: { marginBottom: 2, fontSize: 12, opacity: 0.8 },
  bubbleWrap: { maxWidth: '100%' },
  assistantBubble: { alignSelf: 'stretch' },
  bubble: { borderRadius: 16, paddingHorizontal: 14, paddingVertical: 10 },
  attachment: {
    marginBottom: 8,
    alignSelf: 'flex-end',
    borderRadius: 12,
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  preview: {
    width: 220,
    height: 220,
    marginBottom: 8,
    alignSelf: 'flex-end',
    borderRadius: 12,
  },
  liveStatus: { marginTop: 8, paddingHorizontal: 4 },
  actions: { flexDirection: 'row', gap: 16, marginTop: 6, paddingHorizontal: 4 },
});
