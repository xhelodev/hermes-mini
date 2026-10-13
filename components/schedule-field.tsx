import { useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { Field } from '@/components/ui/input';
import { Text } from '@/components/ui/text';
import { useTheme } from '@/contexts/theme-context';
import {
  WEEKDAYS,
  compileSchedule,
  describeSchedule,
  parseSchedule,
  type ScheduleDraft,
  type ScheduleMode,
} from '@/lib/schedule';

const MODES: { id: ScheduleMode; label: string }[] = [
  { id: 'daily', label: 'Cada día' },
  { id: 'weekly', label: 'Semanal' },
  { id: 'hourly', label: 'Por horas' },
  { id: 'minutes', label: 'Por minutos' },
  { id: 'expression', label: 'Expresión' },
];

type ScheduleFieldProps = {
  value: string;
  onChange: (value: string) => void;
};

export function ScheduleField({ value, onChange }: ScheduleFieldProps) {
  const { theme } = useTheme();
  const t = theme.tokens;
  const [draft, setDraft] = useState(() => parseSchedule(value));
  const emitted = useRef<string | null>(null);

  useEffect(() => {
    if (value === emitted.current) return;
    setDraft(parseSchedule(value));
  }, [value]);

  function update(next: ScheduleDraft) {
    setDraft(next);
    const compiled = compileSchedule(next) ?? '';
    emitted.current = compiled;
    onChange(compiled);
  }

  function setMode(mode: ScheduleMode) {
    const source = compileSchedule(draft) ?? '';
    const parsed = parseSchedule(source);
    const next: ScheduleDraft = {
      ...draft,
      ...parsed,
      mode,
      expression: mode === 'expression' ? source || draft.expression : parsed.expression,
    };
    if (mode === 'minutes' && parsed.mode !== 'minutes') next.every = '15';
    if (mode === 'hourly' && parsed.mode !== 'hourly') next.every = '2';
    update(next);
  }

  const compiled = compileSchedule(draft);
  const phrase = compiled ? describeSchedule(compiled) : null;

  return (
    <View style={styles.wrap}>
      <Text style={[styles.label, { color: t.mut }]}>Horario</Text>
      <View style={styles.modes}>
        {MODES.map((mode) => {
          const selected = draft.mode === mode.id;
          return (
            <Pressable
              key={mode.id}
              accessibilityRole="button"
              accessibilityState={{ selected }}
              onPress={() => setMode(mode.id)}
              style={[
                styles.mode,
                {
                  borderColor: selected ? t.pri : t.bd,
                  backgroundColor: t.card,
                  borderWidth: selected ? 2 : 1,
                },
              ]}
            >
              <Text style={{ color: t.fg }}>{mode.label}</Text>
            </Pressable>
          );
        })}
      </View>
      {draft.mode === 'weekly' ? (
        <View style={styles.days}>
          {WEEKDAYS.map((day) => {
            const selected = draft.weekday === day.id;
            return (
              <Pressable
                key={day.id}
                accessibilityRole="button"
                accessibilityState={{ selected }}
                onPress={() => update({ ...draft, weekday: day.id })}
                style={[
                  styles.day,
                  {
                    borderColor: selected ? t.pri : t.bd,
                    backgroundColor: t.card,
                    borderWidth: selected ? 2 : 1,
                  },
                ]}
              >
                <Text style={{ color: t.fg }}>{day.label}</Text>
              </Pressable>
            );
          })}
        </View>
      ) : null}
      {draft.mode === 'daily' || draft.mode === 'weekly' ? (
        <View style={styles.pair}>
          <View style={styles.pairCell}>
            <Field
              label="Hora"
              value={draft.hour}
              onChangeText={(hour) => update({ ...draft, hour })}
              keyboardType="number-pad"
              placeholder="4"
              borderColor={t.bd}
              backgroundColor={t.card}
              textColor={t.fg}
              mutedColor={t.mut}
            />
          </View>
          <View style={styles.pairCell}>
            <Field
              label="Minuto"
              value={draft.minute}
              onChangeText={(minute) => update({ ...draft, minute })}
              keyboardType="number-pad"
              placeholder="30"
              borderColor={t.bd}
              backgroundColor={t.card}
              textColor={t.fg}
              mutedColor={t.mut}
            />
          </View>
        </View>
      ) : null}
      {draft.mode === 'hourly' || draft.mode === 'minutes' ? (
        <Field
          label={draft.mode === 'hourly' ? 'Cada cuántas horas' : 'Cada cuántos minutos'}
          value={draft.every}
          onChangeText={(every) => update({ ...draft, every })}
          keyboardType="number-pad"
          placeholder={draft.mode === 'hourly' ? '2' : '15'}
          borderColor={t.bd}
          backgroundColor={t.card}
          textColor={t.fg}
          mutedColor={t.mut}
        />
      ) : null}
      {draft.mode === 'hourly' ? (
        <Field
          label="Minuto"
          value={draft.minute}
          onChangeText={(minute) => update({ ...draft, minute })}
          keyboardType="number-pad"
          placeholder="0"
          borderColor={t.bd}
          backgroundColor={t.card}
          textColor={t.fg}
          mutedColor={t.mut}
        />
      ) : null}
      {draft.mode === 'expression' ? (
        <Field
          label="Expresión"
          value={draft.expression}
          onChangeText={(expression) => update({ ...draft, expression })}
          autoCapitalize="none"
          autoCorrect={false}
          placeholder="30 4 * * * o every 2h"
          borderColor={t.bd}
          backgroundColor={t.card}
          textColor={t.fg}
          mutedColor={t.mut}
        />
      ) : null}
      {phrase ? <Text style={{ color: t.fg }}>{phrase}</Text> : null}
      <Text style={[styles.note, { color: t.mut }]}>
        {compiled ? `Se guarda como ${compiled}` : 'Completá el horario.'}
      </Text>
      <Text style={[styles.hint, { color: t.mut }]}>La hora es la del servidor.</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { marginBottom: 8 },
  label: { marginBottom: 6, fontSize: 14 },
  modes: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 12 },
  mode: { borderRadius: 12, paddingHorizontal: 12, paddingVertical: 10 },
  days: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 12 },
  day: { borderRadius: 12, paddingHorizontal: 10, paddingVertical: 10 },
  pair: { flexDirection: 'row', gap: 12 },
  pairCell: { flex: 1 },
  note: { marginBottom: 4, fontSize: 14 },
  hint: { marginBottom: 16, fontSize: 14 },
});
