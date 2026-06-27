"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getTariff } from "@/lib/tariffs";

// Подключение / обновление Telegram-бота пользователя.
export async function connectBot(formData: FormData) {
  const token = String(formData.get("token") ?? "").trim();
  const ownerTelegramIdRaw = String(
    formData.get("owner_telegram_id") ?? "",
  ).trim();
  const botUsername = String(formData.get("bot_username") ?? "").trim();

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const ownerTelegramId = ownerTelegramIdRaw
    ? Number(ownerTelegramIdRaw)
    : null;

  if (ownerTelegramIdRaw && Number.isNaN(ownerTelegramId)) {
    redirect(
      "/dashboard?error=" +
        encodeURIComponent("Telegram ID должен быть числом"),
    );
  }

  const connected = Boolean(token && ownerTelegramId);

  await supabase.from("bots").upsert(
    {
      user_id: user.id,
      telegram_bot_token: token || null,
      bot_username: botUsername || null,
      owner_telegram_id: ownerTelegramId,
      status: connected ? "connected" : "disconnected",
      updated_at: new Date().toISOString(),
    },
    { onConflict: "user_id" },
  );

  revalidatePath("/dashboard");
  redirect(
    "/dashboard?message=" +
      encodeURIComponent(
        connected
          ? `✅ Бот${botUsername ? ` @${botUsername.replace(/^@/, "")}` : ""} подключён. F.R.I.D.A.Y. поднимет его в течение ~30 секунд — открой бота в Telegram и напиши «привет», чтобы проверить.`
          : "Настройки сохранены. Для подключения боту нужны и токен от @BotFather, и твой Telegram ID (узнать в @userinfobot).",
      ),
  );
}

// Заявка пользователя на тариф (подтверждает администратор).
export async function reportPayment(formData: FormData) {
  const tariffId = String(formData.get("tariff") ?? "");
  const months = Math.max(1, Number(formData.get("months") ?? 1));
  const tariff = getTariff(tariffId);

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  if (!tariff) {
    redirect("/dashboard?error=" + encodeURIComponent("Выбери тариф"));
  }

  await supabase.from("payments").insert({
    user_id: user.id,
    amount: tariff.priceRub * months,
    currency: "RUB",
    method: tariff.id, // здесь хранится id выбранного тарифа
    period_days: months * 30,
    status: "pending",
  });

  revalidatePath("/dashboard");
  redirect(
    "/dashboard?message=" +
      encodeURIComponent(
        `Заявка на тариф ${tariff.name} отправлена. Администратор активирует его после подтверждения оплаты.`,
      ),
  );
}
