import {
  BaseEntity,
  CreateDateColumn,
  DeleteDateColumn,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

/** Shared columns for every table. `deletedAt` enables TypeORM soft deletes (`softRemove` / `softDelete`). */
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
