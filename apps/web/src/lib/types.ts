// Типы строк базы данных FRIDAY (см. supabase/migrations).

export type Role = "user" | "admin" | "superadmin";

export type Profile = {
  id: string;
  email: string;
  full_name: string | null;
  role: Role;
  created_at: string;
};

export type SubscriptionStatus = "inactive" | "active" | "expired";

// 'hybrid' — Sonnet по умолчанию + Opus автоматически по триггерам
// владельца («думай хорошо», «на максималке»). То же, что у superadmin.
export type Engine = "haiku" | "sonnet" | "opus" | "hybrid";

export type Subscription = {
  id: string;
  user_id: string;
  plan: string;
  status: SubscriptionStatus;
  engine: Engine;
  message_limit: number;
  starts_at: string | null;
  expires_at: string | null;
  activated_by: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
};

export type BotStatus = "disconnected" | "connected" | "error";

export type Bot = {
  id: string;
  user_id: string;
  telegram_bot_token: string | null;
  bot_username: string | null;
  owner_telegram_id: number | null;
  status: BotStatus;
  created_at: string;
  updated_at: string;
};

export type PaymentStatus = "pending" | "confirmed" | "rejected";

export type Payment = {
  id: string;
  user_id: string;
  amount: number;
  currency: string;
  method: string | null;
  period_days: number;
  status: PaymentStatus;
  confirmed_by: string | null;
  created_at: string;
};
