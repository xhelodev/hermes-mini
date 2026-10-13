import { useEffect, useState } from 'react';
import { ActivityIndicator, Modal, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { CheckIcon } from 'react-native-heroicons/outline';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Text } from '@/components/ui/text';
import { useConnection, useHermesClient } from '@/contexts/connection-context';
import { useTheme } from '@/contexts/theme-context';
import { describeHermesError, type ModelSelection } from '@/lib/hermes';

type ModelSheetProps = {
  visible: boolean;
  title: string;
  sessionId?: string;
  onClose: () => void;
};

export function ModelSheet({ visible, title, sessionId, onClose }: ModelSheetProps) {
  const client = useHermesClient();
  const { defaultModel, modelForSession, setDefaultModel, setSessionModel } = useConnection();
  const { theme } = useTheme();
  const t = theme.tokens;
  const insets = useSafeAreaInsets();
  const [options, setOptions] = useState<ModelSelection[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [locking, setLocking] = useState(false);
  const selected = sessionId ? modelForSession(sessionId) : defaultModel;

  useEffect(() => {
    if (!visible) return;
    let cancelled = false;
    (async () => {
      try {
        const next = await client.listModelOptions();
        if (!cancelled) {
          setOptions(next);
          setError(null);
        }
      } catch (err) {
        if (!cancelled) setError(describeHermesError(err));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [visible, client]);

  async function refresh() {
    setRefreshing(true);
    setError(null);
    try {
      setOptions(await client.listModelOptions(true));
    } catch (err) {
      setError(describeHermesError(err));
    } finally {
      setRefreshing(false);
    }
  }

  async function choose(option: ModelSelection) {
    if (!sessionId) {
      setDefaultModel(option);
      onClose();
      return;
    }
    setLocking(true);
    setError(null);
    try {
      await client.lockSessionModel(sessionId, option);
      setSessionModel(sessionId, option);
      onClose();
    } catch (err) {
      setError(describeHermesError(err));
    } finally {
      setLocking(false);
    }
  }

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <Pressable accessibilityLabel="Cerrar" style={styles.dismiss} onPress={onClose} />
        <View style={[styles.sheet, { backgroundColor: t.bg, paddingBottom: insets.bottom + 16 }]}>
          <View style={[styles.handle, { backgroundColor: t.bd }]} />
          <Text style={[styles.title, { color: t.fg }]}>{title}</Text>
          <View style={styles.subtitleRow}>
            <Text style={[styles.subtitle, { color: t.mut }]}>Lista traída de tu servidor</Text>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Actualizar modelos"
              disabled={refreshing || locking}
              onPress={() => {
                void refresh();
              }}
            >
              <Text style={{ color: t.fg }}>{refreshing ? '…' : 'Actualizar'}</Text>
            </Pressable>
          </View>
          {options === null && !error ? <ActivityIndicator color={t.pri} /> : null}
          {error ? <Text style={styles.error}>{error}</Text> : null}
          <ScrollView>
            {(options ?? []).map((option) => {
              const active =
                selected?.providerId === option.providerId && selected.modelId === option.modelId;
              const isDefault =
                defaultModel?.providerId === option.providerId &&
                defaultModel.modelId === option.modelId;
              return (
                <Pressable
                  key={`${option.providerId}:${option.modelId}`}
                  disabled={locking}
                  onPress={() => {
                    void choose(option);
                  }}
                  style={[
                    styles.option,
                    { borderColor: active ? t.pri : t.bd, backgroundColor: t.card },
                  ]}
                >
                  <View style={styles.optionText}>
                    <Text style={[styles.optionLabel, { color: t.fg }]}>{option.label}</Text>
                    <Text style={[styles.optionMeta, { color: t.mut }]}>
                      {isDefault ? 'por defecto' : option.providerLabel}
                    </Text>
                  </View>
                  {active ? <CheckIcon color={t.fg} size={20} /> : null}
                </Pressable>
              );
            })}
            {options && options.length === 0 && !error ? (
              <Text style={{ color: t.mut }}>El servidor no devolvió modelos.</Text>
            ) : null}
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.45)' },
  dismiss: { flex: 1 },
  sheet: { maxHeight: '70%', borderTopLeftRadius: 24, borderTopRightRadius: 24, paddingHorizontal: 16, paddingTop: 12 },
  handle: { marginBottom: 12, height: 4, width: 40, alignSelf: 'center', borderRadius: 999 },
  title: { fontSize: 18, fontWeight: '600' },
  subtitleRow: {
    marginBottom: 12,
    marginTop: 4,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  subtitle: { flex: 1, fontSize: 14 },
  error: { marginBottom: 8, fontSize: 14, color: '#ef4444' },
  option: {
    marginBottom: 8,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderRadius: 12,
    borderWidth: 1,
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  optionText: { flex: 1, paddingRight: 12 },
  optionLabel: { fontWeight: '600' },
  optionMeta: { fontSize: 14 },
});
