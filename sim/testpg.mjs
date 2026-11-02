// A throwaway Postgres 17 for the tests that need real connections, on 127.0.0.1:<port> with user postgres.
// Normally embedded (a temp folder). Embedded Postgres refuses to run from an elevated Windows shell,
// so there it runs as a postgres:17-alpine container instead. POWER_TEST_PG=docker forces the container.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const pgCtl = path.join(path.dirname(fileURLToPath(import.meta.url)), 'node_modules', '@embedded-postgres', 'windows-x64', 'native', 'bin', 'pg_ctl.exe');
const elevated = () => process.platform === 'win32'
  ? spawnSync('net', ['session'], { stdio: 'ignore', windowsHide: true }).status === 0
  : process.getuid?.() === 0;
const docker = (args, timeout = 120000) => spawnSync('docker', args, { encoding: 'utf8', timeout, windowsHide: true });

export async function startPostgres({ port, password, database, flags = [] }) {
  if (process.env.POWER_TEST_PG === 'docker' || elevated()) {
    if (docker(['info', '--format', '{{.ServerVersion}}'], 60000).status !== 0) {
      throw new Error('Embedded Postgres cannot run from an elevated shell, and Docker is not answering: start Docker, or run from a normal shell');
    }
    const name = `power-testpg-${port}-${process.pid}`;
    const run = docker(['run', '-d', '--rm', '--name', name, '-p', `127.0.0.1:${port}:5432`,
      '-e', `POSTGRES_PASSWORD=${password}`, '-e', `POSTGRES_DB=${database}`, '-e', 'POSTGRES_INITDB_ARGS=--encoding=UTF8 --locale=C',
      'postgres:17-alpine', ...flags], 600000);
    if (run.status !== 0) throw new Error(`docker run postgres:17-alpine failed: ${run.stderr.trim()}`);
    for (let i = 0; docker(['exec', name, 'pg_isready', '-h', '127.0.0.1', '-U', 'postgres', '-d', database], 30000).status !== 0; i++) {
      if (i > 120) { docker(['rm', '-f', name]); throw new Error('Postgres container did not become ready'); }
      await new Promise((r) => setTimeout(r, 500));
    }
    return { where: 'docker', stop: async () => { docker(['rm', '-f', name]); } };
  }
  const { default: EmbeddedPostgres } = await import('embedded-postgres');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `${database.replace(/_/g, '-')}-`));
  // persistent: true because its own cleanup crashes the process when Windows still holds a file. We clean up here, with retries.
  const pg = new EmbeddedPostgres({ databaseDir: dir, port, user: 'postgres', password, persistent: true, onLog: () => {}, onError: () => {},
    initdbFlags: ['--encoding=UTF8', '--locale=C'], postgresFlags: flags });
  await pg.initialise();
  await pg.start();
  await pg.createDatabase(database);
  return {
    where: 'embedded',
    stop: async () => {
      // On Windows the library kills the server outright, which can orphan a child process still holding the folder. Shut down cleanly first.
      if (fs.existsSync(pgCtl)) spawnSync(pgCtl, ['stop', '-D', dir, '-m', 'fast', '-w', '-t', '20'], { stdio: 'ignore', windowsHide: true });
      await Promise.race([pg.stop().catch(() => {}), new Promise((r) => setTimeout(r, 5000))]);
      try { fs.rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 500 }); } catch {}
    },
  };
}
