require('dotenv').config();
const { Client, GatewayIntentBits, REST, Routes, SlashCommandBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, StringSelectMenuBuilder, ComponentType } = require('discord.js');
const { initDb, getGuildSettings, updateGuildSetting, checkUserCooldown, updateUserCooldown, saveActiveMute, removeActiveMute, getPendingMutes, getActiveMuteForUser, getExpiredMutes } = require('./db/database');
const { evaluateStage1Result, checkImmunity } = require('./logic/democracyEngine');

initDb();

const client = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers, GatewayIntentBits.GuildVoiceStates] });

const activePolls = new Map();

function findPollByTarget(targetId) {
  for (const [channelId, poll] of activePolls.entries()) {
    if (poll.targetId === targetId) {
      return poll;
    }
  }
  return null;
}

const commands = [
  new SlashCommandBuilder()
    .setName('vote-punish')
    .setDescription('start a vote to punish a member')
    .addUserOption(opt => opt.setName('target').setDescription('member to punish').setRequired(true))
    .addStringOption(opt => opt.setName('action').setDescription('punishment type').setRequired(true)
      .addChoices(
        { name: 'timeout', value: 'timeout' },
        { name: 'mute', value: 'mute' }
      ))
    .addStringOption(opt => opt.setName('reason').setDescription('reason for the punishment').setRequired(false)),
  new SlashCommandBuilder()
    .setName('stop-vote')
    .setDescription('stop the active vote in this channel'),
  new SlashCommandBuilder()
    .setName('config')
    .setDescription('change server settings (admin only)')
    .addStringOption(opt => opt.setName('setting').setDescription('setting name').setRequired(true)
      .addChoices(
        { name: 'threshold_type (fixed / percentage / majority)', value: 'threshold_type' },
        { name: 'threshold_value', value: 'threshold_value' },
        { name: 'poll_duration_seconds', value: 'poll_duration_seconds' },
        { name: 'user_cooldown_seconds', value: 'user_cooldown_seconds' }
      ))
    .addStringOption(opt => opt.setName('value').setDescription('setting value').setRequired(true)),
  new SlashCommandBuilder()
    .setName('check-status')
    .setDescription('check voting status and active punishments for a member')
    .addUserOption(opt => opt.setName('target').setDescription('member to check (defaults to self)').setRequired(false)),
  new SlashCommandBuilder()
    .setName('skip-stage')
    .setDescription('skip the current stage of an active vote for a member')
    .addUserOption(opt => opt.setName('target').setDescription('member whose vote stage to skip').setRequired(true))
];

client.once('ready', async () => {
  console.log(`logged in as ${client.user.tag}`);
  if (process.env.DISCORD_TOKEN && process.env.CLIENT_ID) {
    const rest = new REST().setToken(process.env.DISCORD_TOKEN);
    try {
      await rest.put(Routes.applicationCommands(process.env.CLIENT_ID), { body: commands });
      console.log('slash commands updated.');
    } catch (err) {
      console.error('error updating commands:', err);
    }
  }

  // Restore pending voice unmutes on startup
  restorePendingVoiceMutes();
});

function scheduleUnmute(guildId, userId, delayMs) {
  setTimeout(async () => {
    try {
      const guild = await client.guilds.fetch(guildId).catch(() => null);
      if (guild) {
        const member = await guild.members.fetch(userId).catch(() => null);
        if (member) {
          if (member.voice && member.voice.channel) {
            await member.voice.setMute(false, 'democratic vote mute duration expired');
            removeActiveMute(guildId, userId);
          } else {
            // Member is currently not in a voice channel.
            // Leave active_mutes entry in DB so voiceStateUpdate will unmute upon joining VC.
          }
        } else {
          removeActiveMute(guildId, userId);
        }
      } else {
        removeActiveMute(guildId, userId);
      }
    } catch (err) {
      console.error(`failed to unmute user ${userId}:`, err);
    }
  }, Math.max(0, delayMs));
}

function restorePendingVoiceMutes() {
  const pending = getPendingMutes();
  const now = Math.floor(Date.now() / 1000);
  for (const mute of pending) {
    const remainingSec = mute.unmute_at - now;
    if (remainingSec <= 0) {
      scheduleUnmute(mute.guild_id, mute.user_id, 0);
    } else {
      scheduleUnmute(mute.guild_id, mute.user_id, remainingSec * 1000);
    }
  }
}

client.on('voiceStateUpdate', async (oldState, newState) => {
  if (!newState.channelId) return;
  const guildId = newState.guild.id;
  const userId = newState.id;
  const activeMute = getActiveMuteForUser(guildId, userId);
  if (!activeMute) return;

  const now = Math.floor(Date.now() / 1000);
  if (activeMute.unmute_at <= now) {
    try {
      if (newState.member) {
        await newState.member.voice.setMute(false, 'democratic vote mute duration expired');
      }
    } catch (err) {
      console.error(`failed to unmute user ${userId} on VC join:`, err);
    } finally {
      removeActiveMute(guildId, userId);
    }
  } else {
    if (newState.member && !newState.serverMute) {
      try {
        await newState.member.voice.setMute(true, 'active democratic vote mute');
      } catch (err) {
        console.error(`failed to re-enforce mute for user ${userId} on VC join:`, err);
      }
    }
  }
});

client.on('interactionCreate', async (interaction) => {
  if (!interaction.isChatInputCommand()) return;

  const { commandName, guildId, channelId, member, user } = interaction;
  const settings = getGuildSettings(guildId);

  if (commandName === 'config') {
    if (!member.permissions.has('Administrator')) {
      return interaction.reply({ content: 'only admins can change config', ephemeral: true });
    }
    const settingKey = interaction.options.getString('setting');
    let val = interaction.options.getString('value');

    if (['threshold_value', 'poll_duration_seconds', 'user_cooldown_seconds'].includes(settingKey)) {
      val = parseInt(val, 10);
      if (isNaN(val) || val <= 0) return interaction.reply({ content: 'value must be a positive number', ephemeral: true });
    } else if (settingKey === 'threshold_type' && !['fixed', 'percentage', 'majority'].includes(val)) {
      return interaction.reply({ content: 'value must be fixed, percentage, or majority', ephemeral: true });
    }

    updateGuildSetting(guildId, settingKey, val);
    return interaction.reply({ content: `set ${settingKey} to ${val}`, ephemeral: true });
  }

  if (commandName === 'check-status') {
    const targetUser = interaction.options.getUser('target') || user;
    const targetMember = await interaction.guild.members.fetch(targetUser.id).catch(() => null);

    const statusLines = [`**status check for ${targetUser}**:`];

    // 1. Active poll
    const poll = findPollByTarget(targetUser.id);
    if (poll) {
      const channelMention = `<#${poll.channelId}>`;
      statusLines.push(`• **active poll**: stage ${poll.stage} (${poll.action}) in ${channelMention}`);
      if (poll.stage === 1) {
        statusLines.push(`  votes: yes: ${poll.votes.yes.size} | no: ${poll.votes.no.size}`);
      } else if (poll.stage === 2) {
        statusLines.push(`  duration voting in progress`);
      }
    } else {
      statusLines.push(`• **active poll**: none`);
    }

    // 2. Active punishment
    const now = Math.floor(Date.now() / 1000);
    const activeMute = getActiveMuteForUser(guildId, targetUser.id);
    if (activeMute) {
      const remaining = activeMute.unmute_at - now;
      if (remaining > 0) {
        statusLines.push(`• **voice mute**: active (unmutes <t:${activeMute.unmute_at}:R>)`);
      } else {
        statusLines.push(`• **voice mute**: expired (will clear upon joining voice)`);
      }
    } else {
      statusLines.push(`• **voice mute**: none`);
    }

    if (targetMember && targetMember.communicationDisabledUntilTimestamp && targetMember.communicationDisabledUntilTimestamp > Date.now()) {
      const timeoutEndSec = Math.floor(targetMember.communicationDisabledUntilTimestamp / 1000);
      statusLines.push(`• **timeout**: active (ends <t:${timeoutEndSec}:R>)`);
    } else {
      statusLines.push(`• **timeout**: none`);
    }

    // 3. Cooldown
    const isCooldowned = !checkUserCooldown(guildId, targetUser.id, settings.user_cooldown_seconds);
    statusLines.push(`• **cooldown**: ${isCooldowned ? 'on cooldown' : 'ready'}`);

    return interaction.reply({ content: statusLines.join('\n'), ephemeral: true });
  }

  if (commandName === 'skip-stage') {
    const targetUser = interaction.options.getUser('target');
    const poll = findPollByTarget(targetUser.id);
    if (!poll) {
      return interaction.reply({ content: `no active vote running for ${targetUser}`, ephemeral: true });
    }

    const isStarter = poll.initiatorId === user.id;
    const isOwner = interaction.guild.ownerId === user.id;
    const isAdmin = member.permissions.has('Administrator');

    if (!isStarter && !isOwner && !isAdmin) {
      return interaction.reply({ content: 'only the person who started the vote or an admin can skip its stage', ephemeral: true });
    }

    if (poll.stage === 1) {
      poll.stoppedReason = `skipped by ${user}`;
      poll.collector.stop('skipped');
      return interaction.reply({ content: `skipped stage 1 vote for ${targetUser}` });
    } else if (poll.stage === 2) {
      poll.stoppedReason = `skipped by ${user}`;
      poll.collector.stop('skipped');
      return interaction.reply({ content: `skipped stage 2 duration selection for ${targetUser}` });
    }
  }

  if (commandName === 'stop-vote') {
    const poll = activePolls.get(channelId);
    if (!poll) {
      return interaction.reply({ content: 'no active vote in this channel', ephemeral: true });
    }

    const isStarter = poll.initiatorId === user.id;
    const isOwner = interaction.guild.ownerId === user.id;
    const isAdmin = member.permissions.has('Administrator');

    if (!isStarter && !isOwner && !isAdmin) {
      return interaction.reply({ content: 'only the person who started the vote or an admin can stop it', ephemeral: true });
    }

    poll.stoppedReason = `stopped by ${user}`;
    poll.collector.stop('user_stopped');
    activePolls.delete(channelId);

    return interaction.reply({ content: `vote was stopped by ${user}` });
  }

  if (commandName === 'vote-punish') {
    if (activePolls.has(channelId)) {
      return interaction.reply({ content: 'there is already a vote running in this channel', ephemeral: true });
    }

    const isOwnerOrAdmin = interaction.guild.ownerId === user.id || member.permissions.has('Administrator');
    if (!isOwnerOrAdmin && !checkUserCooldown(guildId, user.id, settings.user_cooldown_seconds)) {
      return interaction.reply({ content: 'you are on cooldown. try again later', ephemeral: true });
    }

    const targetUser = interaction.options.getUser('target');
    const targetMember = await interaction.guild.members.fetch(targetUser.id).catch(() => null);
    if (!targetMember) return interaction.reply({ content: 'member not found', ephemeral: true });

    const immunityObj = {
      id: targetMember.id,
      isBot: targetUser.bot,
      isOwner: interaction.guild.ownerId === targetMember.id,
      isAdmin: targetMember.permissions.has('Administrator')
    };

    const immunityCheck = checkImmunity(immunityObj, user.id);
    if (immunityCheck.immune) {
      return interaction.reply({ content: `cant target them: ${immunityCheck.reason.toLowerCase()}`, ephemeral: true });
    }

    updateUserCooldown(guildId, user.id);

    const action = interaction.options.getString('action');
    const reason = interaction.options.getString('reason');
    const reasonText = reason ? ` for "${reason}"` : '';

    let totalVotersCount = 0;
    let vcNotice = '';
    const callerVc = member.voice ? member.voice.channel : null;
    const targetVc = targetMember.voice ? targetMember.voice.channel : null;

    if (targetVc) {
      if (!callerVc || callerVc.id !== targetVc.id) {
        return interaction.reply({ content: `you must be in the same voice channel as ${targetUser} to start a vote against them`, ephemeral: true });
      }
      const humanMembersInVc = callerVc.members.filter(m => !m.user.bot && m.id !== targetMember.id);
      totalVotersCount = humanMembersInVc.size;
      vcNotice = `\nvc mode: ${totalVotersCount} active voters in voice channel.`;
    }

    const votes = { yes: new Set(), no: new Set() };

    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('vote_yes').setLabel('yes').setStyle(ButtonStyle.Danger),
      new ButtonBuilder().setCustomId('vote_no').setLabel('no').setStyle(ButtonStyle.Secondary)
    );

    const endTimestamp = Math.floor((Date.now() + settings.poll_duration_seconds * 1000) / 1000);

    let needText = '';
    if (settings.threshold_type === 'majority') {
      needText = 'need majority (more yes than no)';
    } else if (settings.threshold_type === 'percentage') {
      needText = `need ${settings.threshold_value}% yes`;
    } else {
      needText = `need ${settings.threshold_value} votes`;
    }

    const pollMessage = await interaction.reply({
      content: `vote to ${action} ${targetUser}${reasonText}. started by ${user}.${vcNotice}\nends <t:${endTimestamp}:R>\n${needText}.\n\nyes: 0 | no: 0`,
      components: [row],
      fetchReply: true
    });

    const collector = pollMessage.createMessageComponentCollector({
      componentType: ComponentType.Button,
      time: settings.poll_duration_seconds * 1000
    });

    const pollState = {
      channelId,
      targetId: targetUser.id,
      targetMember,
      initiatorId: user.id,
      stage: 1,
      action,
      reason,
      collector,
      pollMessage,
      votes,
      stoppedReason: null
    };
    activePolls.set(channelId, pollState);

    collector.on('collect', async (i) => {
      votes.yes.delete(i.user.id);
      votes.no.delete(i.user.id);
      if (i.customId === 'vote_yes') votes.yes.add(i.user.id);
      if (i.customId === 'vote_no') votes.no.add(i.user.id);

      await i.update({
        content: `vote to ${action} ${targetUser}${reasonText}. started by ${user}.${vcNotice}\nends <t:${endTimestamp}:R>\n${needText}.\n\nyes: ${votes.yes.size} | no: ${votes.no.size}`,
        components: [row]
      });

      if (settings.threshold_type !== 'majority') {
        const currentVotesObj = { yes: Array.from(votes.yes), no: Array.from(votes.no) };
        if (evaluateStage1Result(currentVotesObj, settings, totalVotersCount)) {
          collector.stop('threshold_met');
        }
      }
    });

    collector.on('end', async (collected, colReason) => {
      activePolls.delete(channelId);

      if (colReason === 'user_stopped') {
        return pollMessage.edit({
          content: `vote was stopped.`,
          components: []
        });
      }

      if (colReason === 'skipped') {
        await pollMessage.edit({
          content: `stage 1 skipped by admin/initiator. moving to stage 2 duration selection for ${targetMember.user}.`,
          components: []
        });
        return startStage2Poll(interaction.channel, targetMember, action, reason, settings, pollState.initiatorId);
      }

      const votesObj = { yes: Array.from(votes.yes), no: Array.from(votes.no) };
      const passed = evaluateStage1Result(votesObj, settings, totalVotersCount);

      if (!passed) {
        return pollMessage.edit({
          content: `vote failed. not enough votes to ${action} ${targetUser}. (yes: ${votes.yes.size} | no: ${votes.no.size})`,
          components: []
        });
      }

      startStage2Poll(interaction.channel, targetMember, action, reason, settings, user.id);
    });
  }
});

async function startStage2Poll(channel, targetMember, action, reason, settings, initiatorId) {
  const durationOptions = [
    { label: '1 minute', value: '1m' },
    { label: '3 minutes', value: '3m' },
    { label: '5 minutes', value: '5m' },
    { label: '10 minutes', value: '10m' },
    { label: '15 minutes', value: '15m' },
    { label: '1 year', value: '1y' }
  ];

  const durationVotes = {};
  durationOptions.forEach(opt => { durationVotes[opt.value] = new Set(); });

  const selectMenu = new StringSelectMenuBuilder()
    .setCustomId('select_duration')
    .setPlaceholder('select punishment duration...')
    .addOptions(durationOptions);

  const row = new ActionRowBuilder().addComponents(selectMenu);
  const reasonText = reason ? ` for "${reason}"` : '';

  const endTimestamp = Math.floor((Date.now() + settings.poll_duration_seconds * 1000) / 1000);

  const stage2Msg = await channel.send({
    content: `stage 1 passed. pick how long to ${action} ${targetMember.user}${reasonText}.\nends <t:${endTimestamp}:R>`,
    components: [row]
  });

  const collector = stage2Msg.createMessageComponentCollector({
    componentType: ComponentType.StringSelect,
    time: settings.poll_duration_seconds * 1000
  });

  const pollState = {
    channelId: channel.id,
    targetId: targetMember.id,
    targetMember,
    initiatorId,
    stage: 2,
    action,
    reason,
    collector,
    stage2Msg,
    durationVotes,
    stoppedReason: null
  };
  activePolls.set(channel.id, pollState);

  collector.on('collect', async (i) => {
    Object.keys(durationVotes).forEach(k => durationVotes[k].delete(i.user.id));
    const selectedKey = i.values[0];
    if (durationVotes[selectedKey]) {
      durationVotes[selectedKey].add(i.user.id);
    }

    const voteCountsSummary = durationOptions
      .filter(opt => durationVotes[opt.value].size > 0)
      .map(opt => `${opt.value}: ${durationVotes[opt.value].size}`)
      .join(' | ');

    const summaryText = voteCountsSummary ? `\n\ncurrent votes: ${voteCountsSummary}` : '';

    await i.update({
      content: `stage 1 passed. pick how long to ${action} ${targetMember.user}${reasonText}.\nends <t:${endTimestamp}:R>${summaryText}`,
      components: [row]
    });
  });

  collector.on('end', async (collected, colReason) => {
    activePolls.delete(channel.id);

    if (colReason === 'user_stopped') {
      return stage2Msg.edit({
        content: `vote was stopped.`,
        components: []
      });
    }

    let winningDuration = '5m';
    let maxVotes = -1;
    for (const [dur, set] of Object.entries(durationVotes)) {
      if (set.size > maxVotes) {
        maxVotes = set.size;
        winningDuration = dur;
      }
    }

    const durationMsMap = {
      '1m': 1 * 60 * 1000,
      '3m': 3 * 60 * 1000,
      '5m': 5 * 60 * 1000,
      '10m': 10 * 60 * 1000,
      '15m': 15 * 60 * 1000,
      '1y': 365 * 24 * 60 * 60 * 1000
    };

    const durationMs = durationMsMap[winningDuration];
    const displayDuration = winningDuration === '1y' ? '1 year' : winningDuration;
    const auditReason = `vote ${action} (${displayDuration})${reason ? ` - ${reason}` : ''}`;

    try {
      if (action === 'timeout') {
        await targetMember.timeout(durationMs, auditReason);
      } else if (action === 'mute') {
        await targetMember.voice.setMute(true, auditReason);
        const unmuteAtTimestamp = Math.floor((Date.now() + durationMs) / 1000);
        saveActiveMute(targetMember.guild.id, targetMember.id, unmuteAtTimestamp);
        scheduleUnmute(targetMember.guild.id, targetMember.id, durationMs);
      }
      await stage2Msg.edit({
        content: `vote ended. ${targetMember.user} got ${action} for ${displayDuration}${reasonText}.`,
        components: []
      });
    } catch (err) {
      await stage2Msg.edit({
        content: `failed to ${action} ${targetMember.user}. check bot permissions.`,
        components: []
      });
    }
  });
}

if (process.env.DISCORD_TOKEN) {
  client.login(process.env.DISCORD_TOKEN);
}

module.exports = { client, startStage2Poll, activePolls, findPollByTarget, commands };
