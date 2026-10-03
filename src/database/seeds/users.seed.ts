import AppDataSource from '../data-source';
import { User } from '../../modules/telegram/entities/user.entity';

const USER_COUNT = 100;
/** Fake uids start high so they don't collide with real Telegram ids used in testing. */
const BASE_UID = 9_000_000_000;

const FIRST_NAMES: readonly string[] = ['Ali', 'Sara', 'Reza', 'Maryam', 'John', 'Emma', 'Omid', 'Nika', 'David', 'Lena'];
const LAST_NAMES: readonly string[] = ['Ahmadi', 'Karimi', 'Smith', 'Rahimi', 'Brown', 'Moradi', 'Miller', 'Jafari', 'Wilson', 'Hosseini'];
const LANGS: readonly string[] = ['en', 'fa', 'de', 'tr'];

function pick<T>(items: readonly T[], index: number): T {
  return items[index % items.length] as T;
}

/**
 * Inserts USER_COUNT fake users (idempotent: re-running updates the same uids).
 * Run with `npm run seed:users` after migrations.
 */
async function seedUsers(): Promise<void> {
  const users: Partial<User>[] = Array.from({ length: USER_COUNT }, (_: unknown, i: number): Partial<User> => {
    const first: string = pick(FIRST_NAMES, i);
    const last: string = pick(LAST_NAMES, Math.floor(i / FIRST_NAMES.length));
    return {
      uid: String(BASE_UID + i + 1),
      full_name: `${first} ${last}`,
      username: `${first}_${last}_${i + 1}`.toLowerCase(),
      lang: pick(LANGS, i),
    };
  });

  await AppDataSource.initialize();
  try {
    // Seeds rely on the latest schema; apply any pending migrations first.
    await AppDataSource.runMigrations({ transaction: 'each' });
    // ON DUPLICATE KEY UPDATE on uid; updateEntity(false) skips reading back generated ids,
    // which fails on MySQL when the row already exists.
    await AppDataSource.createQueryBuilder()
      .insert()
      .into(User)
      .values(users)
      .orUpdate(['full_name', 'username', 'lang'], ['uid'])
      .updateEntity(false)
      .execute();
    console.log(`Seeded ${users.length} users`);
  } finally {
    await AppDataSource.destroy();
  }
}

seedUsers().catch((err: unknown): void => {
  console.error(err);
  process.exitCode = 1;
});
