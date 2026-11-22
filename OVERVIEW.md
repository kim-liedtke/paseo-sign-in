# Sign-in

Shows when the sign-in of a coding agent on this host ends, and lets you sign in again from inside Paseo. You do not need a terminal or SSH access to the host.

Paseo runs Claude Code with the sign-in of the host account. That sign-in ends on a fixed date, a few weeks after you signed in. When it ends, your agents stop until you sign in again on the host. This plugin shows the end date before that happens and runs the sign-in for you.

## What you get

- A **Sign-in** screen with the state of each provider: signed in or not, the account, the plan, and the time at which the sign-in ends.
- A row in the sidebar footer. It turns into a warning when a sign-in ends soon, and into an error when it has ended or nobody is signed in. A toast shows the same message once. The row also says so when the end date or the status is unknown.
- A **Sign in** button. The plugin starts the provider's own sign-in on the host and shows its link. You approve in a browser on any device, paste the code into Paseo, and the plugin gives it to the sign-in.

After a new sign-in, start a new agent. Agents that are already running keep the sign-in they started with.

## Setup

The provider CLI must be installed on the daemon host. The plugin starts it the way the daemon does: it uses the command and the environment that the daemon configuration sets for the provider.

Supported provider: Claude Code. Tested with Claude Code 2.1.323 and Paseo 0.16.1 on Linux.

## Setting

**Warn before the sign-in ends** sets how many days before the end the warning starts. The default is 7 days.

## What the plugin reads and sends

The plugin gets all state from the provider's own status command (`claude auth status --json`). It does not read credential files, and it does not store or read tokens.

The sign-in link and the code you paste stay in memory for the one sign-in. They travel between the daemon and your Paseo app over the connection that Paseo already uses. The plugin does not write them to a log or a file, and it makes no network requests of its own. It accepts only an https sign-in link to the provider's own host.

Anyone who can use your daemon connection can sign the host in to their own provider account through this plugin. Protect that connection as you protect a shell on the host.

## Limits

- Only the default sign-in method of Claude Code (Claude account). Console and SSO sign-in are not offered.
- Only the built-in `claude` provider. Additional profiles that extend it are not listed.
- The notice shows in the app while it is open. There are no push notifications.
- An unfinished sign-in is stopped after five minutes.
