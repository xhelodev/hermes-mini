export type ScheduleMode = 'daily' | 'weekly' | 'hourly' | 'minutes' | 'expression';

export type ScheduleDraft = {
  mode: ScheduleMode;
  hour: string;
  minute: string;
  weekday: number;
  every: string;
  expression: string;
};

export const WEEKDAYS = [
  { id: 1, label: 'Lun' },
  { id: 2, label: 'Mar' },
  { id: 3, label: 'Mié' },
  { id: 4, label: 'Jue' },
  { id: 5, label: 'Vie' },
  { id: 6, label: 'Sáb' },
  { id: 0, label: 'Dom' },
] as const;

const WEEKDAY_PHRASE = [
  'Los domingos',
  'Los lunes',
  'Los martes',
  'Los miércoles',
  'Los jueves',
  'Los viernes',
  'Los sábados',
];

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

function intervalPhrase(count: number, one: 'hora' | 'minuto'): string {
  if (count === 1) return one === 'hora' ? 'Cada hora' : 'Cada minuto';
  return `Cada ${count} ${one === 'hora' ? 'horas' : 'minutos'}`;
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
  return intervalPhrase(count, match[2].toLowerCase().startsWith('h') ? 'hora' : 'minuto');
}

export function phraseSchedule(draft: ScheduleDraft): string | null {
  if (draft.mode === 'daily') {
    const hour = bounded(draft.hour, 0, 23);
    const minute = bounded(draft.minute, 0, 59);
    if (hour == null || minute == null) return null;
    return `Todos los días a las ${clock(hour, minute)}`;
  }
  if (draft.mode === 'weekly') {
    const hour = bounded(draft.hour, 0, 23);
    const minute = bounded(draft.minute, 0, 59);
    const day = WEEKDAY_PHRASE[draft.weekday];
    if (hour == null || minute == null || !day) return null;
    return `${day} a las ${clock(hour, minute)}`;
  }
  if (draft.mode === 'hourly') {
    const every = bounded(draft.every, 1, 23);
    const minute = bounded(draft.minute, 0, 59);
    if (every == null || minute == null) return null;
    const base = intervalPhrase(every, 'hora');
    return minute === 0 ? base : `${base}, al minuto ${String(minute).padStart(2, '0')}`;
  }
  if (draft.mode === 'minutes') {
    const every = bounded(draft.every, 1, 59);
    if (every == null) return null;
    return intervalPhrase(every, 'minuto');
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
  if (!trimmed) return 'Sin horario';
  return phraseSchedule(parseSchedule(trimmed)) ?? trimmed;
}

export function scheduleDetail(expression: string): string | null {
  const trimmed = expression.trim();
  if (!trimmed) return null;
  const label = describeSchedule(trimmed);
  return label === trimmed ? null : trimmed;
}
