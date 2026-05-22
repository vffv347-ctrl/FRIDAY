import { createClient, type SupabaseClient } from "@supabase/supabase-js";

// Подключение к Supabase — долговременная память F.R.I.D.A.Y.
// Используется секретный ключ (server-side), он обходит RLS.

let client: SupabaseClient | null = null;

export function initDb(url: string, secretKey: string): void {
  client = createClient(url, secretKey, {
    auth: { persistSession: false },
  });
}

export function db(): SupabaseClient {
  if (!client) {
    throw new Error("База не инициализирована — вызови initDb()");
  }
  return client;
}
