"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getTariff } from "@/lib/tariffs";

type ServerClient = Awaited<ReturnType<typeof createClient>>;

const ENGINE_LABELS: Record<string, string> = {
  haiku: "Haiku",
  sonnet: "Sonnet",
  opus: "Opus",
  hybrid: "Гибрид (Sonnet + Opus по триггеру)",
};

function toAdminWithMessage(message: string): never {
  redirect("/admin?message=" + encodeURIComponent(message));
}

function toAdminWithError(error: string): never {
  redirect("/admin?error=" + encodeURIComponent(error));
}

// Проверяет, что текущий пользователь — администратор.
async function requireAdmin(): Promise<{
  supabase: ServerClient;
  adminId: string;
}> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: me } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .single();

  if (!me || (me.role !== "admin" && me.role !== "superadmin")) {
    redirect("/dashboard");
  }
  return { supabase, adminId: user.id };
}

async function userLabel(
  supabase: ServerClient,
  userId: string,
): Promise<string> {
  const { data } = await supabase
    .from("profiles")
    .select("email, full_name")
    .eq("id", userId)
    .maybeSingle();
  return data?.full_name || data?.email || "пользователь";
}

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleDateString("ru-RU", {
    day: "2-digit",
    month: "long",
    year: "numeric",
  });
}

// Активирует / продлевает подписку с выбранным тарифом.
// Если подписка ещё действует — продлевает от даты окончания.
async function applyGrant(
  supabase: ServerClient,
  adminId: string,
  userId: string,
  days: number,
  tariffId: string,
): Promise<{ engine: string; expires: string }> {
  const { data: existing } = await supabase
    .from("subscriptions")
    .select("*")
    .eq("user_id", userId)
    .maybeSingle();

  const tariff = getTariff(tariffId);
  const now = new Date();
  let base = now;
  if (existing?.expires_at) {
    const exp = new Date(existing.expires_at);
    if (exp > now) base = exp;
  }
  const expires = new Date(base.getTime() + days * 86_400_000);
  const engine = tariff?.engine ?? existing?.engine ?? "haiku";

  const payload = {
    user_id: userId,
    plan: tariffId,
    engine,
    message_limit: tariff?.messageLimit ?? existing?.message_limit ?? 1000,
    status: "active" as const,
    starts_at: existing?.starts_at ?? now.toISOString(),
    expires_at: expires.toISOString(),
    activated_by: adminId,
    updated_at: now.toISOString(),
  };

  if (existing) {
    await supabase.from("subscriptions").update(payload).eq("id", existing.id);
  } else {
    await supabase.from("subscriptions").insert(payload);
  }

  await supabase.from("audit_log").insert({
    actor_id: adminId,
    action: "grant_subscription",
    target_user_id: userId,
    details: { days, tariff: tariffId, expires_at: expires.toISOString() },
  });

  return { engine, expires: expires.toISOString() };
}

// Включить тариф пользователю на срок.
export async function grantSubscription(formData: FormData) {
  const { supabase, adminId } = await requireAdmin();
  const userId = String(formData.get("user_id") ?? "");
  const days = Number(formData.get("days") ?? 30);
  const tariff = String(formData.get("tariff") ?? "standard") || "standard";
  if (!userId || !days) return toAdminWithError("Не указан пользователь или срок.");

  const result = await applyGrant(supabase, adminId, userId, days, tariff);
  const tariffInfo = getTariff(tariff);
  const who = await userLabel(supabase, userId);

  return toAdminWithMessage(
    `✅ ${who}: тариф ${tariffInfo?.name ?? tariff} активирован до ${fmtDate(result.expires)} (движок ${ENGINE_LABELS[result.engine] ?? result.engine}). Бот применит через ~30 секунд.`,
  );
}

// Ручная настройка: движок и лимит сообщений (без привязки к тарифу).
export async function setEngineLimit(formData: FormData) {
  const { supabase, adminId } = await requireAdmin();
  const userId = String(formData.get("user_id") ?? "");
  const engine = String(formData.get("engine") ?? "");
  const limit = Number(formData.get("message_limit") ?? 0);
  if (
    !userId ||
    !["haiku", "sonnet", "opus", "hybrid"].includes(engine) ||
    limit <= 0
  ) {
    return toAdminWithError("Проверь движок и лимит сообщений.");
  }

  const { error } = await supabase
    .from("subscriptions")
    .update({
      plan: "custom",
      engine,
      message_limit: limit,
      updated_at: new Date().toISOString(),
    })
    .eq("user_id", userId);

  if (error) {
    console.error("setEngineLimit error:", error);
    return toAdminWithError(
      `Не удалось сохранить движок: ${error.message}. Возможно, миграция 0005_hybrid_engine.sql ещё не применена в Supabase.`,
    );
  }

  await supabase.from("audit_log").insert({
    actor_id: adminId,
    action: "set_engine_limit",
    target_user_id: userId,
    details: { engine, message_limit: limit },
  });

  const who = await userLabel(supabase, userId);
  return toAdminWithMessage(
    `✅ ${who}: движок переключён на ${ENGINE_LABELS[engine] ?? engine}, лимит ${limit}/мес. Бот применит через ~30 секунд.`,
  );
}

export async function revokeSubscription(formData: FormData) {
  const { supabase, adminId } = await requireAdmin();
  const userId = String(formData.get("user_id") ?? "");
  if (!userId) return toAdminWithError("Не указан пользователь.");

  await supabase
    .from("subscriptions")
    .update({ status: "inactive", updated_at: new Date().toISOString() })
    .eq("user_id", userId);

  await supabase.from("audit_log").insert({
    actor_id: adminId,
    action: "revoke_subscription",
    target_user_id: userId,
  });

  const who = await userLabel(supabase, userId);
  return toAdminWithMessage(
    `🛑 ${who}: подписка отключена. Бот перестанет отвечать через ~30 секунд.`,
  );
}

export async function confirmPayment(formData: FormData) {
  const { supabase, adminId } = await requireAdmin();
  const paymentId = String(formData.get("payment_id") ?? "");
  if (!paymentId) return toAdminWithError("Не указан id заявки.");

  const { data: payment } = await supabase
    .from("payments")
    .select("*")
    .eq("id", paymentId)
    .single();
  if (!payment) return toAdminWithError("Заявка не найдена.");

  await supabase
    .from("payments")
    .update({ status: "confirmed", confirmed_by: adminId })
    .eq("id", paymentId);

  // В payment.method хранится id выбранного тарифа.
  const tariffId = ["standard", "pro", "ultimaximum"].includes(payment.method)
    ? payment.method
    : "standard";
  const result = await applyGrant(
    supabase,
    adminId,
    payment.user_id,
    payment.period_days,
    tariffId,
  );

  const tariffInfo = getTariff(tariffId);
  const who = await userLabel(supabase, payment.user_id);
  return toAdminWithMessage(
    `✅ Оплата подтверждена. ${who}: тариф ${tariffInfo?.name ?? tariffId} активен до ${fmtDate(result.expires)} (движок ${ENGINE_LABELS[result.engine] ?? result.engine}).`,
  );
}

export async function rejectPayment(formData: FormData) {
  const { supabase, adminId } = await requireAdmin();
  const paymentId = String(formData.get("payment_id") ?? "");
  if (!paymentId) return toAdminWithError("Не указан id заявки.");

  await supabase
    .from("payments")
    .update({ status: "rejected", confirmed_by: adminId })
    .eq("id", paymentId);

  return toAdminWithMessage("Заявка отклонена.");
}
