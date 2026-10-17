import { strings } from '@/lib/i18n';

export type ScheduleMode = 'daily' | 'weekly' | 'hourly' | 'minutes' | 'expression';

export type ScheduleDraft = {
  mode: ScheduleMode;
  hour: string;
  minute: string;
  weekday: number;
  every: string;
  expression: string;
};

/** Días en el orden del selector (lunes primero), con el número de cron. */
export const WEEKDAYS = [1, 2, 3, 4, 5, 6, 0] as const;

export function weekdayShort(day: number): string {
  return strings().schedule.weekdayShort[day] ?? '';
}

function emptyDraft(expression = ''): ScheduleDraft {
  return {
    mode: 'expression',
    hour: '9',
    minute: '0',
    weekday: 1,
    every: '2',
    expression,
  };
}

function clock(hour: number, minute: number): string {
  return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
}

function intervalPhrase(count: number, unit: 'hour' | 'minute'): string {
  const text = strings().schedule;
  return unit === 'hour' ? text.everyHours(count) : text.everyMinutes(count);
}

function bounded(value: string, min: number, max: number): number | null {
  if (!/^\d{1,2}$/.test(value.trim())) return null;
  const parsed = Number(value);
  if (parsed < min || parsed > max) return null;
  return parsed;
}

function loosePhrase(expression: string): string | null {
  const match = expression.match(/^every\s+(\d+)\s*(h|hr|hrs|hours|m|min|mins|minutes)$/i);
  if (!match) return null;
  const count = Number(match[1]);
  if (!Number.isFinite(count) || count < 1) return null;
  return intervalPhrase(count, match[2].toLowerCase().startsWith('h') ? 'hour' : 'minute');
}

export function phraseSchedule(draft: ScheduleDraft): string | null {
  if (draft.mode === 'daily') {
    const hour = bounded(draft.hour, 0, 23);
    const minute = bounded(draft.minute, 0, 59);
    if (hour == null || minute == null) return null;
    return strings().schedule.daily(clock(hour, minute));
  }
  if (draft.mode === 'weekly') {
    const hour = bounded(draft.hour, 0, 23);
    const minute = bounded(draft.minute, 0, 59);
    if (hour == null || minute == null) return null;
    const day = strings().schedule.weekly[draft.weekday];
    if (!day) return null;
    return day(clock(hour, minute));
  }
  if (draft.mode === 'hourly') {
    const every = bounded(draft.every, 1, 23);
    const minute = bounded(draft.minute, 0, 59);
    if (every == null || minute == null) return null;
    const base = intervalPhrase(every, 'hour');
    return minute === 0 ? base : strings().schedule.atMinute(base, String(minute).padStart(2, '0'));
  }
  if (draft.mode === 'minutes') {
    const every = bounded(draft.every, 1, 59);
    if (every == null) return null;
    return intervalPhrase(every, 'minute');
  }
  const expression = draft.expression.trim();
  if (!expression) return null;
  return loosePhrase(expression) ?? expression;
}

export function compileSchedule(draft: ScheduleDraft): string | null {
  if (draft.mode === 'daily') {
    const hour = bounded(draft.hour, 0, 23);
    const minute = bounded(draft.minute, 0, 59);
    if (hour == null || minute == null) return null;
    return `${minute} ${hour} * * *`;
  }
  if (draft.mode === 'weekly') {
    const hour = bounded(draft.hour, 0, 23);
    const minute = bounded(draft.minute, 0, 59);
    if (hour == null || minute == null || draft.weekday < 0 || draft.weekday > 6) return null;
    return `${minute} ${hour} * * ${draft.weekday}`;
  }
  if (draft.mode === 'hourly') {
    const every = bounded(draft.every, 1, 23);
    const minute = bounded(draft.minute, 0, 59);
    if (every == null || minute == null) return null;
    return `${minute} */${every} * * *`;
  }
  if (draft.mode === 'minutes') {
    const every = bounded(draft.every, 1, 59);
    if (every == null) return null;
    return `*/${every} * * * *`;
  }
  const expression = draft.expression.trim();
  return expression || null;
}

export function parseSchedule(expression: string): ScheduleDraft {
  const trimmed = expression.trim();
  const draft = emptyDraft(trimmed);
  const parts = trimmed.split(/\s+/);
  if (parts.length !== 5) return draft;
  const [minute, hour, day, month, weekday] = parts;
  if (day !== '*' || month !== '*') return draft;

  const step = /^\*\/(\d+)$/;
  const minuteStep = minute.match(step);
  if (minuteStep && hour === '*' && weekday === '*') {
    return { ...draft, mode: 'minutes', every: String(Number(minuteStep[1])) };
  }
  const hourStep = hour.match(step);
  if (/^\d{1,2}$/.test(minute) && hourStep && weekday === '*') {
    return { ...draft, mode: 'hourly', minute, every: String(Number(hourStep[1])) };
  }
  if (/^\d{1,2}$/.test(minute) && /^\d{1,2}$/.test(hour) && weekday === '*') {
    return { ...draft, mode: 'daily', minute, hour };
  }
  if (/^\d{1,2}$/.test(minute) && /^\d{1,2}$/.test(hour) && /^\d$/.test(weekday)) {
    const dayIndex = Number(weekday) === 7 ? 0 : Number(weekday);
    if (dayIndex > 6) return draft;
    return { ...draft, mode: 'weekly', minute, hour, weekday: dayIndex };
  }
  return draft;
}

export function describeSchedule(expression: string): string {
  const trimmed = expression.trim();
  if (!trimmed) return strings().schedule.none;
  return phraseSchedule(parseSchedule(trimmed)) ?? trimmed;
}

export function scheduleDetail(expression: string): string | null {
  const trimmed = expression.trim();
  if (!trimmed) return null;
  const label = describeSchedule(trimmed);
  return label === trimmed ? null : trimmed;
}
