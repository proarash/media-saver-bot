# Media Saver Bot

Telegram bot and Express service for saving Instagram media (posts, carousels, reels, highlights, and profile pictures) and scraping Instagram user information (`pk`, `username`, `id`) with Puppeteer.

---

## Features

- **Instagram Media Downloader**:
  - Posts, reels, videos, and multi-image carousels.
  - Highlights viewer and downloader.
  - High-definition profile pictures.
  - Admin single ZIP download feature.
- **Instagram User Scraper**:
  - Uses Puppeteer to load `https://instagram.com/<USERNAME>/` and extracts `pk`, `username`, and `id`.
  - Triggered directly in Telegram by sending `@username`.
  - Also exposed via Express REST endpoint: `GET /ig/user/:username`.
- **Telegram Bot Integration**:
  - Built with `telegraf`.
  - Supports both Webhook and Polling modes.
  - Admin access control, user list pagination, and maintenance switch toggle.
- **Database Support**:
  - TypeORM with MySQL for user tracking and bot configurations.
  - Gracefully falls back if database is not reachable.

---

## Project Structure

Everything is consolidated under the `src/ig` directory:

```
├── src/
│   ├── ig/
│   │   ├── entities.ts    # TypeORM Entities (User, Admin, BotSettings)
│   │   ├── db.ts          # TypeORM DataSource & DB initialization
│   │   ├── types.ts       # Shared types and interfaces
│   │   ├── service.ts     # InstagramService (API + Puppeteer) & TelegramService
│   │   ├── controller.ts  # Express HTTP and Telegraf bot handlers
│   │   ├── router.ts      # Express routes (/telegram/webhook, /ig/user/:username)
│   │   └── index.ts       # Re-exports for ig module
│   ├── common/
│   │   └── zip.ts         # In-memory ZIP builder utility
│   └── main.ts            # Application entry point & server setup
├── tsconfig.json          # TypeScript compiler configuration
├── package.json           # Dependencies and lifecycle scripts
└── .env.example           # Environment variables template
```

---

## Requirements

- **Node.js**: v20+ (Node v26 supported)
- **MySQL**: (optional, graceful fallback if omitted)
- **Google Chrome / Chromium**: Installed automatically via Puppeteer

---

## Getting Started

### 1. Environment Configuration

Copy the example environment file:

```bash
cp .env.example .env
```

Configure your `.env` variables:

```env
PORT=3000
NODE_ENV=development

BOT_TOKEN=123456:your-telegram-bot-token
WEBHOOK_DOMAIN=https://your-public-domain.com
WEBHOOK_SECRET=your-random-webhook-secret

ADMINS_LIST=123456789

DB_HOST=localhost
DB_PORT=3306
DB_USERNAME=root
DB_PASSWORD=
DB_DATABASE=media_saver_bot
DB_LOGGING=false

# Instagram session cookies (optional, for private API endpoints)
IG_CSRF_TOKEN=
IG_LSD=
IG_DATR=
IG_DID=
IG_MID=
IG_DS_USER_ID=
IG_SESSION_ID=
IG_RUR=
```

### 2. Install Dependencies

```bash
npm install
npx puppeteer browsers install chrome
```

---

## Scripts

- **Development** (incremental compilation with `tsc -w` and auto-reload with `node --watch`):
  ```bash
  npm run dev
  ```
- **Build**:
  ```bash
  npm run build
  ```
- **Start** (production):
  ```bash
  npm start
  ```
- **TypeScript Watch Only**:
  ```bash
  npm run watch
  ```

---

## API & Bot Usage

### Telegram Bot Commands & Interactions

- Send any post/reel URL: Replies with the photo or video.
- Send `/highlights <username>`: Displays interactive highlight buttons.
- Send `@username` or raw `username`: Scrapes Instagram profile using Puppeteer and replies with:
  ```json
  {
    "pk": "...",
    "username": "...",
    "id": "..."
  }
  ```
- Admin Commands:
  - `/zip <link | username>`: Downloads all media bundled in a single ZIP.
  - `/users`: Lists registered bot users.
  - `/disable`: Toggles bot access for non-admin users.
  - `/forward`: Forwards non-admin messages to admins when disabled.

### HTTP Endpoints

- `POST /telegram/webhook`: Webhook endpoint for Telegram updates.
- `GET /ig/user/:username`: Puppeteer scraper endpoint returning user `{ pk, username, id }` as JSON.
