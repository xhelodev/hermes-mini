import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';

import { ScreenShell } from '@/components/screen-shell';
import { Text } from '@/components/ui/text';
import { RequireConnection, useHermesClient } from '@/contexts/connection-context';
import { useStrings } from '@/contexts/i18n-context';
import { useTheme } from '@/contexts/theme-context';
import { describeHermesError, HermesError, type HermesSkill, type HermesToolset } from '@/lib/hermes';

export default function HabilidadesScreen() {
  return (
    <RequireConnection>
      <HabilidadesBody />
    </RequireConnection>
  );
}

function HabilidadesBody() {
  const client = useHermesClient();
  const { theme } = useTheme();
  const t = theme.tokens;
  const text = useStrings().skills;
  const [skills, setSkills] = useState<HermesSkill[] | null>(null);
  const [toolsets, setToolsets] = useState<HermesToolset[] | null>(null);
  const [skillsError, setSkillsError] = useState<string | null>(null);
  const [toolsetsError, setToolsetsError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const next = await client.listSkills();
        if (cancelled) return;
        setSkills(next);
        setSkillsError(null);
      } catch (err) {
        if (!cancelled) {
          setSkills([]);
          setSkillsError(sectionError(err, text.skillsFailed));
        }
      }
    })();
    (async () => {
      try {
        const next = await client.listToolsets();
        if (cancelled) return;
        setToolsets(next);
        setToolsetsError(null);
      } catch (err) {
        if (!cancelled) {
          setToolsets([]);
          setToolsetsError(sectionError(err, text.toolsFailed));
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [client, text]);

  return (
    <ScreenShell title={text.title} onBack={() => router.back()}>
      <Text style={[styles.heading, { color: t.fg }]}>{text.skills}</Text>
      {skills === null ? <ActivityIndicator color={t.pri} /> : null}
      {skillsError ? <Text style={styles.error}>{skillsError}</Text> : null}
      {skills && skills.length === 0 && !skillsError ? (
        <Text style={{ color: t.mut }}>{text.noSkills}</Text>
      ) : null}
      {(skills ?? []).map((skill) => (
        <View key={skill.name} style={[styles.card, { borderColor: t.bd, backgroundColor: t.card }]}>
          <Text style={{ color: t.fg }}>{skill.name}</Text>
          {skill.category ? <Text style={[styles.meta, { color: t.mut }]}>{skill.category}</Text> : null}
          {skill.description ? (
            <Text style={[styles.meta, { color: t.mut }]}>{skill.description}</Text>
          ) : null}
        </View>
      ))}
      <Text style={[styles.heading, { color: t.fg }]}>{text.tools}</Text>
      {toolsets === null ? <ActivityIndicator color={t.pri} /> : null}
      {toolsetsError ? <Text style={styles.error}>{toolsetsError}</Text> : null}
      {toolsets && toolsets.length === 0 && !toolsetsError ? (
        <Text style={{ color: t.mut }}>{text.noTools}</Text>
      ) : null}
      {(toolsets ?? []).map((toolset) => (
        <View key={toolset.name} style={[styles.card, { borderColor: t.bd, backgroundColor: t.card }]}>
          <View style={styles.row}>
            <Text style={[styles.flex, { color: t.fg }]}>{toolset.label}</Text>
            <Text style={{ color: t.mut }}>{toolset.enabled ? text.enabled : text.disabled}</Text>
          </View>
          {toolset.description ? (
            <Text style={[styles.meta, { color: t.mut }]}>{toolset.description}</Text>
          ) : null}
        </View>
      ))}
    </ScreenShell>
  );
}

function sectionError(error: unknown, serverMessage: string): string {
  if (error instanceof HermesError && error.status != null && error.status >= 500) {
    return serverMessage;
  }
  return describeHermesError(error);
}

const styles = StyleSheet.create({
  heading: { marginTop: 8, marginBottom: 8, fontSize: 18, fontWeight: '600' },
  card: { marginBottom: 8, borderRadius: 12, borderWidth: 1, paddingHorizontal: 16, paddingVertical: 12 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  flex: { flex: 1, fontWeight: '600' },
  meta: { marginTop: 4, fontSize: 14 },
  error: { marginBottom: 12, fontSize: 14, color: '#ef4444' },
});
