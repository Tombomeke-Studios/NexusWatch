/**
 * Loads the repo root's `.env` for `npm run dev` / `dev:collector`, when there is one. Done in the
 * process instead of with `--env-file`: Node's watch mode also watches that file and crashes when it
 * does not exist. Variables already set (Docker, the shell) win, as with `--env-file`.
 */
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

const file = resolve(process.cwd(), '../.env');
if (existsSync(file)) process.loadEnvFile(file);
