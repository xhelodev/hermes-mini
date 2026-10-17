import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';

import { ScheduleField } from '@/components/schedule-field';
import { ScreenShell } from '@/components/screen-shell';
import { Button } from '@/components/ui/button';
import { Field } from '@/components/ui/input';
import { Text } from '@/components/ui/text';
import { useHermesClient } from '@/contexts/connection-context';
import { useStrings } from '@/contexts/i18n-context';
import { useTheme } from '@/contexts/theme-context';
import { confirmAction } from '@/lib/confirm';
import { describeHermesError, HermesError } from '@/lib/hermes';
import { strings } from '@/lib/i18n';

type JobEditorProps = {
  jobId?: string;
};

export function JobEditor({ jobId }: JobEditorProps) {
  const client = useHermesClient();
  const { theme } = useTheme();
  const t = theme.tokens;
  const str = useStrings();
  const text = str.jobs;
  const [name, setName] = useState('');
  const [schedule, setSchedule] = useState('');
  const [prompt, setPrompt] = useState('');
  const [paused, setPaused] = useState(false);
  const [loading, setLoading] = useState(Boolean(jobId));
  const [saving, setSaving] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    if (!jobId) return;
    let cancelled = false;
    (async () => {
      try {
        const job = await client.getJob(jobId);
        if (cancelled) return;
        setName(job.name);
        setSchedule(job.schedule);
        setPrompt(job.prompt);
        setPaused(job.paused);
        setError(null);
      } catch (err) {
        if (!cancelled) setError(jobError(err));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [client, jobId]);

  async function onSave() {
    if (!name.trim() || !schedule.trim() || !prompt.trim()) {
      setNotice(null);
      setError(text.incomplete);
      return;
    }
    setSaving(true);
    setNotice(null);
    setError(null);
    try {
      const input = { name: name.trim(), schedule: schedule.trim(), prompt: prompt.trim() };
      if (jobId) {
        const next = await client.patchJob(jobId, input);
        setPaused(next.paused);
        setNotice(text.saved);
      } else {
        const created = await client.createJob(input);
        router.replace({ pathname: '/jobs/[id]', params: { id: created.id } });
      }
    } catch (err) {
      setError(jobError(err));
    } finally {
      setSaving(false);
    }
  }

  async function onTogglePause() {
    if (!jobId) return;
    setBusy(true);
    setError(null);
    try {
      const next = paused ? await client.resumeJob(jobId) : await client.pauseJob(jobId);
      setPaused(next.paused);
    } catch (err) {
      setError(jobError(err));
    } finally {
      setBusy(false);
    }
  }

  async function onRun() {
    if (!jobId) return;
    setBusy(true);
    setError(null);
    try {
      await client.runJob(jobId);
      setNotice(text.runRequested);
    } catch (err) {
      setError(jobError(err));
    } finally {
      setBusy(false);
    }
  }

  function onDelete() {
    if (!jobId) return;
    const remove = () => {
      void (async () => {
        setBusy(true);
        try {
          await client.deleteJob(jobId);
          router.back();
        } catch (err) {
          setError(jobError(err));
          setBusy(false);
        }
      })();
    };
    confirmAction({
      title: text.deleteTitle,
      message: str.common.deleteFromServer,
      confirmLabel: str.common.delete,
      destructive: true,
      onConfirm: remove,
    });
  }

  return (
    <ScreenShell title={jobId ? name || text.job : text.newJob} onBack={() => router.back()}>
      {loading ? <ActivityIndicator color={t.pri} /> : null}
      {error ? <Text style={styles.error}>{error}</Text> : null}
      {notice ? <Text style={[styles.saved, { color: t.mut }]}>{notice}</Text> : null}
      {loading ? null : (
        <View>
          <Field
            label={text.name}
            value={name}
            onChangeText={setName}
            placeholder={text.namePlaceholder}
            borderColor={t.bd}
            backgroundColor={t.card}
            textColor={t.fg}
            mutedColor={t.mut}
          />
          <ScheduleField value={schedule} onChange={setSchedule} />
          <Field
            label={text.prompt}
            value={prompt}
            onChangeText={setPrompt}
            placeholder={text.promptPlaceholder}
            multiline
            borderColor={t.bd}
            backgroundColor={t.card}
            textColor={t.fg}
            mutedColor={t.mut}
          />
          <Button
            label={saving ? text.saving : jobId ? text.save : text.create}
            backgroundColor={t.pri}
            textColor={t.pfg}
            disabled={saving || busy}
            onPress={() => {
              void onSave();
            }}
          />
          {jobId ? (
            <View style={styles.actions}>
              <Button
                label={paused ? text.resume : text.pause}
                variant="outline"
                borderColor={t.bd}
                textColor={t.fg}
                disabled={busy || saving}
                onPress={() => {
                  void onTogglePause();
                }}
              />
              <Button
                label={text.runNow}
                variant="outline"
                borderColor={t.bd}
                textColor={t.fg}
                disabled={busy || saving}
                onPress={() => {
                  void onRun();
                }}
              />
              <Button
                label={str.common.delete}
                variant="outline"
                borderColor={t.bd}
                textColor={t.fg}
                disabled={busy || saving}
                onPress={onDelete}
              />
            </View>
          ) : null}
        </View>
      )}
    </ScreenShell>
  );
}

function jobError(error: unknown): string {
  if (error instanceof HermesError && error.status === 404) return strings().jobs.notFound;
  return describeHermesError(error);
}

const styles = StyleSheet.create({
  error: { marginBottom: 12, fontSize: 14, color: '#ef4444' },
  saved: { marginBottom: 12, fontSize: 14 },
  actions: { marginTop: 16, gap: 8 },
});
