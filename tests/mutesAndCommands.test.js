const {
  initDb,
  saveActiveMute,
  removeActiveMute,
  getActiveMuteForUser,
  getExpiredMutes
} = require('../src/db/database');

const { findPollByTarget, activePolls, commands } = require('../src/index');

describe('Database Mute Tracking & Voice Management', () => {
  beforeAll(() => {
    initDb(':memory:');
  });

  test('saves, retrieves, and checks active mute for user', () => {
    const guildId = 'guild123';
    const userId = 'user456';
    const unmuteAt = Math.floor(Date.now() / 1000) + 300; // 5 minutes in future

    saveActiveMute(guildId, userId, unmuteAt);

    const activeMute = getActiveMuteForUser(guildId, userId);
    expect(activeMute).toBeDefined();
    expect(activeMute.guild_id).toBe(guildId);
    expect(activeMute.user_id).toBe(userId);
    expect(activeMute.unmute_at).toBe(unmuteAt);
  });

  test('detects expired mutes correctly', () => {
    const guildId = 'guild123';
    const expiredUser = 'user_expired';
    const pastTimestamp = Math.floor(Date.now() / 1000) - 10; // expired 10 seconds ago

    saveActiveMute(guildId, expiredUser, pastTimestamp);

    const expiredList = getExpiredMutes(guildId, expiredUser);
    expect(expiredList.length).toBe(1);
    expect(expiredList[0].user_id).toBe(expiredUser);
  });

  test('removes active mute from DB', () => {
    const guildId = 'guild123';
    const userId = 'user456';

    removeActiveMute(guildId, userId);

    const activeMute = getActiveMuteForUser(guildId, userId);
    expect(activeMute).toBeUndefined();
  });
});

describe('Active Poll Target Lookup & Command Structure', () => {
  beforeEach(() => {
    activePolls.clear();
  });

  test('finds active poll by target user id', () => {
    const mockPoll = {
      channelId: 'chan_1',
      targetId: 'user_target_99',
      stage: 1,
      action: 'mute'
    };
    activePolls.set('chan_1', mockPoll);

    const found = findPollByTarget('user_target_99');
    expect(found).toBeDefined();
    expect(found.channelId).toBe('chan_1');
    expect(found.stage).toBe(1);
  });

  test('returns null if target user has no active poll', () => {
    const found = findPollByTarget('non_existent_user');
    expect(found).toBeNull();
  });

  test('contains /check-status and /skip-stage in registered slash commands', () => {
    const commandNames = commands.map(c => c.name);
    expect(commandNames).toContain('vote-punish');
    expect(commandNames).toContain('stop-vote');
    expect(commandNames).toContain('config');
    expect(commandNames).toContain('check-status');
    expect(commandNames).toContain('skip-stage');
  });
});
