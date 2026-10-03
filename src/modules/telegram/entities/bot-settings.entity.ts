import { Column, Entity, PrimaryColumn, UpdateDateColumn } from 'typeorm';

export const BOT_SETTINGS_ID = 1;

/** Single-row table holding the global switches admins toggle with /disable and /forward. */
@Entity({ name: 'bot_settings' })
export class BotSettings {
  @PrimaryColumn({ type: 'int', unsigned: true })
  id: number;

  /** When true the bot ignores everyone except admins (downloads included). */
  @Column({ type: 'boolean', default: false })
  disabled: boolean;

  /** When true and the bot is disabled, messages from users are forwarded to admins. */
  @Column({ type: 'boolean', default: false })
  forward_enabled: boolean;

  @UpdateDateColumn({ type: 'datetime' })
  updated_at: Date;
}
