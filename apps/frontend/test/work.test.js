import { zonedIso } from '@/hooks/useWorkSession';
import { hms } from '@/services/work';

describe('work helpers', () => {
  test('local time in a zone becomes the right instant', () => {
    expect(zonedIso('2026-11-26', '09:00', 'Asia/Kolkata')).toBe('2026-11-26T03:30:00.000Z');
    expect(zonedIso('2026-11-26', '09:00', 'America/New_York')).toBe('2026-11-26T14:00:00.000Z');
    // Summer time in New York (UTC-4) and across the March change.
    expect(zonedIso('2026-07-01', '09:00', 'America/New_York')).toBe('2026-07-01T13:00:00.000Z');
    expect(zonedIso('2026-03-08', '12:00', 'America/New_York')).toBe('2026-03-08T16:00:00.000Z');
    expect(zonedIso('2026-11-26', '23:45', 'UTC')).toBe('2026-11-26T23:45:00.000Z');
  });

  test('durations are shown in hours and minutes', () => {
    expect(hms(0)).toBe('0m');
    expect(hms(59)).toBe('0m');
    expect(hms(25 * 60)).toBe('25m');
    expect(hms(3725)).toBe('1h 02m');
  });
});
