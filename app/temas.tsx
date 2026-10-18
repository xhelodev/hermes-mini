import { router } from 'expo-router';
import { useState, type ComponentType } from 'react';
import * as Clipboard from 'expo-clipboard';
import { Alert, Linking, Pressable, StyleSheet, View } from 'react-native';
import {
  ArrowLeftIcon,
  ArrowRightIcon,
  ArrowUturnLeftIcon,
  ChevronRightIcon,
  ChatBubbleLeftEllipsisIcon,
  CpuChipIcon,
  LanguageIcon,
  PuzzlePieceIcon,
  ShieldCheckIcon,
  TrashIcon,
} from 'react-native-heroicons/outline';
import type { NumberProp, SvgProps } from 'react-native-svg';

import { ModelSheet } from '@/components/model-sheet';
import { ScreenShell } from '@/components/screen-shell';
import { SwipeActionsSheet } from '@/components/swipe-actions-sheet';
import { Button } from '@/components/ui/button';
import { Text } from '@/components/ui/text';
import { VoiceLocaleSheet } from '@/components/voice-locale-sheet';
import { RequireConnection, useConnection, useHermesClient } from '@/contexts/connection-context';
import { useSwipeActions } from '@/contexts/swipe-actions-context';
import { useTheme } from '@/contexts/theme-context';
import { useStrings } from '@/contexts/i18n-context';
import { useVoiceLocale } from '@/contexts/voice-locale-context';
import { confirmAction } from '@/lib/confirm';
import { describeHermesError } from '@/lib/hermes';
import { hideSessions, restoreHiddenSessions, useHiddenSessions } from '@/lib/hidden-sessions';
import { useSessionActivity } from '@/lib/session-activity';
import { swipeActionLabel, type SwipeDirection } from '@/lib/swipe-actions';
import { feedbackMailto, PRIVACY_URL, SUPPORT_EMAIL } from '@/lib/support';
import { THEMES, themeLabel, type ThemeId } from '@/lib/themes';

function ThemePreviewCard({
  label,
  tokens,
  selected,
  labelColor,
  accent,
  onPress,
}: {
  label: string;
  tokens: (typeof THEMES)[number]['tokens'];
  selected: boolean;
  labelColor: string;
  accent: string;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      style={[styles.card, { borderColor: selected ? accent : tokens.bd, borderWidth: selected ? 2 : 1 }]}
    >
      <View style={[styles.preview, { backgroundColor: tokens.bg, borderColor: tokens.bd }]}>
        <View style={[styles.previewBar, { backgroundColor: tokens.pri }]} />
        <View style={[styles.previewLine, { backgroundColor: tokens.card }]} />
      </View>
      <Text style={[styles.cardLabel, { color: labelColor }]}>{label}</Text>
    </Pressable>
  );
}

type RowIcon = ComponentType<SvgProps & { size?: NumberProp }>;

function SettingsRow({
  icon: Icon,
  label,
  value,
  disabled = false,
  onPress,
}: {
  icon: RowIcon;
  label: string;
  value?: string;
  disabled?: boolean;
  onPress: () => void;
}) {
  const { theme } = useTheme();
  const t = theme.tokens;

  return (
    <Pressable
      disabled={disabled}
      onPress={onPress}
      style={[styles.modelRow, { borderColor: t.bd, backgroundColor: t.card, opacity: disabled ? 0.5 : 1 }]}
    >
      <Icon color={t.fg} size={22} />
      <Text style={[styles.rowLabel, { color: t.fg }]}>{label}</Text>
      {value ? (
        <Text numberOfLines={1} style={[styles.rowValue, { color: t.mut }]}>
          {value}
        </Text>
      ) : null}
      <ChevronRightIcon color={t.mut} size={18} />
    </Pressable>
  );
}

export default function TemasScreen() {
  return (
    <RequireConnection>
      <TemasBody />
    </RequireConnection>
  );
}

function TemasBody() {
  const { theme, themeId, setThemeId } = useTheme();
  const t = theme.tokens;
  const { defaultModel, clearConnection } = useConnection();
  const { label: voiceLabel } = useVoiceLocale();
  const [modelsOpen, setModelsOpen] = useState(false);
  const [voiceOpen, setVoiceOpen] = useState(false);
  const { config: swipe } = useSwipeActions();
  const [swipeDirection, setSwipeDirection] = useState<SwipeDirection | null>(null);
  const str = useStrings();
  const text = str.settings;
  const client = useHermesClient();
  const activity = useSessionActivity();
  const [deleting, setDeleting] = useState(false);
  const [deleteStatus, setDeleteStatus] = useState<{ text: string; error: boolean } | null>(null);
  const hidden = useHiddenSessions(client);

  function onDeleteAll() {
    const run = () => {
      void (async () => {
        setDeleting(true);
        setDeleteStatus(null);
        try {
          // Solo de la app: se ocultan las que hoy lista el servidor, que las sigue guardando.
          const running = activity.running;
          const targets = (await client.listSessions()).filter(
            (session) => !session.archived && !running.has(session.id) && !hidden?.has(session.id),
          );
          await hideSessions(
            client,
            targets.map((session) => session.id),
          );
          setDeleteStatus({ text: str.cleanup.done(targets.length), error: false });
        } catch (err) {
          setDeleteStatus({ text: describeHermesError(err), error: true });
        } finally {
          setDeleting(false);
        }
      })();
    };
    confirmAction({
      title: str.cleanup.deleteAll,
      message: str.cleanup.deleteAllMessage,
      confirmLabel: str.cleanup.deleteAllConfirm,
      destructive: true,
      onConfirm: run,
    });
  }

  function onRestore() {
    confirmAction({
      title: str.cleanup.restore,
      message: str.cleanup.restoreMessage,
      confirmLabel: str.cleanup.restoreConfirm,
      onConfirm: () => {
        void restoreHiddenSessions(client).then((count) => {
          setDeleteStatus({ text: str.cleanup.restored(count), error: false });
        });
      },
    });
  }

  return (
    <ScreenShell title={text.title} onBack={() => router.back()}>
      <View style={styles.grid}>
        {THEMES.map((item) => (
          <View key={item.id} style={styles.cell}>
            <ThemePreviewCard
              label={themeLabel(item)}
              tokens={item.tokens}
              selected={themeId === item.id}
              labelColor={t.fg}
              accent={t.pri}
              onPress={() => setThemeId(item.id as ThemeId)}
            />
          </View>
        ))}
      </View>
      <SettingsRow
        icon={CpuChipIcon}
        label={text.defaultModel}
        value={defaultModel?.label ?? text.serverModel}
        onPress={() => setModelsOpen(true)}
      />
      <SettingsRow
        icon={LanguageIcon}
        label={text.voiceLanguage}
        value={voiceLabel}
        onPress={() => setVoiceOpen(true)}
      />
      <SettingsRow
        icon={ArrowLeftIcon}
        label={text.swipeLeft}
        value={swipeActionLabel(swipe.left)}
        onPress={() => setSwipeDirection('left')}
      />
      <SettingsRow
        icon={ArrowRightIcon}
        label={text.swipeRight}
        value={swipeActionLabel(swipe.right)}
        onPress={() => setSwipeDirection('right')}
      />
      <SettingsRow
        icon={PuzzlePieceIcon}
        label={str.skills.title}
        onPress={() => router.push('/habilidades')}
      />
      <SettingsRow
        icon={TrashIcon}
        label={str.cleanup.deleteAll}
        value={deleting ? str.cleanup.deleting : undefined}
        disabled={deleting}
        onPress={onDeleteAll}
      />
      {hidden && hidden.size > 0 ? (
        <SettingsRow
          icon={ArrowUturnLeftIcon}
          label={str.cleanup.restore}
          value={str.cleanup.count(hidden.size)}
          disabled={deleting}
          onPress={onRestore}
        />
      ) : null}
      {deleteStatus ? (
        <Text style={[styles.status, { color: deleteStatus.error ? '#ef4444' : t.mut }]}>
          {deleteStatus.text}
        </Text>
      ) : null}
      <SettingsRow
        icon={ChatBubbleLeftEllipsisIcon}
        label={text.feedback}
        onPress={() => {
          Linking.openURL(feedbackMailto()).catch(() => {
            void Clipboard.setStringAsync(SUPPORT_EMAIL);
            Alert.alert(
              text.mailFailedTitle,
              text.mailFailedMessage(SUPPORT_EMAIL),
            );
          });
        }}
      />
      <SettingsRow
        icon={ShieldCheckIcon}
        label={text.privacy}
        onPress={() => {
          void Linking.openURL(PRIVACY_URL).catch(() => undefined);
        }}
      />
      <Text style={[styles.note, { color: t.mut }]}>
        {text.themesNote}
      </Text>
      <Button
        style={styles.disconnect}
        label={text.disconnect}
        variant="outline"
        borderColor={t.bd}
        textColor={t.fg}
        onPress={() => {
          void clearConnection().then(() => router.replace('/conexion'));
        }}
      />
      <ModelSheet
        visible={modelsOpen}
        title={text.defaultModel}
        onClose={() => setModelsOpen(false)}
      />
      <VoiceLocaleSheet visible={voiceOpen} onClose={() => setVoiceOpen(false)} />
      <SwipeActionsSheet direction={swipeDirection} onClose={() => setSwipeDirection(null)} />
    </ScreenShell>
  );
}

const styles = StyleSheet.create({
  grid: { marginBottom: 16, flexDirection: 'row', flexWrap: 'wrap', gap: 12 },
  cell: { width: '47%' },
  card: { borderRadius: 12, padding: 10 },
  preview: {
    marginBottom: 8,
    height: 88,
    overflow: 'hidden',
    borderRadius: 8,
    borderWidth: 1,
    padding: 8,
  },
  previewBar: { marginBottom: 8, marginLeft: 'auto', height: 14, width: '60%', borderRadius: 4 },
  previewLine: { height: 14, width: '70%', borderRadius: 4 },
  cardLabel: { fontSize: 14 },
  modelRow: {
    marginBottom: 16,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    borderRadius: 12,
    borderWidth: 1,
    paddingHorizontal: 16,
    paddingVertical: 14,
  },
  rowLabel: { flex: 1 },
  rowValue: { flexShrink: 1, maxWidth: '46%', textAlign: 'right' },
  note: { fontSize: 14 },
  status: { marginTop: -8, marginBottom: 16, fontSize: 14 },
  disconnect: { marginTop: 24 },
});
