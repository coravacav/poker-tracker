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

If a deployment is already configured, regenerate types with `bun run convex:codegen`. The production backend command is `bunx convex deploy`; run it only as an intentional release step.

## Environment variables

- `VITE_CONVEX_URL`: public Convex deployment URL embedded in the Vite build. Without it, local games still work and the Share button explains that sharing is unavailable.
- `CONVEX_DEPLOYMENT`: development deployment selector managed by the Convex CLI.

Neither value is a host or guest room credential. Do not commit `.env.local`, deploy keys, or room capabilities.

## Local and shared behavior

- Local games use `poker-tracker:v1:current-game` in `localStorage`. Schema v6 adds a stable `localGameId`; older saves migrate in place.
- On a first visit or after more than 24 hours away, the local start page offers a saved-game continuation or a new game. Returning from a hidden or unfocused tab uses the same check; shared-room and recovery sessions keep their existing routing.
- Sharing is explicit. Convex receives a bounded snapshot only when the host chooses **Share game**.
- While active, Convex is authoritative. The host sends versioned reducer actions, waits for server acceptance, and only then caches the accepted state locally. Financial actions are not optimistic or queued offline.
- Host recovery credentials use a separate local-storage record. A tab-scoped controller ID ensures only one host tab can edit; another tab may explicitly take control.
- If the saved host room cannot be found, the app stops presenting stale sharing controls, preserves the latest accepted local snapshot, and offers retry, local continuation, or a fresh share.
- Guests receive a revocable, tab-scoped capability in `sessionStorage`. Guest room snapshots never write to normal local-game storage.
- Stopping sharing marks the room ended and confirms its final authoritative snapshot before replacing the host’s local state. If that write fails or the response cannot be confirmed, recovery metadata remains and the host sees **Recovery needed** with a retry action.

QR codes contain the guest invitation URL, not host authority. The invitation secret is in the URL fragment so it is not sent in ordinary HTTP requests. Pairing and realtime updates still use Convex over the internet; this is not LAN-only or peer-to-peer transport.

## Snapshot boundary and retention

The first slice stores one bounded game snapshot per room:

- 700,000 encoded bytes maximum
- 24 players maximum
- 5,000 transactions maximum
- 10,000 accepted actions maximum
- 50 non-revoked guest sessions maximum

These limits preserve headroom below Convex’s 1 MB document limit. Before raising them, move transactions and other growing collections into normalized, room-indexed tables. Abandoned active rooms automatically expire after seven days without a host edit. A daily bounded cleanup removes processed-action, audit-event, and notification-cursor detail from ended or expired rooms after 30 days. The final bounded room snapshot and participant capability records remain available, so a host or guest can still review old rooms from the device where they participated.

Shared rooms retain the 500 most recent audit events. The host and every guest have an independent notification read cursor; new guests start caught up, while later transfers, cash-outs, and corrections appear for all current participants.

## Security boundaries and MVP limitations

- Room IDs do not authorize writes. Host, invitation, and guest capabilities are cryptographically random and stored in Convex only as SHA-256 verifiers.
- Every mutation checks the host capability and active controller server-side. Guest queries require a non-revoked guest capability and return a projection without host cash-out drafts.
- Public functions validate arguments; room/action/guest limits provide basic abuse boundaries.
- There are no accounts, IP-based creation limits, CAPTCHA, guest-management UI, or automated cleanup yet. Anyone holding a current invite may join as a read-only guest until the room ends. A compromised host browser storage exposes its active host capability.

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
