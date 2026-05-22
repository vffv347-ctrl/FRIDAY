// Тарифы F.R.I.D.A.Y — единый источник правды для сайта и бэк-офиса.

export type Engine = "haiku" | "sonnet" | "opus";
export type TariffId = "standard" | "pro" | "ultimaximum";

export type Tariff = {
  id: TariffId;
  name: string;
  engine: Engine;
  engineLabel: string;
  messageLimit: number;
  priceKzt: number;
  priceRub: number;
  tagline: string;
  features: string[];
};

export const ENGINE_LABELS: Record<Engine, string> = {
  haiku: "Claude Haiku 4.5",
  sonnet: "Claude Sonnet 4.6",
  opus: "Claude Opus 4.7",
};

export const TARIFFS: Tariff[] = [
  {
    id: "standard",
    name: "Standard",
    engine: "haiku",
    engineLabel: ENGINE_LABELS.haiku,
    messageLimit: 1000,
    priceKzt: 6900,
    priceRub: 1290,
    tagline: "Личный ассистент на каждый день",
    features: [
      "Диалог с памятью",
      "Голосовые сообщения",
      "Напоминания и задачи",
      "Учёт энергии",
      "Свои команды",
      "Авто-брифинги 8:00 и 21:00",
      "Оценка присланных картинок",
      "Чтение документов PDF, DOCX, XLSX",
      "1 000 сообщений в месяц",
    ],
  },
  {
    id: "pro",
    name: "Pro",
    engine: "sonnet",
    engineLabel: ENGINE_LABELS.sonnet,
    messageLimit: 1500,
    priceKzt: 28900,
    priceRub: 5290,
    tagline: "Полный набор для работы",
    features: [
      "Всё из Standard",
      "Генерация картинок",
      "Поиск в интернете",
      "Создание файлов PDF, DOCX, XLSX",
      "Движок умнее — Claude Sonnet 4.6",
      "1 500 сообщений в месяц",
    ],
  },
  {
    id: "ultimaximum",
    name: "Ultimaximum",
    engine: "opus",
    engineLabel: ENGINE_LABELS.opus,
    messageLimit: 3000,
    priceKzt: 91000,
    priceRub: 16900,
    tagline: "Максимум возможностей и мощности",
    features: [
      "Всё из Pro",
      "Самый мощный движок — Claude Opus 4.7",
      "Генерация картинок 150 в месяц",
      "Приоритетная обработка",
      "3 000 сообщений в месяц",
    ],
  },
];

export function getTariff(id: string): Tariff | undefined {
  return TARIFFS.find((t) => t.id === id);
}

export function formatKzt(value: number): string {
  return `${value.toLocaleString("ru-RU")} ₸`;
}

export function formatRub(value: number): string {
  return `${value.toLocaleString("ru-RU")} ₽`;
}
