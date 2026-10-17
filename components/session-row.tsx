import { memo, useCallback } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { ThinkingRow } from '@/components/stream-status';
import { SwipeRow } from '@/components/swipe-row';
import { Text } from '@/components/ui/text';
import { useTheme } from '@/contexts/theme-context';
import { formatPreview, formatSessionTime, sourceLabel, type HermesSession } from '@/lib/hermes';
import type { SwipeActionId } from '@/lib/swipe-actions';

type SessionRowProps = {
  session: HermesSession;
  /** Actividad en curso (p. ej. «Respondiendo…»); `null` si no hay respuesta en curso. */
  status: string | null;
  preview: string;
  leftAction: SwipeActionId;
  rightAction: SwipeActionId;
  busy: boolean;
  onOpen: (session: HermesSession) => void;
  onMenu: (session: HermesSession) => void;
  onAction: (session: HermesSession, action: SwipeActionId) => void;
};

/** Memoizada: un cambio de actividad en otra conversación no vuelve a pintar esta fila. */
export const SessionRow = memo(function SessionRow({
  session,
  status,
  preview,
  leftAction,
  rightAction,
  busy,
  onOpen,
  onMenu,
  onAction,
}: SessionRowProps) {
  const { theme } = useTheme();
  const t = theme.tokens;
  const source = sourceLabel(session.source);
  // Estable mientras la sesión no cambie, así SwipeRow no rehace el gesto en cada render.
  const handleAction = useCallback((action: SwipeActionId) => onAction(session, action), [onAction, session]);

  return (
    <SwipeRow
      leftAction={leftAction}
      rightAction={rightAction}
      pinned={session.pinned}
      archived={session.archived}
      disabled={busy}
      style={[styles.rowFrame, { borderBottomColor: t.bd }]}
      onAction={handleAction}
    >
      <Pressable
        delayLongPress={350}
        onPress={() => onOpen(session)}
        onLongPress={() => onMenu(session)}
        style={styles.row}
      >
        <View style={styles.rowTop}>
          <Text style={[styles.title, { color: t.fg }]}>
            {session.pinned ? '📌 ' : ''}
            {session.title}
          </Text>
          <Text style={[styles.time, { color: t.mut }]}>{formatSessionTime(session.updatedAt)}</Text>
        </View>
        {source ? <Text style={[styles.source, { color: t.mut }]}>{source}</Text> : null}
        {status !== null ? (
          <View style={styles.preview}>
            <ThinkingRow color={t.pri} label={status} />
          </View>
        ) : preview ? (
          <Text numberOfLines={2} style={[styles.preview, { color: t.mut }]}>
            {formatPreview(preview)}
          </Text>
        ) : null}
      </Pressable>
    </SwipeRow>
  );
});

const styles = StyleSheet.create({
  rowFrame: { borderBottomWidth: 1, marginHorizontal: -16 },
  row: { paddingHorizontal: 16, paddingVertical: 14 },
  rowTop: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 8,
  },
  title: { flex: 1, fontWeight: '600' },
  time: { fontSize: 14 },
  source: { marginTop: 2, fontSize: 12 },
  preview: { marginTop: 4, fontSize: 14 },
});
