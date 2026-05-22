-- ════════════════════════════════════════════════════════════════
--  F.R.I.D.A.Y — память бота: история диалога + факты о владельце
--  Применять в Supabase: SQL Editor → вставить → Run
-- ════════════════════════════════════════════════════════════════

-- ── История диалога ─────────────────────────────────────────────
create table if not exists public.bot_messages (
  id         bigint generated always as identity primary key,
  owner_id   bigint not null,            -- Telegram ID владельца
  role       text not null check (role in ('user', 'assistant')),
  content    text not null,
  created_at timestamptz not null default now()
);

create index if not exists bot_messages_owner_idx
  on public.bot_messages (owner_id, created_at);

-- ── Долговременная память (факты о владельце) ───────────────────
create table if not exists public.bot_memory (
  id         bigint generated always as identity primary key,
  owner_id   bigint not null,
  fact       text not null,
  created_at timestamptz not null default now()
);

create index if not exists bot_memory_owner_idx
  on public.bot_memory (owner_id, created_at);

-- ── Безопасность ────────────────────────────────────────────────
-- RLS включён, политик нет → публичные ключи не видят эти таблицы.
-- Бот работает секретным ключом, который RLS обходит.
alter table public.bot_messages enable row level security;
alter table public.bot_memory   enable row level security;
