function evaluateStage1Result(votes, settings, totalVotersCount = 0) {
  const yesCount = votes.yes ? votes.yes.length : 0;
  const noCount = votes.no ? votes.no.length : 0;
  const totalVotes = yesCount + noCount;

  if (settings.threshold_type === 'fixed') {
    return yesCount >= settings.threshold_value;
  } else if (settings.threshold_type === 'percentage') {
    // If totalVotersCount is passed (e.g. active VC human voters), calculate percentage relative to totalVotersCount
    // Otherwise calculate relative to votes cast so far
    const denominator = totalVotersCount > 0 ? totalVotersCount : totalVotes;
    if (denominator === 0) return false;
    const percentageYes = (yesCount / denominator) * 100;
    return percentageYes >= settings.threshold_value;
  } else if (settings.threshold_type === 'majority') {
    return yesCount > noCount && yesCount >= 2;
  }
  return false;
}

function checkImmunity(targetMember, callerId) {
  if (targetMember.id === callerId) {
    return { immune: true, reason: 'You cannot target yourself.' };
  }
  if (targetMember.isBot) {
    return { immune: true, reason: 'Target is a Bot.' };
  }
  if (targetMember.isOwner) {
    return { immune: true, reason: 'Target is the Guild Owner.' };
  }
  if (targetMember.isAdmin) {
    return { immune: true, reason: 'Target is an Administrator.' };
  }
  return { immune: false, reason: null };
}

module.exports = { evaluateStage1Result, checkImmunity };
