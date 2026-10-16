import { useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { Field } from '@/components/ui/input';
import { Text } from '@/components/ui/text';
import { useStrings } from '@/contexts/i18n-context';
import { useTheme } from '@/contexts/theme-context';
import {
  WEEKDAYS,
  compileSchedule,
  weekdayShort,
  describeSchedule,
  parseSchedule,
  type ScheduleDraft,
  type ScheduleMode,
} from '@/lib/schedule';

const MODES: ScheduleMode[] = ['daily', 'weekly', 'hourly', 'minutes', 'expression'];

type ScheduleFieldProps = {
  value: string;
  onChange: (value: string) => void;
};

export function ScheduleField({ value, onChange }: ScheduleFieldProps) {
  const { theme } = useTheme();
  const t = theme.tokens;
  const text = useStrings().scheduleField;
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
      <Text style={[styles.label, { color: t.mut }]}>{text.label}</Text>
      <View style={styles.modes}>
        {MODES.map((mode) => {
          const selected = draft.mode === mode;
          return (
            <Pressable
              key={mode}
              accessibilityRole="button"
              accessibilityState={{ selected }}
              onPress={() => setMode(mode)}
              style={[
                styles.mode,
                {
                  borderColor: selected ? t.pri : t.bd,
                  backgroundColor: t.card,
                  borderWidth: selected ? 2 : 1,
                },
              ]}
            >
              <Text style={{ color: t.fg }}>{text.modes[mode]}</Text>
            </Pressable>
          );
        })}
      </View>
      {draft.mode === 'weekly' ? (
        <View style={styles.days}>
          {WEEKDAYS.map((day) => {
            const selected = draft.weekday === day;
            return (
              <Pressable
                key={day}
                accessibilityRole="button"
                accessibilityState={{ selected }}
                onPress={() => update({ ...draft, weekday: day })}
                style={[
                  styles.day,
                  {
                    borderColor: selected ? t.pri : t.bd,
                    backgroundColor: t.card,
                    borderWidth: selected ? 2 : 1,
                  },
                ]}
              >
                <Text style={{ color: t.fg }}>{weekdayShort(day)}</Text>
              </Pressable>
            );
          })}
        </View>
      ) : null}
      {draft.mode === 'daily' || draft.mode === 'weekly' ? (
        <View style={styles.pair}>
          <View style={styles.pairCell}>
            <Field
              label={text.hour}
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
              label={text.minute}
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
          label={draft.mode === 'hourly' ? text.everyHours : text.everyMinutes}
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
          label={text.minute}
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
          label={text.modes.expression}
          value={draft.expression}
          onChangeText={(expression) => update({ ...draft, expression })}
          autoCapitalize="none"
          autoCorrect={false}
          placeholder={text.expressionPlaceholder}
          borderColor={t.bd}
          backgroundColor={t.card}
          textColor={t.fg}
          mutedColor={t.mut}
        />
      ) : null}
      {phrase ? <Text style={{ color: t.fg }}>{phrase}</Text> : null}
      <Text style={[styles.note, { color: t.mut }]}>
        {compiled ? text.savedAs(compiled) : text.incomplete}
      </Text>
      <Text style={[styles.hint, { color: t.mut }]}>{text.serverTime}</Text>
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
