import { db } from "./db";

// Долговременная память — факты о владельце (таблица bot_memory).

export async function addFact(ownerId: number, fact: string): Promise<void> {
  try {
    const { error } = await db()
      .from("bot_memory")
      .insert({ owner_id: ownerId, fact });
    if (error) console.error("Ошибка сохранения факта:", error.message);
  } catch (err) {
    console.error("Ошибка сохранения факта:", err);
  }
}

export async function getFacts(ownerId: number): Promise<string[]> {
  try {
    const { data, error } = await db()
      .from("bot_memory")
      .select("fact")
      .eq("owner_id", ownerId)
      .order("created_at", { ascending: true })
      .limit(200);
    if (error || !data) return [];
    return data.map((row) => String(row.fact));
  } catch (err) {
    console.error("Ошибка загрузки фактов:", err);
    return [];
  }
}
