#!/usr/bin/env tsx
/**
 * Migration CLI: npm run db:migrate | db:rollback | db:status | db:reset
 */
import { migrate, rollback, status, reset } from './migrator';
import { closePool } from './pool';
import { config } from '../config/env';

async function main(): Promise<void> {
  const command = process.argv[2];

  switch (command) {
    case 'migrate': {
      const applied = await migrate();
      console.log(applied.length ? `Applied ${applied.length} migration(s).` : 'Already up to date.');
      break;
    }
    case 'rollback': {
      const steps = Number(process.argv[3] ?? 1);
      const reverted = await rollback(Number.isFinite(steps) && steps > 0 ? steps : 1);
      console.log(reverted.length ? `Rolled back: ${reverted.join(', ')}` : 'Nothing to roll back.');
      break;
    }
    case 'status': {
      const rows = await status();
      console.log('\n  Migration status\n  ----------------');
      for (const row of rows) {
        console.log(`  [${row.applied ? 'x' : ' '}] ${row.name}`);
      }
      console.log('');
      break;
    }
    case 'reset': {
      if (config.isProduction) {
        console.error('Refusing to reset the database in production.');
        process.exitCode = 1;
        break;
      }
      await reset();
      console.log('Database reset and migrated from scratch.');
      break;
    }
    default:
      console.error('Usage: tsx src/db/cli.ts <migrate|rollback [steps]|status|reset>');
      process.exitCode = 1;
  }
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(() => closePool());
