import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "F.R.I.D.A.Y — твой персональный ИИ-ассистент",
  description:
    "F.R.I.D.A.Y — ассистентка, которая забирает твои задачи и решает их сама: планирует, напоминает, шлёт отчёты.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="ru">
      <body>{children}</body>
    </html>
  );
}
