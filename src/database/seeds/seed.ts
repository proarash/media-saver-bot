import AppDataSource from '../data-source';
import { parseEnv } from '../../config/env.validation';
import { Admin } from '../../modules/telegram/entities/admin.entity';
import { User } from '../../modules/telegram/entities/user.entity';

/**
 * Seeds every uid from ADMINS_LIST into `users` and `admins` (idempotent).
 * Run with `npm run seed` after migrations.
 */
async function seed(): Promise<void> {
  const adminUids: string[] = parseEnv().ADMINS_LIST;
  await AppDataSource.initialize();
  try {
    // Seeds rely on the latest schema; apply any pending migrations first.
    await AppDataSource.runMigrations({ transaction: 'each' });
    if (adminUids.length > 0) {
      const rows: { uid: string }[] = adminUids.map((uid: string): { uid: string } => ({ uid }));
      await AppDataSource.transaction(async (manager): Promise<void> => {
        // INSERT IGNORE on the unique uid index; updateEntity(false) skips reading back generated ids,
        // which fails on MySQL when the row already exists.
        for (const entity of [User, Admin]) {
          await manager.createQueryBuilder().insert().into(entity).values(rows).orIgnore().updateEntity(false).execute();
        }
      });
    }
    console.log(`Seeded ${adminUids.length} admin(s): ${adminUids.join(', ') || '-'}`);
  } finally {
    await AppDataSource.destroy();
  }
}

seed().catch((err: unknown): void => {
  console.error(err);
  process.exitCode = 1;
});
