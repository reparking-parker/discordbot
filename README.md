# Discord Democracy Moderation Bot

A Discord bot that gives your community democratic control over temporary timeouts and voice mutes. Server members can start votes to punish disruptive members, and if the community agrees, everyone votes on how long the punishment lasts.

---

## How It Works

1. **Stage 1 — Vote to Punish**: Someone starts a vote against a member using `/vote-punish`. Other members click **Yes** or **No**.
2. **Stage 2 — Vote on Duration**: If Stage 1 passes, a dropdown menu appears allowing members to vote on the duration (1m, 3m, 5m, 10m, 15m, or 1 year). The duration with the most votes wins.
3. **Automatic Unmuting & Persistence**: Voice mutes are tracked in a local SQLite database (`database.sqlite`). If a muted user leaves voice or the bot restarts, their mute status persists and automatically clears when their time expires or when they re-join voice.

---

## Slash Commands

| Command | Description | Permissions |
| --- | --- | --- |
| `/vote-punish target action [reason]` | Start a vote to `timeout` or `mute` a member. If targeting someone in a voice channel, you must be in the same voice channel. | Anyone (subject to cooldown) |
| `/stop-vote` | Cancel the vote running in the current channel. | Poll Initiator, Server Owner, or Admin |
| `/skip-stage target` | Skip the current stage of an active vote for a member (advances Stage 1 to Stage 2, or Stage 2 straight to punishment). | Poll Initiator, Server Owner, or Admin |
| `/check-status [target]` | View active polls, voice mute/timeout status, remaining duration, and cooldown status for a member (or yourself if left blank). | Anyone |
| `/config setting value` | Configure server thresholds (`threshold_type`, `threshold_value`, `poll_duration_seconds`, `user_cooldown_seconds`). | Admin Only |

---

## Server Configuration

Admins can customize how votes pass using `/config`:

- **`threshold_type`**:
  - `fixed`: Requires a fixed number of **Yes** votes (e.g., 5 votes).
  - `percentage`: Requires a percentage of **Yes** votes (e.g., 60%). If started in a voice channel, percentage is calculated from the active members in that VC.
  - `majority`: Requires more **Yes** than **No** votes (minimum 2 **Yes** votes).
- **`threshold_value`**: The number or percentage required (e.g., `5` or `60`).
- **`poll_duration_seconds`**: Time in seconds each voting stage remains open (default: `300` seconds / 5 mins).
- **`user_cooldown_seconds`**: Cooldown time before a non-admin user can start another vote (default: `600` seconds / 10 mins).

---

## Prerequisites

- **Node.js**: v18.0.0 or higher
- **Bot Privileges**: The bot needs the following Discord permissions:
  - `Moderate Members` (for timeouts)
  - `Mute Members` (for voice mutes)
  - `Use Application Commands`
  - Gateway Intents: `Guilds`, `GuildMembers`, `GuildVoiceStates`

---

## Installation & Setup

1. **Clone the repository**:
   ```bash
   git clone https://github.com/reparking-parker/discordbot.git
   cd discordbot
   ```

2. **Install dependencies**:
   ```bash
   npm install
   ```

3. **Configure environment variables**:
   Create a `.env` file in the root directory (you can copy `.env.example`):
   ```env
   DISCORD_TOKEN=your_bot_token_here
   CLIENT_ID=your_discord_client_id_here
   ```

4. **Run the bot**:
   ```bash
   npm start
   ```
   Or using `run.bat` on Windows.