import type Anthropic from "@anthropic-ai/sdk";
import { db } from "./db";

// История диалога — долговременная, в Supabase (таблица bot_messages).
// В контекст модели берём последние HISTORY_LIMIT сообщений.

// Берём только свежее: 20 сообщений (10 ходов диалога) — этого хватает
// для понимания контекста, дальше уже стоит платить за вызов инструментов
// (память/задачи) вместо того, чтобы таскать всю переписку в каждый запрос.
const HISTORY_LIMIT = 20;

export async function getHistory(
  ownerId: number,
): Promise<Anthropic.MessageParam[]> {
  try {
    const { data, error } = await db()
      .from("bot_messages")
      .select("role, content")
      .eq("owner_id", ownerId)
      .order("created_at", { ascending: false })
      .limit(HISTORY_LIMIT);
    if (error || !data) return [];

    const rows = data.reverse(); // в хронологический порядок
    // История для Messages API должна начинаться с user-сообщения.
    while (rows.length > 0 && rows[0].role !== "user") rows.shift();

    return rows.map((row) => ({
      role: row.role === "assistant" ? "assistant" : "user",
      content: String(row.content),
    }));
  } catch (err) {
    console.error("Ошибка загрузки истории:", err);
    return [];
  }
}

async function append(
  ownerId: number,
  role: "user" | "assistant",
  content: string,
): Promise<void> {
  try {
    const { error } = await db()
      .from("bot_messages")
      .insert({ owner_id: ownerId, role, content });
    if (error) console.error("Ошибка сохранения сообщения:", error.message);
  } catch (err) {
    console.error("Ошибка сохранения сообщения:", err);
  }
}

export function appendUser(ownerId: number, text: string): Promise<void> {
  return append(ownerId, "user", text);
}

export function appendAssistant(
  ownerId: number,
  text: string,
): Promise<void> {
  return append(ownerId, "assistant", text);
}

export async function resetHistory(ownerId: number): Promise<void> {
  try {
    await db().from("bot_messages").delete().eq("owner_id", ownerId);
  } catch (err) {
    console.error("Ошибка очистки истории:", err);
  }
}
