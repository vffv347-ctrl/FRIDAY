-- ════════════════════════════════════════════════════════════════
--  F.R.I.D.A.Y — начальная схема базы данных
--  Применять в Supabase: Dashboard → SQL Editor → вставить → Run
-- ════════════════════════════════════════════════════════════════

-- ── Профили (расширение auth.users) ─────────────────────────────
create table if not exists public.profiles (
  id         uuid primary key references auth.users (id) on delete cascade,
  email      text not null,
  full_name  text,
  role       text not null default 'user'
             check (role in ('user', 'admin', 'superadmin')),
  created_at timestamptz not null default now()
);

-- ── Подписки (одна на пользователя) ─────────────────────────────
create table if not exists public.subscriptions (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references public.profiles (id) on delete cascade,
  plan         text not null default 'standard',
  status       text not null default 'inactive'
               check (status in ('inactive', 'active', 'expired')),
  starts_at    timestamptz,
  expires_at   timestamptz,
  activated_by uuid references public.profiles (id),
  notes        text,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  unique (user_id)
);

-- ── Telegram-боты пользователей ─────────────────────────────────
create table if not exists public.bots (
  id                 uuid primary key default gen_random_uuid(),
  user_id            uuid not null references public.profiles (id) on delete cascade,
  telegram_bot_token text,
  bot_username       text,
  -- КРИТИЧНО: бот отвечает ТОЛЬКО этому Telegram ID (см. docs/ARCHITECTURE.md)
  owner_telegram_id  bigint,
  status             text not null default 'disconnected'
                     check (status in ('disconnected', 'connected', 'error')),
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  unique (user_id)
);

-- ── Оплаты (подтверждаются администратором вручную) ─────────────
create table if not exists public.payments (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references public.profiles (id) on delete cascade,
  amount       numeric(12, 2) not null,
  currency     text not null default 'RUB',
  method       text,
  period_days  integer not null default 30,
  status       text not null default 'pending'
               check (status in ('pending', 'confirmed', 'rejected')),
  confirmed_by uuid references public.profiles (id),
  created_at   timestamptz not null default now()
);

-- ── Журнал действий бэк-офиса ───────────────────────────────────
create table if not exists public.audit_log (
  id             uuid primary key default gen_random_uuid(),
  actor_id       uuid references public.profiles (id),
  action         text not null,
  target_user_id uuid references public.profiles (id),
  details        jsonb,
  created_at     timestamptz not null default now()
);

-- ════════════════════════════════════════════════════════════════
--  Функции и триггеры
-- ════════════════════════════════════════════════════════════════

-- Автосоздание профиля при регистрации пользователя.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, email, full_name)
  values (
    new.id,
    new.email,
    nullif(new.raw_user_meta_data ->> 'full_name', '')
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Проверка: текущий пользователь — администратор.
create or replace function public.is_admin()
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and role in ('admin', 'superadmin')
  );
$$;

-- Защита от самоповышения роли: обычный пользователь не может
-- сменить свою роль — только администратор.
-- Доверенные операции (SQL Editor, service_role) имеют auth.uid() = null
-- и проходят свободно — обычный юзер через сайт всегда имеет auth.uid().
create or replace function public.protect_profile_role()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.role is distinct from old.role
     and auth.uid() is not null
     and not public.is_admin() then
    new.role := old.role;
  end if;
  return new;
end;
$$;

drop trigger if exists protect_profile_role on public.profiles;
create trigger protect_profile_role
  before update on public.profiles
  for each row execute function public.protect_profile_role();

-- ════════════════════════════════════════════════════════════════
--  Row Level Security
-- ════════════════════════════════════════════════════════════════

alter table public.profiles      enable row level security;
alter table public.subscriptions enable row level security;
alter table public.bots          enable row level security;
alter table public.payments      enable row level security;
alter table public.audit_log     enable row level security;

-- profiles
create policy "profiles_select" on public.profiles for select
  using (id = auth.uid() or public.is_admin());
create policy "profiles_update" on public.profiles for update
  using (id = auth.uid() or public.is_admin())
  with check (id = auth.uid() or public.is_admin());

-- subscriptions
create policy "subscriptions_select" on public.subscriptions for select
  using (user_id = auth.uid() or public.is_admin());
create policy "subscriptions_admin_write" on public.subscriptions for all
  using (public.is_admin())
  with check (public.is_admin());

-- bots
create policy "bots_select" on public.bots for select
  using (user_id = auth.uid() or public.is_admin());
create policy "bots_owner_write" on public.bots for all
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- payments
create policy "payments_select" on public.payments for select
  using (user_id = auth.uid() or public.is_admin());
create policy "payments_owner_insert" on public.payments for insert
  with check (user_id = auth.uid());
create policy "payments_admin_update" on public.payments for update
  using (public.is_admin())
  with check (public.is_admin());

-- audit_log
create policy "audit_log_select" on public.audit_log for select
  using (public.is_admin());
create policy "audit_log_insert" on public.audit_log for insert
  with check (public.is_admin());

-- ════════════════════════════════════════════════════════════════
--  После регистрации владельца выполни отдельно (см. docs/SETUP.md):
--    update public.profiles set role = 'superadmin'
--    where email = 'vffv347@gmail.com';
-- ════════════════════════════════════════════════════════════════
