# github-core-clone-01 — a standalone GitHub-compatible git forge

One process, Node 22 stdlib only, in-memory store. Serves git smart HTTP
(protocol v2 ls-refs/fetch, v0 receive-pack with report-status), the REST v3
API (repositories, branches, commits, contents, issues, comments, labels,
pull requests, files, merges), GraphQL v4 (the documents `gh` and
`github-mcp-server` send), and MCP over streamable HTTP — all from the same
store, so a repository created over one surface is visible on the others.

## Run it

```sh
node --experimental-strip-types main.ts
```

The platform runs `node /bot/main.ts` on Node 22.18 or later. The process
binds an ephemeral port, registers it at `$MAKEFUN_ENV_URL/register`, polls
`$MAKEFUN_ENV_URL/done`, and exits 0 when the trial is over.

## Test it locally

Start the server with a launcher that imports `createApp` from `app.ts`,
then run the kit's conformance runner against it:

```sh
MAKEFUN_SHOP_TOKEN=test-token node --experimental-strip-types \
  ~/workspace/github-core-clone-01-kit/github-core-clone-01-kit/sdk/run.ts \
  --url http://127.0.0.1:PORT --token test-token --json
```

## Layout

- `main.ts`: the entry <-> env lifecycle (bind, register, wait for done).
- `app.ts`: the whole server — git objects/packs, REST, GraphQL, MCP.
