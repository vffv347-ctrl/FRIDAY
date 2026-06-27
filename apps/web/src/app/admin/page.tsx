import { createClient } from "@/lib/supabase/server";
import { TARIFFS } from "@/lib/tariffs";
import {
  grantSubscription,
  setEngineLimit,
  revokeSubscription,
  confirmPayment,
  rejectPayment,
} from "./actions";

export const dynamic = "force-dynamic";

const ENGINE_SHORT: Record<string, string> = {
  haiku: "Haiku",
  sonnet: "Sonnet",
  opus: "Opus",
  hybrid: "Гибрид",
};

function fmtDate(s: string | null): string {
  if (!s) return "—";
  return new Date(s).toLocaleDateString("ru-RU", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

function daysLeft(expires: string | null): number | null {
  if (!expires) return null;
  return Math.ceil((new Date(expires).getTime() - Date.now()) / 86_400_000);
}

type Sub = {
  status: string;
  expires_at: string | null;
  plan: string;
  engine: string;
  message_limit: number;
};

function isActiveSub(sub: Sub | undefined) {
  if (!sub || sub.status !== "active") return false;
  if (!sub.expires_at) return true;
  return new Date(sub.expires_at).getTime() > Date.now();
}

type UserRow = {
  id: string;
  email: string;
  full_name: string | null;
  role: string;
  created_at: string;
  subscriptions: Sub[];
  bots: { status: string; owner_telegram_id: number | null }[];
};

type PendingPayment = {
  id: string;
  amount: number;
  currency: string;
  period_days: number;
  method: string | null;
  created_at: string;
  profiles: { email: string; full_name: string | null } | null;
};

export default async function AdminPage({
  searchParams,
}: {
  searchParams: Promise<{ message?: string; error?: string }>;
}) {
  const sp = await searchParams;
  const supabase = await createClient();

  // subscriptions и payments оба ссылаются на profiles дважды (user_id и
  // activated_by/confirmed_by). На неоднозначном embed PostgREST возвращает
  // ошибку, и пользователи пропадают. Явно указываем нужный FK по user_id.
  const { data: usersData, error: usersError } = await supabase
    .from("profiles")
    .select(
      "id, email, full_name, role, created_at, subscriptions!subscriptions_user_id_fkey(status, expires_at, plan, engine, message_limit), bots!bots_user_id_fkey(status, owner_telegram_id)",
    )
    .order("created_at", { ascending: true });
  if (usersError) console.error("admin: profiles query error:", usersError);

  const { data: paymentsData, error: paymentsError } = await supabase
    .from("payments")
    .select(
      "id, amount, currency, period_days, method, created_at, profiles!payments_user_id_fkey(email, full_name)",
    )
    .eq("status", "pending")
    .order("created_at", { ascending: true });
  if (paymentsError)
    console.error("admin: payments query error:", paymentsError);

  const users = (usersData ?? []) as UserRow[];
  const pending = (paymentsData ?? []) as unknown as PendingPayment[];
  const activeCount = users.filter((u) =>
    isActiveSub(u.subscriptions?.[0]),
  ).length;

  const inputCls =
    "rounded-lg bg-night border border-line px-2.5 py-2 text-sm outline-none focus:border-glow";
  const primaryBtn =
    "rounded-lg bg-glow text-night font-medium px-3 py-2 text-sm hover:opacity-90 transition-opacity";
  const ghostBtn =
    "rounded-lg border border-line px-3 py-2 text-sm text-dim hover:text-fg transition-colors";
  const pill =
    "text-xs px-2.5 py-1 rounded-full border whitespace-nowrap inline-flex items-center gap-1";

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Бэк-офис</h1>
        <p className="text-dim text-sm mt-1">
          Пользователи, тарифы, оплаты. Активируй тариф под то, что человек
          оплатил.
        </p>
      </div>

      {/* Сообщения после действий */}
      {sp.message && (
        <div className="rounded-lg border border-emerald-500/40 bg-emerald-500/10 text-emerald-200 px-4 py-3 text-sm">
          {sp.message}
        </div>
      )}
      {sp.error && (
        <div className="rounded-lg border border-red-500/40 bg-red-500/10 text-red-200 px-4 py-3 text-sm">
          {sp.error}
        </div>
      )}

      {/* Статистика */}
      <div className="grid grid-cols-3 gap-4">
        {[
          { label: "Пользователей", value: users.length },
          { label: "Активных подписок", value: activeCount },
          { label: "Заявок на оплату", value: pending.length },
        ].map((s) => (
          <div
            key={s.label}
            className="bg-panel border border-line rounded-2xl p-5"
          >
            <div className="text-2xl font-semibold">{s.value}</div>
            <div className="text-xs text-dim mt-1">{s.label}</div>
          </div>
        ))}
      </div>

      {/* Заявки на оплату */}
      {pending.length > 0 && (
        <section className="bg-panel border border-line rounded-2xl p-6">
          <h2 className="font-medium">Заявки на оплату</h2>
          <ul className="mt-4 space-y-3">
            {pending.map((p) => (
              <li
                key={p.id}
                className="border border-line rounded-xl p-4 flex flex-wrap items-center justify-between gap-3"
              >
                <div className="text-sm">
                  <div className="font-medium">
                    {p.profiles?.full_name || p.profiles?.email || "—"}
                  </div>
                  <div className="text-dim">
                    {p.amount} {p.currency} · {p.period_days} дн.
                    {p.method ? ` · ${p.method}` : ""} ·{" "}
                    {fmtDate(p.created_at)}
                  </div>
                </div>
                <div className="flex gap-2">
                  <form action={confirmPayment}>
                    <input type="hidden" name="payment_id" value={p.id} />
                    <button type="submit" className={primaryBtn}>
                      Подтвердить
                    </button>
                  </form>
                  <form action={rejectPayment}>
                    <input type="hidden" name="payment_id" value={p.id} />
                    <button type="submit" className={ghostBtn}>
                      Отклонить
                    </button>
                  </form>
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* Пользователи */}
      <section className="bg-panel border border-line rounded-2xl p-6">
        <h2 className="font-medium">Пользователи</h2>
        <ul className="mt-4 space-y-3">
          {users.map((u) => {
            const sub = u.subscriptions?.[0];
            const active = isActiveSub(sub);
            const bot = u.bots?.[0];
            const left = active ? daysLeft(sub?.expires_at ?? null) : null;

            return (
              <li
                key={u.id}
                className={
                  "border rounded-xl p-4 " +
                  (active ? "border-emerald-500/30" : "border-line")
                }
              >
                {/* Заголовок: имя/email + статусные плашки */}
                <div className="flex flex-wrap items-center gap-2">
                  <div className="font-medium">{u.full_name || u.email}</div>
                  {u.role !== "user" && (
                    <span
                      className={
                        pill +
                        " border-iris/40 bg-iris/10 text-iris uppercase tracking-wider"
                      }
                    >
                      {u.role}
                    </span>
                  )}
                  <span
                    className={
                      pill +
                      " " +
                      (active
                        ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-200"
                        : "border-amber-500/40 bg-amber-500/10 text-amber-200")
                    }
                  >
                    <span className="text-base leading-none">●</span>
                    {active ? "подписка активна" : "подписка не активна"}
                  </span>
                  {sub && (
                    <span
                      className={
                        pill +
                        " border-glow/40 bg-glow/10 text-glow"
                      }
                    >
                      движок: {ENGINE_SHORT[sub.engine] ?? sub.engine}
                    </span>
                  )}
                  <span
                    className={
                      pill +
                      " " +
                      (bot?.status === "connected"
                        ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-200"
                        : "border-line bg-night text-dim")
                    }
                  >
                    бот:{" "}
                    {bot?.status === "connected"
                      ? "подключён"
                      : "не подключён"}
                  </span>
                </div>

                <div className="text-dim text-xs mt-1">
                  {u.email}
                  {active && sub?.expires_at && (
                    <>
                      {" · "}до {fmtDate(sub.expires_at)}
                      {left !== null && ` (${left} дн.)`}
                    </>
                  )}
                  {sub && ` · тариф: ${sub.plan}`}
                  {sub && ` · лимит: ${sub.message_limit}/мес`}
                  {bot?.owner_telegram_id && ` · tg id ${bot.owner_telegram_id}`}
                </div>

                {/* Активация тарифа */}
                <form
                  action={grantSubscription}
                  className="mt-3 flex flex-wrap items-center gap-2"
                >
                  <input type="hidden" name="user_id" value={u.id} />
                  <span className="text-xs text-dim">Тариф:</span>
                  <select
                    name="tariff"
                    defaultValue="standard"
                    className={inputCls}
                  >
                    {TARIFFS.map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.name}
                      </option>
                    ))}
                  </select>
                  <select name="days" defaultValue="30" className={inputCls}>
                    <option value="30">1 месяц</option>
                    <option value="90">3 месяца</option>
                    <option value="180">6 месяцев</option>
                    <option value="365">1 год</option>
                  </select>
                  <button type="submit" className={primaryBtn}>
                    Активировать
                  </button>
                </form>

                {/* Ручная настройка движка и лимита */}
                <form
                  action={setEngineLimit}
                  className="mt-2 flex flex-wrap items-center gap-2"
                >
                  <input type="hidden" name="user_id" value={u.id} />
                  <span className="text-xs text-dim">Вручную:</span>
                  <select
                    name="engine"
                    defaultValue={sub?.engine ?? "haiku"}
                    className={inputCls}
                  >
                    <option value="haiku">Haiku — слабый, экономный</option>
                    <option value="sonnet">Sonnet — средний</option>
                    <option value="opus">Opus — сильный</option>
                    <option value="hybrid">Гибрид — Sonnet + Opus по триггеру</option>
                  </select>
                  <input
                    name="message_limit"
                    type="number"
                    min="1"
                    defaultValue={sub?.message_limit ?? 1000}
                    className={inputCls + " w-28"}
                  />
                  <button type="submit" className={ghostBtn}>
                    Сохранить
                  </button>
                  {active && (
                    <button
                      type="submit"
                      formAction={revokeSubscription}
                      className={ghostBtn + " text-amber-300/80 hover:text-amber-200"}
                    >
                      Отключить
                    </button>
                  )}
                </form>
              </li>
            );
          })}
        </ul>
      </section>
    </div>
  );
}
