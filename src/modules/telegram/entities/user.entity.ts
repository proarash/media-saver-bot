import { Column, Entity, Index } from 'typeorm';
import { FixedEntity } from '../../../common/entities/fixed.entity';

@Entity({ name: 'users' })
@Index('UQ_users_uid', ['uid'], { unique: true })
export class User extends FixedEntity {
  /** Telegram user id (bigint is returned as string by mysql2) */
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
