import {
  BaseEntity,
  CreateDateColumn,
  DeleteDateColumn,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
  Column,
  Entity,
  Index,
  PrimaryColumn,
} from 'typeorm';

export abstract class FixedEntity extends BaseEntity {
  @PrimaryGeneratedColumn({ type: 'int', unsigned: true })
  id: number;

  @CreateDateColumn({ name: 'created_at', type: 'datetime' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'datetime' })
  updatedAt: Date;

  @DeleteDateColumn({ name: 'deleted_at', type: 'datetime', nullable: true })
  deletedAt: Date | null;
}

@Entity({ name: 'users' })
@Index('UQ_users_uid', ['uid'], { unique: true })
export class User extends FixedEntity {
  @Column({ type: 'bigint' })
  uid: string;

  @Column({ type: 'varchar', length: 255, nullable: true })
  full_name: string | null;

  @Column({ type: 'varchar', length: 64, nullable: true })
  username: string | null;

  @Column({ type: 'varchar', length: 32, nullable: true })
  phone_number: string | null;

  @Column({ type: 'text', nullable: true })
  bio: string | null;

  @Column({ type: 'varchar', length: 16, nullable: true })
  lang: string | null;
}

@Entity({ name: 'admins' })
@Index('UQ_admins_uid', ['uid'], { unique: true })
export class Admin extends FixedEntity {
  @Column({ type: 'bigint' })
  uid: string;

  @Column({ type: 'varchar', length: 255, nullable: true })
  full_name: string | null;

  @Column({ type: 'varchar', length: 64, nullable: true })
  username: string | null;
}

export const BOT_SETTINGS_ID = 1;

@Entity({ name: 'bot_settings' })
export class BotSettings {
  @PrimaryColumn({ type: 'int', unsigned: true })
  id: number;

  @Column({ type: 'boolean', default: false })
  disabled: boolean;

  @Column({ type: 'boolean', default: false })
  forward_enabled: boolean;

  @UpdateDateColumn({ type: 'datetime' })
  updated_at: Date;
}
