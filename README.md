# Poker Tracker

A local-first poker chip and bank ledger. Ordinary games live in the browser and work without an account, internet connection, or Convex. A host can explicitly promote the current game to a temporary Convex room for read-only realtime guest viewing.

This tracks chips, transactions, cash-outs, and settlement. It is not a card/deck engine and does not support real-money play.

## Local development

Requirements: Bun and a Convex account for the optional sharing flow.

```sh
bun install
bunx convex dev
```

The Convex command creates/selects a development deployment, writes the ignored `.env.local`, generates `convex/_generated`, and watches backend changes. In another terminal:

```sh
bun run dev
```

Useful checks:

```sh
bun run typecheck
bun run test
bun run build
```

CI (`.github/workflows/ci.yml`) runs these same checks on every pull request and push to `main`; it needs no Convex secrets.

If a deployment is already configured, regenerate types with `bun run convex:codegen`. The production backend command is `bunx convex deploy`; run it only as an intentional release step.

## Environment variables

- `VITE_CONVEX_URL`: public Convex deployment URL embedded in the Vite build. Without it, local games still work and the Share button explains that sharing is unavailable.
- `CONVEX_DEPLOYMENT`: development deployment selector managed by the Convex CLI.

Neither value is a host or guest room credential. Do not commit `.env.local`, deploy keys, or room capabilities.

## Local and shared behavior

- Local games use `poker-tracker:v1:current-game` in `localStorage`. Schema v6 adds a stable `localGameId`; older saves migrate in place.
- Player History lives in IndexedDB (database `poker-tracker`, store `archivedGames`): one record per game keyed by its `localGameId`, indexed by archive time, keeping the newest 500 games. The old single `poker-tracker:v1:game-archive` localStorage key is moved over once; the key is removed only after the IndexedDB write commits, re-running the move is harmless, and entries this version cannot read are kept as records (with a downloadable copy) rather than dropped. Where IndexedDB is unavailable or fails to open (some private modes), Player History stays in that localStorage key, capped at 100 games. Parsed games are cached in memory and refreshed when another tab changes the archive (`BroadcastChannel`).
- Player identity across games: a device-local people directory (`poker-tracker:v1:people` in `localStorage`) gives each person a stable id. A game's player may carry an optional `personId` (an additive field, so saves stay at schema v7 and older builds still open them; ids a build can't use are dropped on load). While entering names, known people are suggested by most recent play, and typing a person's exact name or alias (case-insensitive) links automatically, but only if exactly one person matches. When a game is archived, its unlinked players are linked the same way, and other real names (not placeholder `Player N` names) become new people. Player History groups players by person; unlinked older games still group by name. **Merge or rename** in Player History merges rows into one person (names become aliases, other people point at the merged-into person). Each merged-in name or person can be separated again, and renaming keeps the old name as an alias. Nothing merges automatically except exact name/alias matches. Renaming onto a name another row already uses is refused, so combining two rows is always an explicit merge. Opening a Player History row lists the games behind it (date, game, the name played under, result), and **Change** fixes who that game's player was: not this person, another existing person, or a new person. Only that game's archive record is rewritten (in one IndexedDB transaction, or in place in the localStorage fallback; other tabs refresh), and it gains an `editedAt` time so restoring an older backup keeps the corrected copy. Unlinking records the person in the player's optional `notPersonIds` list (additive like `personId`; unusable ids are dropped on load, and older builds ignore it) so the exact name rule cannot link that player back to them, even after merges or separations; the game then shows as a separate "Name (unlinked)" row, which cannot be merged by name (that would give the name, and every game matched by it, to the merge) but can be renamed, which makes it a new person. In shared rooms `personId` round-trips through the host snapshot, but it is stripped from guest projections. Full backups include the directory; restoring merges it by id, and a restored person whose name exactly matches exactly one local person is linked to that person, which can be separated later.
- Venmo pay links: a player can have an optional Venmo username (Setup's player list `@` button or the seat's rename dialog; a leading `@` or a pasted venmo.com profile link is accepted, and only 5–30 letters, digits, `-`, or `_` are stored). It lives on the game's player as an optional `venmoHandle` (additive, schema stays v7, unusable values are dropped on load) and on the linked person in the people directory, so it is remembered across games, filled in when a player is linked to that person, and included in full backups. Once settlement is ready (all cash-outs in, chip pool balanced), each unpaid payment whose recipient has a username shows **Pay with Venmo**, and the copied summary appends the link. Links use Venmo's web form `https://venmo.com/<username>?txn=pay&amount=12.50&note=<game> poker settlement`, which opens the Venmo app on phones; Venmo moves US dollars only, so links appear only for USD games. The app never sees or confirms the payment; mark it paid as usual. In shared rooms the host-set username is part of the snapshot and guest projection, so guests see the same links. Setting a username is a new room action, so the Convex functions must be redeployed before hosts can use it in shared rooms.
- Per-game currency: Setup's **Currency** picker offers USD, EUR, GBP, CAD, AUD, NZD, CHF, SEK, NOK, DKK, MXN, BRL, INR, SGD, HKD, ZAR, and PLN (all two minor digits, so amounts stay integer cents and the currency is only a label; changing it after transactions exist asks first and converts nothing). Amounts are formatted for the browser's language (`navigator.language`) in the game's currency, including the copied settlement summary; amount inputs also accept comma decimals (`12,50`, `1.234,50`) alongside `1,234.50`. A new game keeps the previous game's currency. US dollar games still save as schema v7; any other currency saves as schema v8, so builds from before currencies report "saved by a newer version" (and keep a copy) instead of misreading euros as dollars. Player History never adds different currencies together: each row shows one line per currency, ordered by the currency most archived games used. Venmo links stay USD-only. In shared rooms the currency is part of the snapshot and hosts change it with a new `set_currency` room action, so the Convex functions must be redeployed before non-USD games can be shared; USD rooms keep working against older functions and older guests.
- Stats over time: Player History has a date range (30 days, 90 days, year, all time; default all time) that filters both the totals table and the charts. A game's date is its first transaction (the first buy-in), since a game is archived when the *next* game starts and is created when the *previous* one is archived, so both of those can be days off; games without readable transaction times fall back to creation, then archive, time. While merging or renaming, every game is shown. Below the table, **Over time** charts one currency at a time (picker shown when the range has several): each person's running total, defaulting to the five people with the most games in that currency and toggled per person (up to eight, one fixed color each; hiding someone never recolors anyone else), and a **Game by game** view for one person with bars per game plus games, total, average, win rate, best, worst, and per hour. A player's time in a game is estimated from the ledger, since nothing runs a clock: from their first buy-in to their last cash-out, where a correction or flipped entry counts at the time of the entry it fixes. Games without both, or timed under 15 minutes (typed in after the fact) or over 24 hours (left open), have no time; per hour divides the timed games' results by their hours and leaves the rest out of both sides. Each game in a row's game list and the person's games table show the time. **Download CSV** saves the games in the chosen range for spreadsheets: one row per player per game (oldest first) with the local date, game, Player History name, the name played under, currency, bank buy-ins, bank cash-outs, net (which also counts money between players, so it need not equal cash-outs minus buy-ins), and hours when known. Amounts are plain decimals with the currency in its own column and are never added across currencies; the file is UTF-8 with a byte order mark so Excel keeps accented names, and text a spreadsheet would run as a formula (starting with `=`, `+`, `-`, `@`, or their full-width forms, at the start of a cell or after a semicolon, where semicolon-list spreadsheets split) gets an apostrophe. Where a spreadsheet uses semicolons for lists, import the file choosing comma as the separator. Each chart has a text description and a "as a table" view with every value. Charts use [TanStack Charts](https://github.com/TanStack/charts) from `@tanstack/charts` (the React `Chart` from `@tanstack/charts/react`; chart definitions, marks, and compact scales from the package's other entries; the date axis uses `d3-scale`'s time scale). Each chart's SVG is a named image that can also be focused, with arrow keys moving between games and a tooltip giving the date and amounts, as hovering does. The charts, their tables, and the library are a separate lazily loaded chunk (about 172 kB, 58 kB gzipped), so the main bundle does not carry them. The service worker precaches it with the rest of the build, so the charts open offline even if Player History was never viewed online. The charts use the library's static SVG renderer, so nothing animates, with or without reduced motion. If the chunk cannot load, a notice replaces the charts and the totals table still works.
- Other local data (current game, people directory, friend profile, followed codes, host recovery) lives in `localStorage`. All of it stays on this device only. Once the device holds meaningful data, the app calls `navigator.storage.persist()` on the next click or key press so browsers are less likely to evict it; a denial is remembered for 30 days before asking again. If persistence is not granted or unsupported and Player History exists, Home shows a dismissible (14-day) reminder to download a full backup (current game, archive, and people directory, no friend secrets) unless one was made in the last 30 days. Setup's import button accepts both single-game exports and full backups; restoring a backup merges Player History.
- Fresh local loads open on Home, which offers saved-game continuation, active rooms from followed hosts, or a new game. Returning from a hidden or unfocused tab after 24 hours also returns to Home; active shared-room and recovery sessions keep their existing routing.
- Friend profiles are device-bound and require no account. A personal 100-bit friend code can be shared by QR or manual entry; followed codes are stored locally and their discoverable active rooms update reactively.
- A hosted room linked to a friend profile is visible to followers by default. The host can hide it without ending the room or changing the ordinary invitation link. Rotating a friend code revokes future discovery through the old code.
- Sharing is explicit. Convex receives a bounded snapshot only when the host chooses **Share game**.
- While active, Convex is authoritative. The host sends versioned reducer actions, waits for server acceptance, and only then caches the accepted state locally. Financial actions are not optimistic or queued offline.
- Host recovery credentials use a separate local-storage record. A tab-scoped controller ID ensures only one host tab can edit; another tab may explicitly take control.
- If the saved host room cannot be found, the app stops presenting stale sharing controls, preserves the latest accepted local snapshot, and offers retry, local continuation, or a fresh share.
- Guests receive a revocable, tab-scoped capability in `sessionStorage`. Guest room snapshots never write to normal local-game storage.
- Stopping sharing marks the room ended and confirms its final authoritative snapshot before replacing the host’s local state. If that write fails or the response cannot be confirmed, recovery metadata remains and the host sees **Recovery needed** with a retry action.

Room QR codes contain the guest invitation URL, not host authority. Personal friend QR codes contain the stable friend code and never contain profile-owner or host authority. Invitation and friend codes use URL fragments so they are not sent in ordinary HTTP requests. Pairing and realtime updates still use Convex over the internet; this is not LAN-only or peer-to-peer transport.

## Offline and installing (PWA)

The production build registers a service worker (`/sw.js`, source in `src/pwa/serviceWorker.ts`); it is not registered by `bun run dev`. A small Vite plugin (`vite-plugins/serviceWorkerPrecache.ts`) bundles the worker and, after the build, writes into it the list of every file in `dist` (index.html, every hashed JS/CSS chunk including lazily loaded ones, the web manifest, icons) plus a version hash of their contents. Nothing is listed by hand, so new chunks are covered automatically.

- One online visit is enough: installing the worker downloads every listed file into a cache named for that version. If any download fails the install fails and the previous worker (and its cache) stays in charge.
- Build files are served from that cache. Page loads try the network first and fall back to the cached index.html, so the app boots with no connection. Other requests, including everything to Convex and other origins, are never cached or intercepted.
- A new build means a new worker; it takes over as soon as its cache is complete, deletes older caches, and the open page picks up the new version on its next load. `public/_headers` tells Cloudflare not to cache `/sw.js` so updates are seen promptly.
- Sharing, joining rooms, and friend discovery still need the internet; local games and Player History do not.
- The main bundle carries Home and the game shell. Play (the table, with the drag-and-drop library), Setup (with Player History), Cash Out, Settle, the transaction audit, the QR code encoder, and the Convex client are separate chunks (the charts load on demand within Player History). Play starts loading as soon as any screen other than Home renders, since every game needs it soon; otherwise, once the first screen is up, the app loads them in the background (the Convex client only when a deployment is configured), so switching modes normally does not wait; if a mode is opened before its chunk arrives, a short "Loading…" line stands in for it. If a chunk cannot load, that area shows a reload notice instead of the app failing.

## Snapshot boundary and retention

The first slice stores one bounded game snapshot per room:

- 700,000 encoded bytes maximum
- 24 players maximum
- 5,000 transactions maximum
- 10,000 accepted actions maximum
- 50 non-revoked guest sessions maximum (200 guest records per room including revoked ones)

These limits preserve headroom below Convex’s 1 MB document limit. Before raising them, move transactions and other growing collections into normalized, room-indexed tables. Abandoned active rooms automatically expire after seven days without a host edit. A daily bounded cleanup removes processed-action, audit-event, and notification-cursor detail from ended or expired rooms after 30 days. The same daily job then removes, for those rooms, revoked guest sessions and all guest requests (approved, rejected, or still pending and therefore expired with the room). Each pass touches at most three rooms (charged at the 1 MiB document cap, so a pass stays within half of Convex's 16 MiB read and write limits) and at most 1,000 detail rows, marks rooms it has finished, and reschedules itself until the backlog is drained. A lease row keeps a single cleanup chain running, so a daily run that finds a chain still in progress does nothing. The final bounded room snapshot, the host capability, and every good-standing guest session remain available, so a host or guest can still review old rooms from the device where they participated.

Shared rooms retain the 500 most recent audit events. The host and every guest have an independent notification read cursor; new guests start caught up, while later transfers, cash-outs, and corrections appear for all current participants.

## Security boundaries and MVP limitations

- Room IDs do not authorize writes. Host, invitation, and guest capabilities are cryptographically random and stored in Convex only as SHA-256 verifiers.
- Every mutation checks the host capability and active controller server-side. Guest queries require a non-revoked guest capability and return a projection without host cash-out drafts.
- Public functions validate arguments; room/action/guest limits provide basic abuse boundaries. Unauthenticated writes that create documents are bounded per room: guest joins by the guest limits above, and guest requests by at most 10 pending per guest until the host decides them.
- Creation is rate limited with the `@convex-dev/rate-limiter` component. Convex does not expose client IPs, so limits are global token buckets: new friend profiles (burst 20, refilling 30 per hour) and new shared rooms (burst 30, refilling 60 per hour), plus a stricter per-friend-profile bucket for rooms linked to that profile (burst 5, refilling 6 per hour). At most 300 rooms may be active at once. When a limit is hit the app shows a generic "try again in a few minutes" message; local games are never affected. Because the limits are global, a determined flood can temporarily block new shares for everyone, but it cannot grow storage faster than these rates.
- There are no accounts, mutual friend approvals, per-IP limits, or CAPTCHA. A friend code is a bearer discovery capability: anyone holding it can see the host's active rooms marked visible to followers (at most five per host) and join while joining is open. Rotating a friend code immediately stops discovery and joining through the old code, and guests of rooms created before the rotation no longer see the host profile. A compromised browser profile exposes its profile-owner and active room capabilities.

## Convex usage

The host and each guest keep one narrow room subscription. Connected-guest tracking uses the Convex presence component. Convex bills subscription reruns and presence traffic as function calls, so projections should remain room-scoped and new realtime subscriptions should be added sparingly, especially on the free tier.

## Hosting at poker.stefanbt.com

The Vite build is already served as Cloudflare Worker static assets, with SPA fallback configured in `wrangler.jsonc`. For a later release:

1. Add a production deploy key from the Convex dashboard as the encrypted
   `CONVEX_DEPLOY_KEY` build variable in Cloudflare.
2. Configure Cloudflare Builds with `bun run build:cloudflare` as the build
   command and `bunx wrangler deploy` as the deploy command. The Convex deploy
   supplies the production URL to Vite as `VITE_CONVEX_URL`; do not configure a
   separate static value for it in Cloudflare.
3. Keep the root directory as `/`. The Worker serves `dist` according to
   `wrangler.jsonc`.
4. Attach `poker.stefanbt.com` as the Worker custom domain in Cloudflare.

For an intentional local production release, `bun run deploy` performs the
same Convex-backed build and then publishes the Worker. Both release paths
deploy the production Convex backend and require `CONVEX_DEPLOY_KEY` in CI (or
an authenticated Convex project locally).

Invite routing uses URL fragments, so direct loads and refreshes do not require additional server routes.
