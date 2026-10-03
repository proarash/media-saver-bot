import { Column, Entity, Index } from 'typeorm';
import { FixedEntity } from '../../../common/entities/fixed.entity';

@Entity({ name: 'admins' })
@Index('UQ_admins_uid', ['uid'], { unique: true })
export class Admin extends FixedEntity {
  /** Telegram user id (bigint is returned as string by mysql2) */
  @Column({ type: 'bigint' })
  uid: string;

  @Column({ type: 'varchar', length: 255, nullable: true })
  full_name: string | null;

  @Column({ type: 'varchar', length: 64, nullable: true })
  username: string | null;
}
