const { evaluateStage1Result, checkImmunity } = require('../src/logic/democracyEngine');

describe('Democracy Engine Logic', () => {
  test('evaluateStage1Result with fixed threshold', () => {
    const settings = { threshold_type: 'fixed', threshold_value: 3 };
    const votes = { yes: ['u1', 'u2', 'u3'], no: ['u4'] };
    expect(evaluateStage1Result(votes, settings)).toBe(true);

    const votesFailed = { yes: ['u1', 'u2'], no: ['u4'] };
    expect(evaluateStage1Result(votesFailed, settings)).toBe(false);
  });

  test('evaluateStage1Result with percentage threshold', () => {
    const settings = { threshold_type: 'percentage', threshold_value: 60 };
    // 3 yes out of 4 votes = 75% -> pass
    const votesPass = { yes: ['u1', 'u2', 'u3'], no: ['u4'] };
    expect(evaluateStage1Result(votesPass, settings)).toBe(true);

    // 1 yes out of 4 votes = 25% -> fail
    const votesFail = { yes: ['u1'], no: ['u2', 'u3', 'u4'] };
    expect(evaluateStage1Result(votesFail, settings)).toBe(false);
  });

  test('evaluateStage1Result with voice channel member count (VC context)', () => {
    const settings = { threshold_type: 'percentage', threshold_value: 60 };
    // 3 yes out of 4 VC human voters = 75% -> pass
    const votesPass = { yes: ['u1', 'u2', 'u3'], no: [] };
    expect(evaluateStage1Result(votesPass, settings, 4)).toBe(true);

    // 1 yes out of 4 VC human voters = 25% -> fail
    const votesFail = { yes: ['u1'], no: [] };
    expect(evaluateStage1Result(votesFail, settings, 4)).toBe(false);
  });

  test('evaluateStage1Result with majority threshold (scenarios A, B, C, D)', () => {
    const settings = { threshold_type: 'majority' };
    
    // Scenario A: 2 yes, 1 no -> PASS
    expect(evaluateStage1Result({ yes: ['u1', 'u2'], no: ['u3'] }, settings)).toBe(true);

    // Scenario B: 1 yes, 1 no -> FAIL (tie)
    expect(evaluateStage1Result({ yes: ['u1'], no: ['u2'] }, settings)).toBe(false);

    // Scenario C: 1 yes, 0 no -> FAIL (only 1 vote total)
    expect(evaluateStage1Result({ yes: ['u1'], no: [] }, settings)).toBe(false);

    // Scenario D: 2 yes, 0 no -> PASS
    expect(evaluateStage1Result({ yes: ['u1', 'u2'], no: [] }, settings)).toBe(true);
  });

  test('checkImmunity detects owner, bot, admin, or self', () => {
    const callerId = '100';
    const targetOwner = { id: '200', isOwner: true, isBot: false, isAdmin: false };
    const targetBot = { id: '201', isOwner: false, isBot: true, isAdmin: false };
    const targetAdmin = { id: '202', isOwner: false, isBot: false, isAdmin: true };
    const targetSelf = { id: '100', isOwner: false, isBot: false, isAdmin: false };
    const targetNormal = { id: '203', isOwner: false, isBot: false, isAdmin: false };

    expect(checkImmunity(targetOwner, callerId)).toEqual({ immune: true, reason: 'Target is the Guild Owner.' });
    expect(checkImmunity(targetBot, callerId)).toEqual({ immune: true, reason: 'Target is a Bot.' });
    expect(checkImmunity(targetAdmin, callerId)).toEqual({ immune: true, reason: 'Target is an Administrator.' });
    expect(checkImmunity(targetSelf, callerId)).toEqual({ immune: true, reason: 'You cannot target yourself.' });
    expect(checkImmunity(targetNormal, callerId)).toEqual({ immune: false, reason: null });
  });
});
