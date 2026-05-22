import Link from "next/link";
import { login } from "./actions";
import { Logo } from "@/components/Logo";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; message?: string }>;
}) {
  const sp = await searchParams;

  return (
    <main className="min-h-screen flex items-center justify-center p-6">
      <div className="w-full max-w-sm">
        <Link href="/" className="flex justify-center">
          <Logo className="text-glow text-xs" />
        </Link>
        <h1 className="text-2xl font-semibold text-center mt-6">Вход</h1>
        <p className="text-dim text-sm text-center mt-2">
          Рад снова видеть. Войди в свой аккаунт.
        </p>

        {sp.message && (
          <p className="mt-5 text-sm rounded-lg border border-line bg-panel px-3 py-2 text-glow">
            {sp.message}
          </p>
        )}
        {sp.error && (
          <p className="mt-5 text-sm rounded-lg border border-red-500/40 bg-red-500/10 px-3 py-2 text-red-300">
            {sp.error}
          </p>
        )}

        <form action={login} className="mt-6 space-y-3">
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
            placeholder="Пароль"
            className="w-full rounded-lg bg-panel border border-line px-3 py-2.5 text-sm outline-none focus:border-glow"
          />
          <button
            type="submit"
            className="w-full rounded-lg bg-glow text-night font-medium py-2.5 text-sm hover:opacity-90 transition-opacity"
          >
            Войти
          </button>
        </form>

        <p className="mt-5 text-sm text-dim text-center">
          Нет аккаунта?{" "}
          <Link href="/register" className="text-glow hover:underline">
            Регистрация
          </Link>
        </p>
      </div>
    </main>
  );
}
