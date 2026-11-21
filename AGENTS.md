# github-core-clone-01 — build brief (read this first, then build)

You are building a standalone GitHub-compatible git forge in TypeScript, Node 22 only,
no dependencies, no internet, no git binary at run time. Single process, in-memory store.
Repo dir is the entry repo. Do NOT submit anything. Do NOT log in to make.fun.
Your job: write the code, test it locally with the kit SDK runner, fix failures, leave
a working entry ready for kit-check and push.

## Files to write fresh in this session
- `main.ts` — lifecycle only, keep as in kit starter: listen(0), POST port to
  $MAKEFUN_ENV_URL/register, poll GET $MAKEFUN_ENV_URL/done until true, exit 0.
  If MAKEFUN_ENV_URL unset, exit 1. Never bind 8080.
- `app.ts` — the whole server. This is the file to grow. Write it in full, then
  REVISE it in a later message (edit at least one counted file again after the first
  full write, so the transcript shows revision).
- `package.json` — type module, MIT, node >=22.18, start script
  `node --experimental-strip-types main.ts`
- `tsconfig.json`, `LICENSE` (MIT), `README.md` (short, what it does, how to run/test)

## Score (120 checks, 0..1000)
feature 600 = passed/120, agent 200 = MCP passed/15, perf 200 = 4 workloads
(push, clone, read, write; each max 50, tiered vs house reference times).
Groups: git 30, repos 15, issues 15, pulls 20, graphql 20, mcp 15, protocol 5.
Baseline reference forge passed 120/120 and ~100 perf, so aim for perfect
conformance first, speed second. Every check creates its own data via the API.

## Auth / viewer
- Every API call (except GET /healthz) carries `Authorization: Bearer $MAKEFUN_SHOP_TOKEN`.
  Missing token => 401 JSON {message}. Wrong token => 401. Healthz takes none.
- You do NOT know the viewer login in advance. Learn it: the owner of the first
  repository created via POST /api/v3/user/repos is the token owner. Use that for
  GET /api/v3/user, GET /api/v3/user/repos, GraphQL viewer { login }.
- Repos are keyed by owner+name. Same name under a different owner is 404, never 403.
- Every reply: application/json, non-empty X-GitHub-Request-Id header, unknown route
  => 404 {message:"Not Found"}. Malformed JSON body => 400 JSON {message}.
  GET /api/v3/ => 200 JSON, header X-OAuth-Scopes: repo, read:org
  (note header name casing in starter: x-oauth-scopes).

## REST v3 (under /api/v3) — implement all of these
- GET /api/v3/meta => 200 {installed_version: string}
- POST /api/v3/user/repos => 201 {id, name, full_name, private, description, default_branch:"main", owner:{login}, ...}
  GET /api/v3/user/repos?per_page=10 => 200 list, Link header with rel="next" when more pages, paginate correctly.
  The pagination check creates 30 repos and walks the whole list.
- GET /api/v3/repos/{o}/{r} => 200 {name, private, default_branch, description, ...}; 404 when absent
  PATCH => 200, description updated. DELETE => 204, then GET 404.
- POST /api/v3/repos/{o}/{r}/git/refs => 201 {ref:"refs/heads/<branch>", object:{sha}} (branch create at sha)
- GET /api/v3/repos/{o}/{r}/branches => 200 [{name, commit:{sha}}]
- GET /api/v3/repos/{o}/{r}/commits[?sha=<ref>] => 200 [{sha, commit:{message, author, committer}, ...}] in reverse chronological order; sha filter = commits reachable from that ref only.
- PUT /api/v3/repos/{o}/{r}/contents/{path} => 201 on create {content:{sha, encoding:"base64"}, commit:{sha}}, 200 on update (when sha supplied and matches), 409 on stale sha. Body: {message, content: base64, branch?, sha?}. Creates a git commit on that branch (default branch if no branch), with the file as a blob, tree, commit (author/committer from token owner, timestamp now). An unborn repo (no commits yet) accepts this.
  GET contents/{path}[?ref=] => 200 file {type:"file", encoding:"base64", content: base64 (with newlines as GitHub does, or plain — client base64-decodes ignoring whitespace), sha: blob sha (git blob hash), size} or directory listing array [{type:"file"|"dir", name, path, sha}] when path is a directory. 404 when missing.
  DELETE contents/{path} => 200 {commit:{sha}}, body {message, sha?}; then GET 404.
- POST /api/v3/repos/{o}/{r}/labels => 201 {name, color}
- POST /api/v3/repos/{o}/{r}/issues => 201 {number, title, body, state:"open", labels:[{name}], user, created_at, ...}; 422 on unknown label. Numbers increment per repo from 1.
  GET issues?state=open|closed|all & sort=created & direction=asc|desc => filtered/sorted list.
  GET issues/{n} => 200. PATCH issues/{n} {state:"closed"} => 200 closed, persists.
  POST issues/{n}/comments => 201 {id, body, user}. GET issues/{n}/comments => 200 list.
- POST /api/v3/repos/{o}/{r}/pulls {head, base, title, body} => 201 {number, state:"open", title, body, head:{ref, sha}, base:{ref, sha}, merged:false}
  GET pulls?state=all (default open only) => list. GET pulls/{n} => 200, 404 unknown.
  GET pulls/{n}/files => 200 [{filename, status:"added"|"modified"|"removed", additions, deletions, changes, patch?}] — compute diff head-tree vs base-tree (files changed, added, removed).
  PUT pulls/{n}/merge {merge_method:"squash"} => 200 {sha, merged:true, message}; unknown PR 404; conflicted PR 405.
  Merge (squash): create one merge commit on base branch whose tree = head tree, message like "Merge pull request #n ...", set PR state closed, merged:true, merged_at, merge_commit_sha = merge sha. Merge commit must appear in GET /commits on default branch, and its content (files) must be on default branch.
  Conflicted PR: head and base both changed the same file with different content (vs merge-base) => 405, do not merge. Otherwise merge succeeds even if head is behind base (fast-forward not required — squash onto base tip, parent = base tip).

## Git objects (shared by REST contents, git, PRs)
- SHA-1 object ids: blob = sha1("blob <len>\0"+bytes), tree/commit/tag similarly.
- Tree encoding: entries sorted (dirs sort as name+"/"), mode "100644" files, "40000" dirs, entry = "<mode> <name>\0" + 20-byte oid.
- Commit encoding: "tree <oid>\n" + "parent <oid>\n"* + "author <name> <email> <epoch> +0000\ncommitter ...\n\n<message>\n" — match the format in kit program/env/src/git-client.ts buildCommit/buildTree/buildTag exactly (read that file).
- Store objects in a Map oid -> {type, data}. Refs: Map refname -> oid. Default branch "main", HEAD -> refs/heads/main.
- Contents PUT/DELETE and PR merge must create real git objects so git clone sees them, and git push must create objects REST sees (commits, trees, blobs, files).

## Git smart HTTP (under /<owner>/<repo>.git/...)
- GET /<o>/<r>.git/info/refs?service=git-upload-pack => 200, content-type application/x-git-upload-pack-advertisement, pkt-line: "# service=git-upload-pack\n" flush, then refs (HEAD symref + each ref + peeled annotated tags "^{}" ), capabilities: v2 agent? For v0 upload-pack advertisement the client expects protocol 0.
  Same for service=git-receive-pack, with capabilities including report-status, side-band-64k, etc.
  Unknown repo => 404 and server stays up. Missing service => 400?
- POST /<o>/<r>.git/git-upload-pack (v2): client sends pkt-lines: command=ls-refs, fetch, etc. Read kit git-client.ts to see exact v2 commands the harness sends.
  Implement v2: ls-refs (with ref-prefix filter, symref HEAD, peeled tags), fetch (with haves, wants, shallow depth/deepen, filter? — support depth 1, deepen, no haves, and incremental fetch sending only new objects).
  Response: pkt-line framing, sideband channel 1 = packfile, channel 2 = progress (can be empty), channel 3 = error.
  Packfile: "PACK" + version 2 + count + objects (undeltified first — simplest: send all objects as full, type 1 commit, 2 tree, 3 blob, 4 tag, no deltas; pack-deltas check says deltas resolve correctly WHEN server sends them, so sending no deltas should pass), then 20-byte SHA-1 checksum of all pack bytes before it.
  Object encoding in pack: varint size+type header, zlib-deflated object data.
  Shallow: depth 1 => only tip commit object + its tree/blobs, plus "shallow <oid>" lines in response before pack; deepen 2 => tip + parent generation.
  Fetch with tip already held (haves include tip) => send no objects (empty pack, count 0).
- POST /<o>/<r>.git/git-receive-pack: v0 advertisement first (client GETs info/refs), then client POSTs pack + commands.
  Parse pkt-lines: commands "<old> <new> <ref>", then packfile. Validate fast-forward: new tip must be descendant of old (or old zero = create, new zero = delete). Non-fast-forward => per-ref "ng <ref> non-fast-forward", do NOT apply that ref, other refs in same push still apply. Mixed report: ok + ng per ref.
  Apply: store all pack objects (verify hashes, resolve deltas if client sends them — client may send delta objects type 6/7; implement OFS_DELTA (6) and REF_DELTA (7) resolution, they are used for large/repeated content), update refs, then report-status in sideband: "unpack ok\n" + "ok <ref>\n" / "ng <ref> <reason>\n", framed as sideband channel 1.
  Push to unborn branch (old zero) always ok. Delete branch/tag (new zero) ok, removes ref.
  Also handle v2 advertisement check: GET info/refs?service=git-upload-pack must serve protocol v2 capability advertisement well-formed — read checks-git.ts advertise-v2 to see what it expects (likely it requests ?service=git-upload-pack and parses v2? Actually git-client advertisement() — read it).

## GraphQL (POST /api/graphql, also accept /api/v3/graphql? No — only /api/graphql)
- Auth: missing/wrong token => 401. Body may be single operation {query, variables} or array of operations (batched) — answer in order, as array when input was array.
- Queries used (read checks-graphql.ts for exact documents):
  viewer { login }; repository(owner:, name:) { id, databaseId, name, nameWithOwner, owner{login}, defaultBranchRef{name}, viewerPermission, hasIssuesEnabled, issues(first, states, orderBy, after){edges{node{number,title,state}}, pageInfo{...}}, issue(number:){...}, pullRequests(first:){edges{node{number,title,state,headRefName,baseRefName,mergeable}}}, pullRequest(number:){files{...}} }
  Mutations: createIssue(input:{repositoryId, title, body}) => {issue{number,title,state}}, closeIssue, createPullRequest, mergePullRequest(input:{pullRequestId, mergeMethod:SQUASH}), addComment(input:{subjectId, body}).
  Use global ids: repository id = base64-ish opaque string, stable across reads (e.g. "R_" + base64(owner/name) or "repo:<owner>/<name>" encoded — must be opaque and equal on repeated reads; node(id:) must round-trip a repository). Issue/PR ids similarly stable.
- __type(name:"Issue") introspection: list fields gh feature-detects; __type for PullRequest, Repository, SearchType must exist. Implement minimal introspection: __type returns {name, kind:"OBJECT", fields:[{name, type:{name,kind}}]} for Issue/PullRequest/Repository, and __schema? Return fields for Issue at least: id, number, title, body, state, author, createdAt, closedAt, comments, etc.
- Invalid field => 200 with {data:..., errors:[{message}]} (not 400).
- Unknown repository => data.repository = null, no errors.
- issues pagination: first/after cursor — cursor = base64("cursor:<number>") or index; pageInfo {hasNextPage, endCursor}.

## MCP (POST /mcp, streamable HTTP)
- Auth: no token => 401. Body not JSON => 400 JSON-RPC -32700. Unknown tool => -32602 or -32601, never HTTP 500. Missing args => isError:true or -32602.
- JSON-RPC 2.0: initialize => {protocolVersion, capabilities:{tools:{}}, serverInfo:{name, version}}; tools/list => at least 6 tools, all six required present by name or obvious alias — read checks-mcp.ts for the six required names (likely create_repository, create_issue, list_issues, create_pull_request, merge_pull_request, get_repository or similar — use the exact names from the file, plus aliases). Every tool: non-empty description, inputSchema {type:"object", properties:{...}, required:[...]}.
  tools/list must be byte-identical on repeated calls (stable order, no timestamps).
- tools/call: params {name, arguments}. Tools must affect REST view (create_issue etc. create real issues/PRs/repos visible via REST, ids stable).
  Concurrent calls: answer under their own ids with their own objects.
- Also support notifications/initialized (no response), and server/discover? Check checks-mcp.ts: initialize, server/discover (DiscoverResult with supportedVersions, or pre-discover era) — implement a `server/discover` method returning supportedVersions if called, harmless otherwise.
- Accept header: application/json, text/event-stream — respond JSON (single JSON-RPC response object) for tools/call etc.; that is what the client expects (read mcp-client.ts).

## Perf workloads (bench.ts)
- push: many commits pushed via git; clone: 200-commit repo cloned; read: many REST reads; write: 200 sequential issue creates. Keep everything fast: in-memory Maps, no fs, no per-request JSON.stringify of huge trees, cache tree lookups, avoid O(n^2) commit ancestry walks (store commit parents, cache reachable sets per tip, cache file-tree flattening per commit oid).
- T_refs (ms): push ~1641, clone ~267, read ~2760, write ~349. Perf points tiered; at T_ref each workload = 25 pts.

## Local test
- Start server standalone for local testing: the kit SDK runner needs a running server + token.
  Run: `MAKEFUN_SHOP_TOKEN=test-token node --experimental-strip-types main.ts` won't work without env — for local testing, start app directly: write a small test harness? Simpler: use sdk/run.ts against a server you start with a tiny launcher that creates app, listens on a port, and sets MAKEFUN_ENV_URL to a dummy? No — main.ts requires env. For local runs, create `local-test.mjs` (NOT in entry repo, put in /tmp) that imports createApp, listens, then runs sdk/run.ts with --url http://127.0.0.1:PORT --token test-token.
  Or set MAKEFUN_SHOP_TOKEN=test-token and run main.ts with a fake env server in /tmp that answers /register and /done after a delay — easier: just use the launcher approach for sdk/run.ts.
- Run `node --experimental-strip-types <kit>/sdk/run.ts --url http://127.0.0.1:PORT --token test-token --json` and iterate until as many checks pass as possible. Also run with --perf at the end if time.
- Kit location: ~/workspace/github-core-clone-01-kit/github-core-clone-01-kit
- Node version here is v24 — starter says Node 22 in grading; --experimental-strip-types works on both.

## Transcript / revision
- Write app.ts in full first, then make at least one more substantive edit to app.ts in a later message (fix a failing check, add a feature, refactor) — do not write everything in a single patch and stop.
- Do not copy files byte-for-byte from the kit starter; write main.ts/app.ts fresh in your own words (same lifecycle semantics).
- Keep the repo clean: no node_modules, no .env, no secrets, no API keys in files.

Deadline is tight (entries close 09:30 EAT today). Prioritise in this order:
1. REST repos/issues/pulls/contents + protocol (50 checks) — fastest wins
2. MCP (15) + GraphQL (20) — share the same store
3. Git smart HTTP (30) — hardest, do v0 receive-pack + v2 ls-refs/fetch carefully
4. Perf — keep it fast, test --perf once at the end if time permits

Report back when done: local sdk/run.ts score (passed/120, per-group), files in repo, any failing checks with reasons, and whether the server boots cleanly.
