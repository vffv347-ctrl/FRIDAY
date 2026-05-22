# Деплой F.R.I.D.A.Y

Бот деплоится на Railway и работает 24/7. Сайт — отдельным сервисом там же.

## 1. Запушить код в GitHub

Один раз авторизуйся в GitHub:

```bash
gh auth login
```

Выбирай: GitHub.com → HTTPS → авторизация в браузере.

Дальше код заливается:

```bash
git push -u origin main
```

## 2. Бот на Railway (24/7)

1. **railway.app** → войди (можно через GitHub).
2. **New Project** → **Deploy from GitHub repo** → выбери `vffv347-ctrl/FRIDAY`.
3. Открой созданный сервис → **Settings**:
   - **Start Command:** `pnpm --filter @friday/bot start`
   - Build определится сам (Nixpacks: `pnpm install`).
4. Вкладка **Variables** — добавь переменные (значения возьми из `apps/bot/.env`):
   - `TELEGRAM_BOT_TOKEN`
   - `ANTHROPIC_API_KEY`
   - `OPENAI_API_KEY`
   - `SUPABASE_URL`
   - `SUPABASE_SECRET_KEY`
   - `OWNER_TELEGRAM_ID`
5. **Deploy**. В логах — `✅ F.R.I.D.A.Y запущена`.

Боту порт не нужен — он работает на long polling.

⚠️ После деплоя локальный бот нужно остановить: два бота на одном токене конфликтуют.

## 3. Сайт на Railway (отдельный сервис)

1. В том же проекте → **New** → **GitHub Repo** → снова `vffv347-ctrl/FRIDAY`.
2. **Settings**:
   - **Build Command:** `pnpm --filter @friday/web build`
   - **Start Command:** `pnpm --filter @friday/web start`
3. **Variables** (значения из `apps/web/.env.local`):
   - `NEXT_PUBLIC_SUPABASE_URL`
   - `NEXT_PUBLIC_SUPABASE_ANON_KEY`
4. **Settings → Networking → Generate Domain** — получишь публичный адрес сайта.

## 4. После деплоя

- Бот отвечает в Telegram постоянно, даже когда твой компьютер выключен.
- Обновления: `git push` → Railway пересобирает автоматически.
- Все данные (память, тарифы, напоминания) — в Supabase, при пересборке не теряются.
