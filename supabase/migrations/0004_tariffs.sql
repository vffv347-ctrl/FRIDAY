-- ════════════════════════════════════════════════════════════════
--  F.R.I.D.A.Y — тарифы: движок и лимит сообщений на подписке.
--  Применять в Supabase: SQL Editor → вставить → Run
-- ════════════════════════════════════════════════════════════════

-- Движок (мозг) — модель Claude, выданная пользователю.
alter table public.subscriptions
  add column if not exists engine text not null default 'haiku'
    check (engine in ('haiku', 'sonnet', 'opus'));

-- Лимит сообщений в месяц.
alter table public.subscriptions
  add column if not exists message_limit integer not null default 1000;

-- Колонка plan хранит id тарифа: standard / pro / ultimaximum / custom.
