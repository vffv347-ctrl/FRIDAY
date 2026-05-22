import Link from "next/link";
import { Logo } from "@/components/Logo";

// Показывается на защищённых страницах, пока не настроен Supabase.
export function SetupNotice() {
  return (
    <div className="min-h-screen flex items-center justify-center p-6">
      <div className="max-w-lg w-full bg-panel border border-line rounded-2xl p-8">
        <Logo className="text-glow text-xs" />
        <h1 className="text-xl font-semibold mt-4">Supabase ещё не подключён</h1>
        <p className="text-dim mt-3 text-sm leading-relaxed">
          Чтобы заработали регистрация, личный кабинет и бэк-офис, создай проект
          Supabase и заполни переменные окружения в файле{" "}
          <code className="text-glow">apps/web/.env.local</code>.
        </p>
        <p className="text-dim mt-2 text-sm leading-relaxed">
          Пошаговая инструкция — в файле{" "}
          <code className="text-glow">docs/SETUP.md</code>.
        </p>
        <Link
          href="/"
          className="inline-block mt-6 text-glow text-sm hover:underline"
        >
          ← На главную
        </Link>
      </div>
    </div>
  );
}
