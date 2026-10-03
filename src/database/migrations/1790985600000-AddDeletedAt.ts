import type { MigrationInterface, QueryRunner } from 'typeorm';

export class AddDeletedAt1790985600000 implements MigrationInterface {
  public readonly name = 'AddDeletedAt1790985600000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('ALTER TABLE `users` ADD `deleted_at` datetime(6) NULL');
    await queryRunner.query('ALTER TABLE `admins` ADD `deleted_at` datetime(6) NULL');
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('ALTER TABLE `admins` DROP COLUMN `deleted_at`');
    await queryRunner.query('ALTER TABLE `users` DROP COLUMN `deleted_at`');
  }
}
