import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import type { User as TgUser } from 'telegraf/types';
import { Admin } from './entities/admin.entity';
import { BOT_SETTINGS_ID, BotSettings } from './entities/bot-settings.entity';
import { User } from './entities/user.entity';
import type { TelegramUserPayload, UsersPage } from './types/telegram.types';

@Injectable()
export class TelegramService {
  private settingsCache: BotSettings | null = null;

  constructor(
    @InjectRepository(User) private readonly userRepository: Repository<User>,
    @InjectRepository(Admin) private readonly adminRepository: Repository<Admin>,
    @InjectRepository(BotSettings) private readonly settingsRepository: Repository<BotSettings>,
  ) {}

  public toPayload(from: TgUser): TelegramUserPayload {
    const fullName: string = [from.first_name, from.last_name].filter(Boolean).join(' ');
    return {
      uid: String(from.id),
      full_name: fullName === '' ? null : fullName,
      username: from.username ?? null,
      lang: from.language_code ?? null,
    };
  }

  public async upsertUser(payload: TelegramUserPayload): Promise<User> {
    const existing: User | null = await this.userRepository.findOneBy({ uid: payload.uid });
    const user: User = existing ?? this.userRepository.create({ uid: payload.uid });
    user.full_name = payload.full_name;
    user.username = payload.username;
    user.lang = payload.lang;
    return this.userRepository.save(user);
  }

  public async setPhoneNumber(uid: string, phoneNumber: string): Promise<void> {
    await this.userRepository.update({ uid }, { phone_number: phoneNumber });
  }

  public async isAdmin(uid: string): Promise<boolean> {
    return this.adminRepository.existsBy({ uid });
  }

  public async getAdminUids(): Promise<string[]> {
    const admins: Admin[] = await this.adminRepository.find({ select: { uid: true } });
    return admins.map((admin: Admin): string => admin.uid);
  }

  public async listUsers(page: number, pageSize: number): Promise<UsersPage> {
    const total: number = await this.userRepository.count();
    const totalPages: number = Math.max(1, Math.ceil(total / pageSize));
    const current: number = Math.min(Math.max(1, page), totalPages);
    const users: User[] = await this.userRepository.find({
      select: { uid: true, full_name: true, username: true },
      order: { id: 'ASC' },
      skip: (current - 1) * pageSize,
      take: pageSize,
    });
    return { users, page: current, totalPages, total };
  }

  public async getSettings(): Promise<BotSettings> {
    if (this.settingsCache !== null) return this.settingsCache;
    const existing: BotSettings | null = await this.settingsRepository.findOneBy({ id: BOT_SETTINGS_ID });
    this.settingsCache =
      existing ??
      (await this.settingsRepository.save(
        this.settingsRepository.create({ id: BOT_SETTINGS_ID, disabled: false, forward_enabled: false }),
      ));
    return this.settingsCache;
  }

  public async toggleDisabled(): Promise<BotSettings> {
    const settings: BotSettings = await this.getSettings();
    settings.disabled = !settings.disabled;
    this.settingsCache = await this.settingsRepository.save(settings);
    return this.settingsCache;
  }

  public async toggleForward(): Promise<BotSettings> {
    const settings: BotSettings = await this.getSettings();
    settings.forward_enabled = !settings.forward_enabled;
    this.settingsCache = await this.settingsRepository.save(settings);
    return this.settingsCache;
  }
}
