import { compileSchedule, describeSchedule, parseSchedule } from '@/lib/schedule';

describe('horario', () => {
  it('traduce los cron simples', () => {
    expect(describeSchedule('30 4 * * *')).toBe('Todos los días a las 04:30');
    expect(describeSchedule('0 9 * * 1')).toBe('Los lunes a las 09:00');
    expect(describeSchedule('0 */2 * * *')).toBe('Cada 2 horas');
    expect(describeSchedule('*/15 * * * *')).toBe('Cada 15 minutos');
  });

  it('arma de nuevo el cron que se puede editar', () => {
    expect(compileSchedule(parseSchedule('30 4 * * *'))).toBe('30 4 * * *');
    expect(compileSchedule(parseSchedule('0 9 * * 1'))).toBe('0 9 * * 1');
    expect(compileSchedule(parseSchedule('0 */2 * * *'))).toBe('0 */2 * * *');
    expect(compileSchedule(parseSchedule('*/15 * * * *'))).toBe('*/15 * * * *');
    expect(
      compileSchedule({
        mode: 'daily',
        hour: '4',
        minute: '30',
        weekday: 1,
        every: '2',
        expression: '',
      }),
    ).toBe('30 4 * * *');
  });

  it('deja la expresión cuando no entra en un modo simple', () => {
    expect(parseSchedule('0 0 1 * *').mode).toBe('expression');
    expect(describeSchedule('0 0 1 * *')).toBe('0 0 1 * *');
    expect(parseSchedule('every 2h').mode).toBe('expression');
    expect(describeSchedule('every 2h')).toBe('Cada 2 horas');
    expect(compileSchedule(parseSchedule('every 2h'))).toBe('every 2h');
  });

  it('rechaza una hora imposible', () => {
    expect(
      compileSchedule({
        mode: 'daily',
        hour: '24',
        minute: '0',
        weekday: 1,
        every: '2',
        expression: '',
      }),
    ).toBeNull();
  });
});
