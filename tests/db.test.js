const { initDb, getGuildSettings, updateGuildSetting, checkUserCooldown, updateUserCooldown, saveActiveMute, removeActiveMute, getPendingMutes } = require('../src/db/database');

describe('Database Layer', () => {
  beforeAll(() => {
    initDb(':memory:');
  });

  test('default guild settings are returned if not explicitly set', () => {
    const settings = getGuildSettings('12345');
    expect(settings.threshold_type).toBe('fixed');
    expect(settings.threshold_value).toBe(5);
    expect(settings.poll_duration_seconds).toBe(300);
    expect(settings.user_cooldown_seconds).toBe(600);
  });

  test('updating guild settings persists value', () => {
    updateGuildSetting('12345', 'threshold_value', 10);
    const settings = getGuildSettings('12345');
    expect(settings.threshold_value).toBe(10);
  });

  test('user cooldown tracking', () => {
    expect(checkUserCooldown('12345', 'user1', 600)).toBe(true);
    updateUserCooldown('12345', 'user1');
    expect(checkUserCooldown('12345', 'user1', 600)).toBe(false);
  });

  test('active mute tracking and recovery', () => {
    const now = Math.floor(Date.now() / 1000);
    saveActiveMute('g1', 'u1', now + 300);
    const pending = getPendingMutes();
    expect(pending.length).toBe(1);
    expect(pending[0].user_id).toBe('u1');

    removeActiveMute('g1', 'u1');
    expect(getPendingMutes().length).toBe(0);
  });
});
