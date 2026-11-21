// Entry lifecycle: bind an ephemeral port, register it with the env, wait for done.
import { createApp } from './app.ts';

const ENV_URL = (process.env.MAKEFUN_ENV_URL ?? '').replace(/\/+$/, '');
if (ENV_URL === '') {
  process.stderr.write('[entry] MAKEFUN_ENV_URL is not set\n');
  process.exit(1);
}
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));
async function register(port: number): Promise<void> {
  for (let attempt = 0; ; attempt++) {
    try {
      const res = await fetch(`${ENV_URL}/register`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ port }),
        signal: AbortSignal.timeout(30_000),
      });
      if (res.status === 200 || res.status === 409) return;
      if (res.status === 400 || res.status === 405) throw new Error(`register HTTP ${res.status}`);
    } catch (e) {
      if (e instanceof Error && e.message.startsWith('register HTTP ')) throw e;
    }
    await sleep(Math.min(2000, 250 * 2 ** Math.min(attempt, 8)));
  }
}
async function waitDone(): Promise<void> {
  for (let attempt = 0; ; attempt++) {
    try {
      const res = await fetch(`${ENV_URL}/done`, { signal: AbortSignal.timeout(30_000) });
      if (res.ok) {
        const body = (await res.json()) as { done?: unknown };
        if (body.done === true) return;
      }
    } catch { /* retry */ }
    await sleep(Math.min(2000, 250 * 2 ** Math.min(attempt, 8)));
  }
}
async function main(): Promise<void> {
  const server = createApp();
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, () => resolve());
  });
  const addr = server.address();
  if (addr === null || typeof addr === 'string') throw new Error('no ephemeral port');
  process.stdout.write(`[entry] listening on port ${addr.port}\n`);
  await register(addr.port);
  process.stdout.write('[entry] registered; waiting for done\n');
  await waitDone();
  server.close();
  process.stdout.write('[entry] done\n');
}
try {
  await main();
  process.exit(0);
} catch (e) {
  process.stderr.write(`[entry] ${e instanceof Error ? e.message : String(e)}\n`);
  process.exit(1);
}
