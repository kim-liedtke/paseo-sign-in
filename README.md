# paseo-sign-in

A [Paseo](https://paseo.sh) plugin that shows when the sign-in of a coding agent ends and lets you sign in again from inside the Paseo app.

## Why

Paseo runs coding agents on a host through the provider CLIs that are installed there. For Claude Code it uses the sign-in of the host account. That sign-in ends on a fixed date, a few weeks after you signed in. Using Claude Code does not move the date. When the sign-in ends, every agent of that account stops until someone runs `claude auth login` on the host.

On a shared host, many users have no terminal access. This plugin gives each user two things in the app: the date on which their sign-in ends, and a way to sign in again.

## What it does

- **Status.** A screen shows, for each provider: signed in or not, the account, the plan, and when the sign-in ends. It refreshes when you open it and every 15 minutes.
- **Notice.** A row in the sidebar footer changes when a sign-in ends within N days (default 7), has ended, or is missing. A toast shows the same message once.
- **Sign in.** A button starts the provider's sign-in on the host. The screen shows the link, takes the code you paste, gives it to the sign-in and shows the result.

```text
 Sign-in
 ──────────────────────────────────────────────────────────
 Sign-in of the coding agents on my-host. The data comes
 from each provider's own status command.

 ┌────────────────────────────────────────────────────────┐
 │ Claude Code                       Signed in, ends soon │
 │                                                        │
 │ Account        user@example.com                        │
 │ Plan           Team · Example Org                      │
 │ Signed in with Claude account                          │
 │ Sign-in ends   4/12/2030, 9:56:48 AM (in 3 days)       │
 │                                                        │
 │ [ Sign in again ]                                      │
 └────────────────────────────────────────────────────────┘

 [ Refresh ]  Checked 10:12:30 PM
```

After you press **Sign in again**:

```text
 │ 1. Open the sign-in link and approve the request.      │
 │    https://…                                           │
 │    [ Open link ]  [ Copy link ]                        │
 │ 2. Paste the code that the page shows.                 │
 │    [ Code                                    ]         │
 │    [ Submit code ]  [ Cancel ]                         │
```

Sidebar footer row, by state:

```text
 🔑 Sign-in                      nothing to do
 ⚠  Sign-in ends in 3 days       inside the warning time
 ⚠  Sign-in ended                the end date has passed
 ⚠  Not signed in                no sign-in on the host
```

After a successful sign-in, start a new agent. Paseo's documentation says that a running agent keeps the sign-in it started with.

## Install

Plugins run on the daemon. Install the plugin on each daemon on which you want it. Plugins must be enabled on that daemon (**Settings → Plugins → Enable plugins**).

```bash
paseo plugin install git:<owner>/paseo-sign-in
paseo plugin ls
```

Replace `<owner>` with the account that hosts this repository. You can also clone the repository and install the directory:

```bash
paseo plugin install /absolute/path/to/paseo-sign-in
```

The plugin has no runtime dependencies and no build step. Paseo compiles the TypeScript source that you see in this repository.

Requirements: Paseo 0.16.1 or later, and the provider CLI on the daemon host. Tested with Claude Code 2.1.323 on Linux.

## Several hosts

The plugin works on one daemon at a time, the one on which it is installed. If you install it on several hosts that your app is connected to, Paseo shows the **Sign-in** screen once and adds a host picker to the screen header. The picker selects the host whose sign-in you see and renew. This is standard Paseo behavior for plugin screens ([Hosts and lifecycle](https://paseo.sh/docs/plugins/reference#hosts-and-lifecycle)).

The sidebar row shows the notice for one host only: the host of the open screen, or the host you picked last.

## Settings

Open **Settings → Plugins**, then the settings of **Sign-in**.

| Setting | Default | Meaning |
| --- | --- | --- |
| Warn before the sign-in ends | 7 days | The notice starts this many days before the end. |

The setting is stored by Paseo on the daemon and is the same for all your devices.

## How it works

```text
 Paseo app (client/)                      Daemon host (server/)
 ───────────────────                      ──────────────────────────────
 status screen, sidebar row  ── RPC ──▶   provider registry (fixed ids)
                                            └─ AuthProvider "claude"
                                                 status()     claude auth status --json
                                                 startLogin() claude auth login
                                                 submitCode() writes the code to its stdin
                                                 cancel()     stops the process
```

Everything that is specific to a provider is behind one interface, `AuthProvider` in `server/core/provider.ts`: `status()`, `startLogin()`, `submitCode()`, `cancel()`. `server/core/` knows nothing about a particular provider. `server/claude/` is the Claude Code implementation. Another provider is one more implementation, one more id in `shared/providers.ts` and one line in `index.server.ts`.

The plugin starts the CLI the way the daemon does. It reads the provider's entry in the daemon configuration (`agents.providers.<id>` in the daemon's `config.json`) through the Paseo SDK. A custom `command` replaces the default command, and `env` values such as `CLAUDE_CONFIG_DIR` are added to the environment.

`claude auth login` needs no terminal. It prints the link and reads the code from its standard input, so the plugin uses plain pipes and needs no pseudo-terminal library.

Plugin APIs used, all from the [plugin reference](https://paseo.sh/docs/plugins/reference):

| Need | API |
| --- | --- |
| Status screen | `addScreen` ([Screens and sidebar items](https://paseo.sh/docs/plugins/reference#screens-and-sidebar-items)) |
| Notice without opening the screen | `addSidebarFooterItem` with `SidebarRow`, and `useToast` ([Sidebar items](https://paseo.sh/docs/plugins/reference#sidebar-items), [Toasts](https://paseo.sh/docs/plugins/reference#toasts)) |
| Setting | `addSettingsScreen`, `defineSettings` ([Settings screens](https://paseo.sh/docs/plugins/reference#settings-screens)) |
| Client to daemon calls | `defineRpc`, `server.handle`, `useRpc` ([Add plugin-specific backend behavior](https://paseo.sh/docs/plugins/reference#add-plugin-specific-backend-behavior)) |
| Host process | Node `child_process.spawn` in the server entry ([Server runtime](https://paseo.sh/docs/plugins/reference#server-runtime)) |
| Provider command and environment | `paseo.config.get()` ([SDK reference](https://paseo.sh/docs/sdk/reference)) |

## Security

A Paseo plugin is trusted code. Its server part runs without a sandbox, with the full access of the account that runs the daemon. Read the source before you install it. It is small and is not bundled or minified.

What this plugin does and does not do:

- **No credential files.** It never opens a credential file. All state comes from the provider's own status command.
- **No stored secrets.** It does not read, store or send tokens. The sign-in link and the pasted code are held in memory for the one sign-in and dropped when it ends. They are not written to a log or a file. Result messages that come from the CLI have links and the code removed before they are shown.
- **No network access of its own.** No telemetry, no update check, no remote assets. Only the provider CLI talks to the provider.
- **No shell.** Processes are started from an argument list with `shell: false`. The only program it starts is the provider CLI, with the command that the daemon configuration gives for that provider.
- **One sign-in at a time for each provider.** A second request returns the running sign-in. An unfinished sign-in is stopped after five minutes: SIGTERM, then SIGKILL. When the plugin is reloaded or disabled, or the daemon stops it, the sign-in process is stopped too.
- **Nothing that changes agents.** No system-prompt changes, no tools for agents, no automatic answers to permission requests, no automatic prompts. The plugin registers no lifecycle hooks.
- **No file writes.** The plugin writes no files. Its one setting is stored by Paseo's settings API.
- **Narrow RPC.** A request from the app carries a provider id from a fixed list (`shared/providers.ts`) and, for the code, a string of limited length without control characters. It cannot carry a path, a command or arguments. Inputs are validated with Zod before a handler runs.
- **No install scripts and no runtime dependencies.** `package.json` has development dependencies only, for typechecking and tests.

What the plugin can access, and what you should know:

- The server part can run the provider CLI as the daemon account. That is what it is for.
- The status answer contains the account email, the organization name and the plan. The plugin sends it to your Paseo app, where the screen shows it. It is not written to the plugin log.
- The sign-in link goes from the daemon to your app, and the code goes back, over the connection that Paseo already uses between app and daemon. Anyone who can use your daemon connection can start a sign-in. They cannot finish it without approving in a browser as the account owner.
- The daemon writes the message of a failed plugin request to its own log. The plugin's error messages are fixed texts and contain no link, code or account data.
- `claude auth login` tries to open a browser on the host. On a server without a desktop this does nothing.

To report a security problem, open a private security advisory on the repository.

## Limitations

- Claude Code only. Codex is planned as a second implementation of the same interface.
- Only the built-in `claude` provider entry. Additional provider profiles that extend it (for example with another `CLAUDE_CONFIG_DIR`) are not listed.
- Only the default sign-in method (Claude account). `--console`, `--sso` and `--email` are not offered.
- One account for each provider. No account switching, no handling of usage limits.
- `claude setup-token` and API keys are out of scope. When the CLI is signed in with one of them, the screen shows the state and that no end date is reported.
- With the plugin on several hosts, the sidebar notice covers only the selected host. A warning on another host shows after you pick that host in the screen.
- The notice shows in the app while it is open. There are no push notifications and no email.
- A running agent keeps its old sign-in. Start a new agent after you signed in again.
- If the CLI changes the text or the order of its sign-in prompts, the sign-in can fail. The plugin then reports that no link was shown.
- Not tested on Windows or macOS.

## Development

```bash
npm install
npm run typecheck
npm test
```

The tests need no account and no real sign-in. They cover the provider-neutral core (one sign-in at a time, time limit, stopping the process, removal of link and code from messages), the launch resolution, the expiry rules and the parsing of the status output. The sign-in tests run against a small stand-in CLI in `test/fixtures/`.

One more test file runs the installed `claude` CLI with a new, empty config folder. It checks that the CLI shows a link without a terminal and rejects a wrong code. It does not touch an existing sign-in. It is off by default:

```bash
SIGN_IN_REAL_CLI=1 npm test
```

To try a change on your own daemon:

```bash
paseo plugin install /absolute/path/to/paseo-sign-in
paseo plugin reload paseo-sign-in
paseo plugin logs paseo-sign-in
```

## License

MIT. See [LICENSE](LICENSE).
