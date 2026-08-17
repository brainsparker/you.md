# you.md for ChatGPT

The first ChatGPT-native integration for you.md. It answers one question:

> Can ChatGPT turn what it already knows about a user into a portable profile
> they want to keep?

A user asks ChatGPT to create their you.md, reviews what it wrote, corrects it in
conversation, and exports the file. That's the whole product.

## How it fits together

```
ChatGPT (context it already has)
   ↓  synthesizes the profile
you.md skill  (skills/you-md/SKILL.md)
   ↓  calls tools
you.md MCP server  (src/chatgpt/)
   ↓
profile store  (memory | Postgres)
```

**ChatGPT does the synthesis.** There is no developer API that hands a server the
user's ChatGPT memory, and this server does not try to infer one. It receives
already-written markdown, validates it against the you.md schema, versions it,
and hands it back. The skill is what makes the profile good; the server is what
makes it durable.

## Package layout

| Path | What it is |
| --- | --- |
| `.codex-plugin/plugin.json` | Plugin manifest (skills + MCP server) |
| `.mcp.json` | Points at the deployed remote MCP endpoint |
| `skills/you-md/SKILL.md` | The skill: when to trigger, what to include, how to edit |
| `schema.sql` | Postgres schema for the profile store |
| `.env.example` | Server configuration |

The server implementation lives in [`src/chatgpt/`](../../src/chatgpt) rather than
here, so it builds with the repo's existing TypeScript setup and imports the
`@brainsparker/you-md` parser and validator directly instead of forking the
schema logic.

## Tools

| Tool | Purpose |
| --- | --- |
| `youmd_create_profile` | Store the user's first profile. Refuses to overwrite an existing one. |
| `youmd_get_profile` | Fetch the current markdown and version. Required before an edit. |
| `youmd_update_profile` | Replace the markdown. Requires `base_version`; stale updates are rejected. |
| `youmd_export_profile` | Return the portable `you.md` artifact. |

The server never performs inference. It validates, stamps `last_updated`,
versions, and stores.

## Running it

```bash
npm install
npm run build

# Local, no auth, in-memory store — enough to exercise the whole flow
node bin/you-md-chatgpt.js

# With persistence and bearer auth
psql "$DATABASE_URL" -f apps/chatgpt/schema.sql
npm install pg
DATABASE_URL=... YOUMD_API_TOKENS="tok_abc:user_1" node bin/you-md-chatgpt.js
```

The endpoint is `POST /mcp` (Streamable HTTP), with `GET /healthz` for probes.
ChatGPT connects to remote MCP endpoints, so deploy this somewhere reachable and
put that URL in `.mcp.json`.

Without `YOUMD_API_TOKENS` the server runs as a single local dev user; it refuses
to start that way when `NODE_ENV=production`.

## Authentication

V0 uses static bearer tokens — enough for internal development and a closed test
group. OAuth slots in behind the `AuthResolver` interface in
`src/chatgpt/auth.ts` without the tools or storage changing.

## Privacy

- Profiles are private by default and never made public automatically.
- No profile is ever exposed to another user; every storage call is scoped by
  user id.
- The server never infers new personal facts about anyone.
- Telemetry carries counts and outcomes only — never profile text.

## Testing

```bash
npm test                      # unit + protocol tests
npm run eval:chatgpt          # skill evals (needs ANTHROPIC_API_KEY)
```

The skill evals matter more than backend coverage here. They run synthetic user
histories through the skill and check that the generated profile picks up
repeated preferences and professional context, leaves out incidental details,
invents nothing, and parses as valid you.md. See
[`eval/chatgpt/`](../../eval/chatgpt).
