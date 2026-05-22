import "dotenv/config";

export type Config = {
  telegramToken: string;
  anthropicApiKey: string;
  openaiApiKey: string; // может быть пустым — тогда распознавание голоса отключено
  supabaseUrl: string;
  supabaseSecretKey: string;
  ownerTelegramId: number;
};

function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    console.error(
      `✗ Не задана переменная окружения ${name}. Заполни файл apps/bot/.env`,
    );
    process.exit(1);
  }
  return value;
}

export function loadConfig(): Config {
  const ownerIdRaw = required("OWNER_TELEGRAM_ID");
  const ownerTelegramId = Number(ownerIdRaw);

  if (!Number.isInteger(ownerTelegramId) || ownerTelegramId <= 0) {
    console.error(
      `✗ OWNER_TELEGRAM_ID должен быть положительным числом, получено: ${ownerIdRaw}`,
    );
    process.exit(1);
  }

  return {
    telegramToken: required("TELEGRAM_BOT_TOKEN"),
    anthropicApiKey: required("ANTHROPIC_API_KEY"),
    openaiApiKey: process.env.OPENAI_API_KEY ?? "",
    supabaseUrl: required("SUPABASE_URL"),
    supabaseSecretKey: required("SUPABASE_SECRET_KEY"),
    ownerTelegramId,
  };
}
