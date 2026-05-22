-- ════════════════════════════════════════════════════════════════
--  F.R.I.D.A.Y — перенос локальных хранилищ в Supabase:
--  напоминания, задачи, энергия, свои команды владельца.
--  Применять в Supabase: SQL Editor → вставить → Run
-- ════════════════════════════════════════════════════════════════

-- ── Напоминания ─────────────────────────────────────────────────
create table if not exists public.bot_reminders (
  id         text primary key,
  owner_id   bigint not null,
  text       text not null,
  fire_at    timestamptz not null,
  created_at timestamptz not null default now()
);
create index if not exists bot_reminders_owner_idx
  on public.bot_reminders (owner_id);
create index if not exists bot_reminders_fire_idx
  on public.bot_reminders (fire_at);

-- ── Задачи ──────────────────────────────────────────────────────
create table if not exists public.bot_tasks (
  id         text primary key,
  owner_id   bigint not null,
  text       text not null,
  done       boolean not null default false,
  created_at timestamptz not null default now(),
  done_at    timestamptz
);
create index if not exists bot_tasks_owner_idx
  on public.bot_tasks (owner_id);

-- ── Учёт энергии ────────────────────────────────────────────────
create table if not exists public.bot_energy (
  id       bigint generated always as identity primary key,
  owner_id bigint not null,
  level    integer not null,
  note     text not null default '',
  at       timestamptz not null default now()
);
create index if not exists bot_energy_owner_idx
  on public.bot_energy (owner_id, at);

-- ── Свои команды владельца ──────────────────────────────────────
create table if not exists public.bot_commands (
  owner_id    bigint not null,
  name        text not null,
  instruction text not null,
  created_at  timestamptz not null default now(),
  primary key (owner_id, name)
);

-- ── Безопасность ────────────────────────────────────────────────
-- RLS включён, политик нет → доступ только секретным ключом (бот).
alter table public.bot_reminders enable row level security;
alter table public.bot_tasks     enable row level security;
alter table public.bot_energy    enable row level security;
alter table public.bot_commands  enable row level security;
