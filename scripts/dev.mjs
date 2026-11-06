// `npm run dev`: the collector (http://localhost:8080) and the dashboard (http://localhost:5173)
// together, the dashboard talking to the collector through Vite's /api proxy.
// Set VITE_USE_MOCKS=true in your shell to keep the dashboard on built-in sample data instead
// (or use `npm run dev:mocks` for the dashboard alone).
import { spawn } from 'node:child_process';

const env = { ...process.env, VITE_USE_MOCKS: process.env.VITE_USE_MOCKS ?? 'false' };

const children = [
  ['collector', ['--workspace', 'collector', 'run', 'dev']],
  ['dashboard', ['--workspace', 'dashboard', 'run', 'dev']],
].map(([name, args]) => {
  // One command string (not an args array) through the shell, so npm resolves on every platform.
  const child = spawn(`npm ${args.join(' ')}`, { env, stdio: ['ignore', 'pipe', 'pipe'], shell: true });
  const prefix = (chunk) =>
    chunk
      .toString()
      .split(/\r?\n/)
      .filter(Boolean)
      .map((line) => `[${name}] ${line}`)
      .join('\n') + '\n';
  child.stdout.on('data', (c) => process.stdout.write(prefix(c)));
  child.stderr.on('data', (c) => process.stderr.write(prefix(c)));
  child.on('exit', (code) => {
    console.log(`[${name}] exited with ${code}`);
    stopAll(code ?? 0);
  });
  return child;
});

let stopping = false;
function stopAll(code) {
  if (stopping) return;
  stopping = true;
  for (const c of children) if (c.exitCode === null) c.kill();
  process.exitCode = code;
}
process.on('SIGINT', () => stopAll(0));
process.on('SIGTERM', () => stopAll(0));
