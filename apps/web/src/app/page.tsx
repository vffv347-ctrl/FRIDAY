import Link from "next/link";
import { headers } from "next/headers";
import { Logo } from "@/components/Logo";
import { TARIFFS, formatKzt, formatRub } from "@/lib/tariffs";

const features = [
  {
    icon: "🧠",
    title: "Диалог и советы",
    text: "Пиши или диктуй голосом — FRIDAY ответит, подскажет, поможет принять решение.",
  },
  {
    icon: "📋",
    title: "Задачи и планирование",
    text: "План дня, приоритизация по Эйзенхауэру, отчёты по задачам — всё в Telegram.",
  },
  {
    icon: "🎯",
    title: "Цели и стратегия",
    text: "Декомпозиция больших целей на шаги и генератор идей под твои запросы.",
  },
  {
    icon: "📂",
    title: "Документы",
    text: "Формирует PDF, DOCX, XLSX: счета, регламенты, ТЗ, документы из шаблонов.",
  },
  {
    icon: "🖼️",
    title: "Работа с картинками",
    text: "Генерирует изображения по описанию и оценивает присланные картинки.",
  },
  {
    icon: "🤖",
    title: "Автономность",
    text: "Ставит себе задачи, ищет решения и выдаёт готовый результат без микроменеджмента.",
  },
];

const steps = [
  {
    n: "01",
    title: "Зарегистрируйся",
    text: "Создай аккаунт на сайте — это центр управления твоей ассистенткой.",
  },
  {
    n: "02",
    title: "Оформи подписку",
    text: "Переведи оплату — администратор активирует доступ на оплаченный срок.",
  },
  {
    n: "03",
    title: "Подключи Telegram-бота",
    text: "Укажи токен своего бота и свой Telegram ID — бот «обретает» FRIDAY.",
  },
];

export default async function HomePage() {
  const accept = (await headers()).get("accept-language") ?? "";
  // Казахстан → тенге, иначе → рубли.
  const primary: "kzt" | "rub" = /kk|-kz/i.test(accept) ? "kzt" : "rub";

  return (
    <div className="min-h-screen">
      {/* Шапка */}
      <header className="border-b border-line">
        <div className="max-w-5xl mx-auto px-6 h-16 flex items-center justify-between">
          <Logo className="text-glow text-sm" />
          <nav className="flex items-center gap-3 text-sm">
            <Link
              href="/login"
              className="px-4 py-2 rounded-lg text-dim hover:text-fg transition-colors"
            >
              Войти
            </Link>
            <Link
              href="/register"
              className="px-4 py-2 rounded-lg bg-glow text-night font-medium hover:opacity-90 transition-opacity"
            >
              Начать
            </Link>
          </nav>
        </div>
      </header>

      {/* Hero */}
      <section className="max-w-5xl mx-auto px-6 pt-20 pb-16 text-center">
        <span className="inline-block text-xs tracking-[0.2em] text-glow border border-line rounded-full px-4 py-1.5">
          ПЕРСОНАЛЬНЫЙ ИИ-АССИСТЕНТ
        </span>
        <h1 className="mt-6 text-4xl sm:text-5xl font-semibold leading-tight">
          Познакомься с{" "}
          <span className="bg-gradient-to-r from-glow to-iris bg-clip-text text-transparent">
            F.R.I.D.A.Y
          </span>
        </h1>
        <p className="mt-5 text-dim text-lg max-w-2xl mx-auto leading-relaxed">
          Твоя личная ассистентка. Делегируй ей задачи — она спланирует,
          напомнит, соберёт документы и выдаст готовое решение. Прямо в Telegram.
        </p>
        <div className="mt-8 flex items-center justify-center gap-3">
          <Link
            href="/register"
            className="px-6 py-3 rounded-lg bg-glow text-night font-medium hover:opacity-90 transition-opacity"
          >
            Создать аккаунт
          </Link>
          <Link
            href="/login"
            className="px-6 py-3 rounded-lg border border-line text-fg hover:bg-panel transition-colors"
          >
            У меня уже есть доступ
          </Link>
        </div>
      </section>

      {/* Возможности */}
      <section className="max-w-5xl mx-auto px-6 py-12">
        <h2 className="text-2xl font-semibold text-center">Что она умеет</h2>
        <div className="mt-10 grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {features.map((f) => (
            <div
              key={f.title}
              className="bg-panel border border-line rounded-2xl p-6"
            >
              <div className="text-2xl">{f.icon}</div>
              <h3 className="mt-3 font-medium">{f.title}</h3>
              <p className="mt-2 text-sm text-dim leading-relaxed">{f.text}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Как подключить */}
      <section className="max-w-5xl mx-auto px-6 py-12">
        <h2 className="text-2xl font-semibold text-center">Как подключить</h2>
        <div className="mt-10 grid sm:grid-cols-3 gap-4">
          {steps.map((s) => (
            <div
              key={s.n}
              className="bg-panel border border-line rounded-2xl p-6"
            >
              <div className="text-glow font-semibold tracking-widest">
                {s.n}
              </div>
              <h3 className="mt-3 font-medium">{s.title}</h3>
              <p className="mt-2 text-sm text-dim leading-relaxed">{s.text}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Тарифы */}
      <section id="tariffs" className="max-w-5xl mx-auto px-6 py-12">
        <h2 className="text-2xl font-semibold text-center">Тарифы</h2>
        <p className="text-dim text-sm text-center mt-2">
          Цена за месяц. Чем выше тариф — тем мощнее движок и больше
          возможностей.
        </p>
        <div className="mt-10 grid md:grid-cols-3 gap-4">
          {TARIFFS.map((t) => {
            const featured = t.id === "pro";
            const big =
              primary === "kzt"
                ? formatKzt(t.priceKzt)
                : formatRub(t.priceRub);
            const small =
              primary === "kzt"
                ? formatRub(t.priceRub)
                : formatKzt(t.priceKzt);
            return (
              <div
                key={t.id}
                className={
                  "rounded-2xl p-6 border " +
                  (featured ? "border-glow bg-panel2" : "border-line bg-panel")
                }
              >
                {featured && (
                  <div className="text-[10px] tracking-[0.2em] text-glow mb-2">
                    ПОПУЛЯРНЫЙ
                  </div>
                )}
                <h3 className="text-lg font-semibold">{t.name}</h3>
                <p className="text-sm text-dim mt-1">{t.tagline}</p>
                <div className="mt-4">
                  <div className="text-2xl font-semibold">{big}</div>
                  <div className="text-xs text-dim mt-0.5">
                    {small} · в месяц
                  </div>
                </div>
                <div className="text-xs text-glow mt-3">
                  Движок: {t.engineLabel}
                </div>
                <ul className="mt-4 space-y-1.5">
                  {t.features.map((f) => (
                    <li
                      key={f}
                      className="text-sm text-dim flex gap-2 leading-snug"
                    >
                      <span className="text-glow shrink-0">✓</span>
                      <span>{f}</span>
                    </li>
                  ))}
                </ul>
                <Link
                  href="/register"
                  className={
                    "block text-center mt-6 px-4 py-2.5 rounded-lg text-sm font-medium transition-opacity " +
                    (featured
                      ? "bg-glow text-night hover:opacity-90"
                      : "border border-line text-fg hover:bg-panel2")
                  }
                >
                  Выбрать {t.name}
                </Link>
              </div>
            );
          })}
        </div>
        <p className="text-xs text-dim text-center mt-6">
          Оплата переводом — администратор активирует тариф на оплаченный срок.
        </p>
      </section>

      {/* CTA */}
      <section className="max-w-5xl mx-auto px-6 py-16">
        <div className="bg-gradient-to-br from-panel2 to-panel border border-line rounded-3xl p-10 text-center">
          <h2 className="text-2xl font-semibold">Готов делегировать рутину?</h2>
          <p className="mt-3 text-dim">
            Создай аккаунт и подключи свою FRIDAY за пару минут.
          </p>
          <Link
            href="/register"
            className="inline-block mt-6 px-6 py-3 rounded-lg bg-glow text-night font-medium hover:opacity-90 transition-opacity"
          >
            Начать сейчас
          </Link>
        </div>
      </section>

      {/* Подвал */}
      <footer className="border-t border-line">
        <div className="max-w-5xl mx-auto px-6 py-8 flex items-center justify-between text-sm text-dim">
          <Logo className="text-xs" />
          <span>© {new Date().getFullYear()} F.R.I.D.A.Y</span>
        </div>
      </footer>
    </div>
  );
}
