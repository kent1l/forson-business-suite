#!/usr/bin/env node
/*
 Automated SQL migration runner
 - Applies idempotent SQL files from database/migrations in filename order
 - Tracks applied migrations in public.schema_migrations (filename, checksum, applied_at, duration_ms)
 - Commands: up (default), status, verify, repair
*/

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { Client } = require('pg');
const yargs = require('yargs');

const argv = yargs
  .command('up', 'Apply pending migrations')
  .command('status', 'Show applied and pending migrations')
  .command('verify', 'Verify checksums (drift detection)')
  .command('repair', 'Update stored checksums to match files')
  .option('host', { type: 'string', describe: 'DB host' })
  .option('port', { type: 'number', describe: 'DB port' })
  .option('db', { type: 'string', describe: 'DB name' })
  .option('user', { type: 'string', describe: 'DB user' })
  .option('password', { type: 'string', describe: 'DB password' })
  .option('dry-run', { type: 'boolean', default: false, describe: 'Print plan, do not execute' })
  .option('from', { type: 'string', describe: 'Start from migration (inclusive)' })
  .option('to', { type: 'string', describe: 'End at migration (inclusive)' })
  .help()
  .argv;

const CMD = argv._[0] || 'up';

// Resolve repo root from this script
const repoRoot = path.resolve(__dirname, '../../..');
const migrationsDir = process.env.MIGRATIONS_DIR || path.join(repoRoot, 'database', 'migrations');

function sha256(buf) {
  return crypto.createHash('sha256').update(buf).digest('hex');
}

async function getClient() {
  const client = new Client({
    host: argv.host || process.env.DB_HOST || 'localhost',
    port: argv.port || Number(process.env.DB_PORT) || 5432,
    user: argv.user || process.env.DB_USER || 'postgres',
    password: argv.password || process.env.DB_PASSWORD || 'postgres',
    database: argv.db || process.env.DB_NAME || 'forson_business_suite',
  });
  await client.connect();
  return client;
}

async function ensureMigrationsTable(client) {
  const sql = `
    CREATE TABLE IF NOT EXISTS public.schema_migrations (
      filename text PRIMARY KEY,
      checksum text NOT NULL,
      applied_at timestamptz NOT NULL DEFAULT now(),
      duration_ms integer NOT NULL
    );
  `;
  await client.query(sql);
}

function loadMigrations() {
  if (!fs.existsSync(migrationsDir)) {
    throw new Error(`Migrations directory not found: ${migrationsDir}`);
  }
  const files = fs.readdirSync(migrationsDir)
    .filter(f => f.endsWith('.sql'))
    .sort();
  const slice = (list) => {
    let out = list;
    if (argv.from) out = out.slice(out.indexOf(argv.from));
    if (argv.to) out = out.slice(0, out.indexOf(argv.to) + 1);
    return out;
  };
  return slice(files).map(f => {
    const full = path.join(migrationsDir, f);
    const content = fs.readFileSync(full);
    return { name: f, full, content, checksum: sha256(content) };
  });
}

async function getApplied(client) {
  const res = await client.query('SELECT filename, checksum FROM public.schema_migrations ORDER BY filename');
  const map = new Map();
  res.rows.forEach(r => map.set(r.filename, r.checksum));
  return map;
}

async function applyMigration(client, m, dryRun) {
  if (dryRun) {
    console.log(`DRY RUN: would apply ${m.name}`);
    return { duration: 0 };
  }
  const start = Date.now();
  await client.query('BEGIN');
  try {
    await client.query(m.content.toString('utf8'));
    const duration = Date.now() - start;
    await client.query(
      'INSERT INTO public.schema_migrations (filename, checksum, duration_ms) VALUES ($1,$2,$3) ON CONFLICT (filename) DO UPDATE SET checksum = EXCLUDED.checksum, applied_at = now(), duration_ms = EXCLUDED.duration_ms',
      [m.name, m.checksum, duration]
    );
    await client.query('COMMIT');
    return { duration };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  }
}

async function main() {
  const migrations = loadMigrations();
  const client = await getClient();
  try {
    await ensureMigrationsTable(client);
    const applied = await getApplied(client);

    if (CMD === 'status') {
      let drift = false;
      migrations.forEach(m => {
        const have = applied.get(m.name);
        if (!have) return;
        if (have !== m.checksum) drift = true;
      });
      const pending = migrations.filter(m => !applied.has(m.name));
      console.log(`Applied: ${applied.size}`);
      console.log(`Pending: ${pending.length}`);
      if (pending.length) pending.forEach(m => console.log(`  - ${m.name}`));
      if (drift) {
        console.warn('WARNING: drift detected (changed files vs recorded checksums). Run verify for details.');
        process.exitCode = 1;
      }
      return;
    }

    if (CMD === 'verify') {
      let errors = 0;
      migrations.forEach(m => {
        const have = applied.get(m.name);
        if (!have) return;
        if (have !== m.checksum) {
          console.error(`Drift: ${m.name} recorded=${have} current=${m.checksum}`);
          errors++;
        }
      });
      if (errors) process.exit(1);
      console.log('Checksums verified.');
      return;
    }

    if (CMD === 'repair') {
      let updated = 0;
      for (const m of migrations) {
        const have = applied.get(m.name);
        if (have && have !== m.checksum) {
          await client.query('UPDATE public.schema_migrations SET checksum = $2, applied_at = now() WHERE filename = $1', [m.name, m.checksum]);
          updated++;
          console.log(`Repaired checksum: ${m.name}`);
        }
      }
      console.log(`Repair done. Updated: ${updated}`);
      return;
    }

    // Default: up
    let appliedCount = 0;
    for (const m of migrations) {
      if (applied.has(m.name)) {
        // drift detection
        const have = applied.get(m.name);
        if (have !== m.checksum) {
          console.error(`Drift detected for ${m.name}. Refusing to proceed. Run "migrate:verify" or "repair" after reviewing changes.`);
          process.exit(1);
        }
        continue;
      }
      console.log(`Applying ${m.name} ...`);
      const { duration } = await applyMigration(client, m, argv['dry-run']);
      console.log(`✔ Applied ${m.name} in ${duration} ms`);
      appliedCount++;
    }
    console.log(appliedCount ? `Done. Applied ${appliedCount} migration(s).` : 'No pending migrations.');
  } finally {
    await client.end();
  }
}

main().catch(err => {
  console.error('Migration failed:', err.message);
  process.exit(1);
});
