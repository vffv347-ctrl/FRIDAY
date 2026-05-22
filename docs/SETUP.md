# Запуск F.R.I.D.A.Y — этап 1 (сайт + бэк-офис)

Пошаговая инструкция. Пункты, отмеченные **[ТЫ]**, нужно сделать вручную —
остальное уже готово в коде.

## 1. Установить зависимости

```bash
cd /Users/petrminkin19/Desktop/FRIDAY
pnpm install
```

## 2. [ТЫ] Создать проект Supabase

1. Зайди на https://supabase.com → **New project**.
2. Придумай и **сохрани пароль базы данных**.
3. Дождись, пока проект создастся (~2 минуты).
4. Открой **Project Settings → API** и скопируй два значения:
   - `Project URL`
   - `anon` / `public` ключ (`anon public`)

## 3. [ТЫ] Применить схему базы данных

1. В Supabase открой **SQL Editor → New query**.
2. Вставь полностью содержимое файла
   [`supabase/migrations/0001_init.sql`](../supabase/migrations/0001_init.sql).
3. Нажми **Run**. Должно выполниться без ошибок.

## 4. [ТЫ] Заполнить переменные окружения

Создай файл `apps/web/.env.local` (шаблон — `apps/web/.env.local.example`):

```
NEXT_PUBLIC_SUPABASE_URL=сюда Project URL
NEXT_PUBLIC_SUPABASE_ANON_KEY=сюда anon public ключ
```

## 5. [ТЫ] Ускорить вход (по желанию)

Чтобы при тесте не подтверждать email каждый раз:
Supabase → **Authentication → Sign In / Providers → Email** →
выключи **Confirm email** → Save.

## 6. Запустить сайт

```bash
pnpm dev
```

Открой http://localhost:3000

## 7. [ТЫ] Стать супер-админом

1. На сайте нажми **Начать** и зарегистрируйся своим email
   (`vffv347@gmail.com`).
2. В Supabase → **SQL Editor** выполни:

   ```sql
   update public.profiles set role = 'superadmin'
   where email = 'vffv347@gmail.com';
   ```

3. Обнови страницу — в шапке появится ссылка **Бэк-офис**.

Готово. Теперь работает: регистрация, личный кабинет, заявки на оплату,
бэк-офис (управление подписками пользователей).

---

## Что понадобится для этапа 2 (Telegram-бот)

Заранее можно подготовить — но это **не нужно** для этапа 1:

- **[ТЫ]** Anthropic API ключ — https://console.anthropic.com → API Keys
  (движок FRIDAY на Claude).
- **[ТЫ]** Аккаунт Railway — https://railway.app (хостинг бота).
- **[ТЫ]** Репозиторий на GitHub (хранение кода).
- Telegram-токен бота у тебя уже есть — его вставит каждый пользователь
  в своём личном кабинете.
