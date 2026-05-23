-- Расширяем engine: добавляем гибридный режим (Sonnet по умолчанию,
-- Opus автоматически по триггерам владельца типа «думай хорошо»).
-- Это то же поведение, что у superadmin'а из env, теперь доступно
-- админу для активации любому пользователю.

do $$
declare
  c record;
begin
  for c in
    select conname from pg_constraint
    where conrelid = 'public.subscriptions'::regclass
      and contype = 'c'
      and pg_get_constraintdef(oid) ilike '%engine%'
  loop
    execute format(
      'alter table public.subscriptions drop constraint %I',
      c.conname
    );
  end loop;
end $$;

alter table public.subscriptions
  add constraint subscriptions_engine_check
  check (engine in ('haiku', 'sonnet', 'opus', 'hybrid'));
