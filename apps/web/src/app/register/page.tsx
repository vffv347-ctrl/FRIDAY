import Link from "next/link";
import { register } from "./actions";
import { Logo } from "@/components/Logo";

export default async function RegisterPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const sp = await searchParams;

  return (
    <main className="min-h-screen flex items-center justify-center p-6">
      <div className="w-full max-w-sm">
        <Link href="/" className="flex justify-center">
          <Logo className="text-glow text-xs" />
        </Link>
        <h1 className="text-2xl font-semibold text-center mt-6">Регистрация</h1>
        <p className="text-dim text-sm text-center mt-2">
          Создай аккаунт — центр управления твоей ассистенткой.
        </p>

        {sp.error && (
          <p className="mt-5 text-sm rounded-lg border border-red-500/40 bg-red-500/10 px-3 py-2 text-red-300">
            {sp.error}
          </p>
        )}

        <form action={register} className="mt-6 space-y-3">
          <input
            name="full_name"
            type="text"
            placeholder="Имя"
            className="w-full rounded-lg bg-panel border border-line px-3 py-2.5 text-sm outline-none focus:border-glow"
          />
          <input
            name="email"
            type="email"
            required
            placeholder="Email"
            className="w-full rounded-lg bg-panel border border-line px-3 py-2.5 text-sm outline-none focus:border-glow"
          />
          <input
            name="password"
            type="password"
            required
            minLength={6}
            placeholder="Пароль (от 6 символов)"
            className="w-full rounded-lg bg-panel border border-line px-3 py-2.5 text-sm outline-none focus:border-glow"
          />
          <button
            type="submit"
            className="w-full rounded-lg bg-glow text-night font-medium py-2.5 text-sm hover:opacity-90 transition-opacity"
          >
            Создать аккаунт
          </button>
        </form>

        <p className="mt-5 text-sm text-dim text-center">
          Уже есть аккаунт?{" "}
          <Link href="/login" className="text-glow hover:underline">
            Войти
          </Link>
        </p>
      </div>
    </main>
  );
}
