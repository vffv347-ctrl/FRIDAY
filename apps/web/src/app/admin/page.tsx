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
};

function fmtDate(s: string | null): string {
  if (!s) return "—";
  return new Date(s).toLocaleDateString("ru-RU", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
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

export default async function AdminPage() {
  const supabase = await createClient();

  const { data: usersData } = await supabase
    .from("profiles")
    .select(
      "id, email, full_name, role, created_at, subscriptions(status, expires_at, plan, engine, message_limit), bots(status, owner_telegram_id)",
    )
    .order("created_at", { ascending: true });

  const { data: paymentsData } = await supabase
    .from("payments")
    .select(
      "id, amount, currency, period_days, method, created_at, profiles(email, full_name)",
    )
    .eq("status", "pending")
    .order("created_at", { ascending: true });

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

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Бэк-офис</h1>
        <p className="text-dim text-sm mt-1">
          Пользователи, тарифы, оплаты. Активируй тариф под то, что человек
          оплатил.
        </p>
      </div>

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
                    {p.method ? ` · ${p.method}` : ""} · {fmtDate(p.created_at)}
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
            return (
              <li key={u.id} className="border border-line rounded-xl p-4">
                <div className="text-sm">
                  <div className="font-medium flex items-center gap-2">
                    {u.full_name || u.email}
                    {u.role !== "user" && (
                      <span className="text-[10px] uppercase tracking-wider text-iris border border-line rounded px-1.5 py-0.5">
                        {u.role}
                      </span>
                    )}
                  </div>
                  <div className="text-dim">{u.email}</div>
                  <div className="text-dim mt-1">
                    Подписка:{" "}
                    <span
                      className={active ? "text-emerald-300" : "text-amber-300"}
                    >
                      {active ? "активна" : "не активна"}
                    </span>
                    {sub?.expires_at && ` · до ${fmtDate(sub.expires_at)}`}
                    {sub && ` · тариф: ${sub.plan}`}
                    {sub && ` · движок: ${ENGINE_SHORT[sub.engine] ?? sub.engine}`}
                    {sub && ` · лимит: ${sub.message_limit}/мес`}
                    {` · бот: ${bot?.status === "connected" ? "да" : "нет"}`}
                  </div>
                </div>

                {/* Активация тарифа */}
                <form
                  action={grantSubscription}
                  className="mt-3 flex flex-wrap items-center gap-2"
                >
                  <input type="hidden" name="user_id" value={u.id} />
                  <span className="text-xs text-dim">Тариф:</span>
                  <select name="tariff" defaultValue="standard" className={inputCls}>
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
                    <option value="haiku">Haiku</option>
                    <option value="sonnet">Sonnet</option>
                    <option value="opus">Opus</option>
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
                      className={ghostBtn}
                    >
                      Отключить подписку
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
