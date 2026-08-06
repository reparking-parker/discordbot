const {
  initDb,
  saveActivePunishment,
  removeActivePunishment,
  getActivePunishmentForUser,
  getAllActivePunishmentsForUser,
  getExpiredPunishments
} = require('../src/db/database');

const { findPollByTarget, activePolls, commands } = require('../src/index');

describe('Database Punishment Tracking & Voice Deafen Management', () => {
  beforeAll(() => {
    initDb(':memory:');
  });

  test('saves, retrieves, and checks active mute & deafen for user', () => {
    const guildId = 'guild123';
    const userId = 'user456';
    const unmuteAt = Math.floor(Date.now() / 1000) + 300;

    saveActivePunishment(guildId, userId, 'mute', unmuteAt);
    saveActivePunishment(guildId, userId, 'deafen', unmuteAt);

    const activeMute = getActivePunishmentForUser(guildId, userId, 'mute');
    expect(activeMute).toBeDefined();
    expect(activeMute.punishment_type).toBe('mute');

    const activeDeafen = getActivePunishmentForUser(guildId, userId, 'deafen');
    expect(activeDeafen).toBeDefined();
    expect(activeDeafen.punishment_type).toBe('deafen');

    const all = getAllActivePunishmentsForUser(guildId, userId);
    expect(all.length).toBe(2);
  });

  test('detects expired deafens & mutes correctly', () => {
    const guildId = 'guild123';
    const expiredUser = 'user_expired_deafen';
    const pastTimestamp = Math.floor(Date.now() / 1000) - 10;

    saveActivePunishment(guildId, expiredUser, 'deafen', pastTimestamp);

    const expiredList = getExpiredPunishments(guildId, expiredUser);
    expect(expiredList.length).toBe(1);
    expect(expiredList[0].punishment_type).toBe('deafen');
  });

  test('removes specific active punishment from DB', () => {
    const guildId = 'guild123';
    const userId = 'user456';

    removeActivePunishment(guildId, userId, 'mute');
    expect(getActivePunishmentForUser(guildId, userId, 'mute')).toBeUndefined();
    expect(getActivePunishmentForUser(guildId, userId, 'deafen')).toBeDefined();

    removeActivePunishment(guildId, userId); // removes remaining
    expect(getAllActivePunishmentsForUser(guildId, userId).length).toBe(0);
  });
});

describe('Slash Commands & Options Structure', () => {
  beforeEach(() => {
    activePolls.clear();
  });

  test('contains /vote-pardon and deafen action choice in slash commands', () => {
    const commandNames = commands.map(c => c.name);
    expect(commandNames).toContain('vote-punish');
    expect(commandNames).toContain('vote-pardon');
    expect(commandNames).toContain('stop-vote');
    expect(commandNames).toContain('config');
    expect(commandNames).toContain('check-status');
    expect(commandNames).toContain('skip-stage');

    const votePunishCmd = commands.find(c => c.name === 'vote-punish');
    const actionOption = votePunishCmd.options.find(o => o.name === 'action');
    const actionChoices = actionOption.choices.map(choice => choice.value);
    expect(actionChoices).toContain('timeout');
    expect(actionChoices).toContain('mute');
    expect(actionChoices).toContain('deafen');
  });
});
