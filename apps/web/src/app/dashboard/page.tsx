import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { connectBot, reportPayment } from "./actions";
import type { Subscription, Bot, Payment } from "@/lib/types";
import { TARIFFS, getTariff, formatRub, formatKzt } from "@/lib/tariffs";

export const dynamic = "force-dynamic";

function daysLeft(expires: string | null): number | null {
  if (!expires) return null;
  return Math.ceil((new Date(expires).getTime() - Date.now()) / 86_400_000);
}

function fmtDate(s: string | null): string {
  if (!s) return "—";
  return new Date(s).toLocaleDateString("ru-RU", {
    day: "2-digit",
    month: "long",
    year: "numeric",
  });
}

const paymentStatusLabel: Record<Payment["status"], string> = {
  pending: "На проверке",
  confirmed: "Подтверждена",
  rejected: "Отклонена",
};

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; message?: string }>;
}) {
  const sp = await searchParams;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: profile } = await supabase
    .from("profiles")
    .select("full_name")
    .eq("id", user.id)
    .single();
  const { data: subRow } = await supabase
    .from("subscriptions")
    .select("*")
    .eq("user_id", user.id)
    .maybeSingle();
  const { data: botRow } = await supabase
    .from("bots")
    .select("*")
    .eq("user_id", user.id)
    .maybeSingle();
  const { data: paymentRows } = await supabase
    .from("payments")
    .select("*")
    .eq("user_id", user.id)
    .order("created_at", { ascending: false })
    .limit(5);

  const sub = subRow as Subscription | null;
  const bot = botRow as Bot | null;
  const payments = (paymentRows ?? []) as Payment[];
  const left = daysLeft(sub?.expires_at ?? null);
  const isActive = sub?.status === "active" && (left === null || left > 0);
  const name = profile?.full_name?.trim() || "";

  const inputCls =
    "w-full rounded-lg bg-night border border-line px-3 py-2.5 text-sm outline-none focus:border-glow";
  const btnCls =
    "rounded-lg bg-glow text-night font-medium px-4 py-2.5 text-sm hover:opacity-90 transition-opacity";

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">
          Привет{name ? `, ${name}` : ""} 👋
        </h1>
        <p className="text-dim text-sm mt-1">
          Личный кабинет управления твоей ассистенткой F.R.I.D.A.Y.
        </p>
      </div>

      {sp.message && (
        <p className="text-sm rounded-lg border border-line bg-panel px-3 py-2 text-glow">
          {sp.message}
        </p>
      )}
      {sp.error && (
        <p className="text-sm rounded-lg border border-red-500/40 bg-red-500/10 px-3 py-2 text-red-300">
          {sp.error}
        </p>
      )}

      {/* Подписка */}
      <section className="bg-panel border border-line rounded-2xl p-6">
        <div className="flex items-center justify-between">
          <h2 className="font-medium">Подписка</h2>
          <span
            className={
              "text-xs px-2.5 py-1 rounded-full border " +
              (isActive
                ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-300"
                : "border-amber-500/40 bg-amber-500/10 text-amber-300")
            }
          >
            {isActive ? "Активна" : "Не активна"}
          </span>
        </div>

        {isActive ? (
          <p className="text-sm text-dim mt-3">
            Тариф:{" "}
            <span className="text-fg">
              {getTariff(sub!.plan)?.name ?? sub!.plan}
            </span>
            {" · до "}
            <span className="text-fg">{fmtDate(sub!.expires_at)}</span>
            {left !== null && (
              <>
                {" "}
                · осталось <span className="text-fg">{left} дн.</span>
              </>
            )}
          </p>
        ) : (
          <p className="text-sm text-dim mt-3 leading-relaxed">
            Чтобы пользоваться FRIDAY, оформи подписку: переведи оплату по
            реквизитам администратора, затем отправь заявку ниже — администратор
            подтвердит её и активирует доступ.
          </p>
        )}
      </section>

      {/* Тарифы */}
      <section className="bg-panel border border-line rounded-2xl p-6">
        <h2 className="font-medium">
          {isActive ? "Сменить тариф" : "Выбрать тариф"}
        </h2>
        <p className="text-sm text-dim mt-1 leading-relaxed">
          Выбери тариф и срок, переведи оплату по реквизитам администратора и
          нажми «Оформить». Администратор подтвердит оплату и активирует тариф.
        </p>

        <div className="mt-4 grid md:grid-cols-3 gap-3">
          {TARIFFS.map((t) => (
            <div
              key={t.id}
              className="border border-line rounded-xl p-4 flex flex-col"
            >
              <h3 className="font-semibold">{t.name}</h3>
              <div className="mt-1">
                <span className="text-lg font-semibold">
                  {formatRub(t.priceRub)}
                </span>
                <span className="text-xs text-dim"> / мес</span>
              </div>
              <div className="text-xs text-dim">
                {formatKzt(t.priceKzt)} / мес
              </div>
              <div className="text-xs text-glow mt-2">{t.engineLabel}</div>
              <ul className="mt-3 space-y-1 flex-1">
                {t.features.map((f) => (
                  <li
                    key={f}
                    className="text-xs text-dim flex gap-1.5 leading-snug"
                  >
                    <span className="text-glow shrink-0">✓</span>
                    <span>{f}</span>
                  </li>
                ))}
              </ul>
              <form action={reportPayment} className="mt-4 space-y-2">
                <input type="hidden" name="tariff" value={t.id} />
                <select name="months" defaultValue="1" className={inputCls}>
                  <option value="1">1 месяц</option>
                  <option value="3">3 месяца</option>
                  <option value="6">6 месяцев</option>
                  <option value="12">12 месяцев</option>
                </select>
                <button type="submit" className={btnCls + " w-full"}>
                  Оформить {t.name}
                </button>
              </form>
            </div>
          ))}
        </div>

        {payments.length > 0 && (
          <div className="mt-5 border-t border-line pt-4">
            <h3 className="text-sm text-dim mb-2">История заявок</h3>
            <ul className="space-y-1.5">
              {payments.map((p) => (
                <li
                  key={p.id}
                  className="text-sm flex items-center justify-between"
                >
                  <span>
                    {getTariff(p.method ?? "")?.name ?? "Тариф"} ·{" "}
                    {p.period_days} дн.
                  </span>
                  <span className="text-dim">
                    {paymentStatusLabel[p.status]}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </section>

      {/* Telegram-бот */}
      <section className="bg-panel border border-line rounded-2xl p-6">
        <div className="flex items-center justify-between">
          <h2 className="font-medium">Telegram-бот</h2>
          <span
            className={
              "text-xs px-2.5 py-1 rounded-full border " +
              (bot?.status === "connected"
                ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-300"
                : "border-line bg-night text-dim")
            }
          >
            {bot?.status === "connected" ? "Подключён" : "Не подключён"}
          </span>
        </div>
        <p className="text-sm text-dim mt-1 leading-relaxed">
          Создай бота у{" "}
          <span className="text-fg">@BotFather</span> и вставь его токен. Свой
          Telegram ID узнай у бота{" "}
          <span className="text-fg">@userinfobot</span> — бот будет отвечать{" "}
          <span className="text-glow">только тебе</span> по этому ID.
        </p>

        <form action={connectBot} className="mt-4 space-y-3">
          <div>
            <label className="text-xs text-dim">Токен бота</label>
            <input
              name="token"
              type="password"
              defaultValue={bot?.telegram_bot_token ?? ""}
              placeholder="123456789:AA..."
              className={inputCls + " mt-1"}
            />
          </div>
          <div className="grid sm:grid-cols-2 gap-3">
            <div>
              <label className="text-xs text-dim">Имя бота (@username)</label>
              <input
                name="bot_username"
                type="text"
                defaultValue={bot?.bot_username ?? ""}
                placeholder="my_friday_bot"
                className={inputCls + " mt-1"}
              />
            </div>
            <div>
              <label className="text-xs text-dim">Твой Telegram ID</label>
              <input
                name="owner_telegram_id"
                type="text"
                inputMode="numeric"
                defaultValue={bot?.owner_telegram_id?.toString() ?? ""}
                placeholder="123456789"
                className={inputCls + " mt-1"}
              />
            </div>
          </div>
          <button type="submit" className={btnCls}>
            Сохранить
          </button>
        </form>
        <p className="text-xs text-dim mt-3">
          Сам бот заработает на этапе 2 — сейчас сохраняются настройки
          подключения.
        </p>
      </section>
    </div>
  );
}
