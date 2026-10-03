import type { MigrationInterface, QueryRunner } from 'typeorm';

export class Init1790899200000 implements MigrationInterface {
  public readonly name = 'Init1790899200000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE \`users\` (
        \`id\` int UNSIGNED NOT NULL AUTO_INCREMENT,
        \`uid\` bigint NOT NULL,
        \`full_name\` varchar(255) NULL,
        \`username\` varchar(64) NULL,
        \`phone_number\` varchar(32) NULL,
        \`bio\` text NULL,
        \`lang\` varchar(16) NULL,
        \`created_at\` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
        \`updated_at\` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
        UNIQUE INDEX \`UQ_users_uid\` (\`uid\`),
        PRIMARY KEY (\`id\`)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);
    await queryRunner.query(`
      CREATE TABLE \`admins\` (
        \`id\` int UNSIGNED NOT NULL AUTO_INCREMENT,
        \`uid\` bigint NOT NULL,
        \`full_name\` varchar(255) NULL,
        \`username\` varchar(64) NULL,
        \`created_at\` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
        \`updated_at\` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
        UNIQUE INDEX \`UQ_admins_uid\` (\`uid\`),
        PRIMARY KEY (\`id\`)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);
    await queryRunner.query(`
      CREATE TABLE \`bot_settings\` (
        \`id\` int UNSIGNED NOT NULL,
        \`disabled\` tinyint NOT NULL DEFAULT 0,
        \`forward_enabled\` tinyint NOT NULL DEFAULT 0,
        \`updated_at\` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
        PRIMARY KEY (\`id\`)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);
    await queryRunner.query('INSERT INTO `bot_settings` (`id`, `disabled`, `forward_enabled`) VALUES (1, 0, 0)');
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP TABLE `bot_settings`');
    await queryRunner.query('DROP TABLE `admins`');
    await queryRunner.query('DROP TABLE `users`');
  }
}
