import { db } from "./db";

// Напоминания — в Supabase (таблица bot_reminders).

export type Reminder = {
  id: string;
  ownerId: number;
  text: string;
  fireAt: string; // ISO 8601
  createdAt: string;
};

type Row = {
  id: string;
  owner_id: number;
  text: string;
  fire_at: string;
  created_at: string;
};

function toReminder(row: Row): Reminder {
  return {
    id: row.id,
    ownerId: row.owner_id,
    text: row.text,
    fireAt: row.fire_at,
    createdAt: row.created_at,
  };
}

function genId(): string {
  return Math.random().toString(36).slice(2, 10);
}

export async function addReminder(
  ownerId: number,
  text: string,
  fireAt: string,
): Promise<Reminder> {
  const id = genId();
  try {
    await db()
      .from("bot_reminders")
      .insert({ id, owner_id: ownerId, text, fire_at: fireAt });
  } catch (err) {
    console.error("Ошибка сохранения напоминания:", err);
  }
  return { id, ownerId, text, fireAt, createdAt: new Date().toISOString() };
}

export async function listReminders(ownerId: number): Promise<Reminder[]> {
  try {
    const { data, error } = await db()
      .from("bot_reminders")
      .select("*")
      .eq("owner_id", ownerId)
      .order("fire_at", { ascending: true });
    if (error || !data) return [];
    return (data as Row[]).map(toReminder);
  } catch (err) {
    console.error("Ошибка загрузки напоминаний:", err);
    return [];
  }
}

export async function cancelReminder(
  ownerId: number,
  id: string,
): Promise<boolean> {
  try {
    const { data } = await db()
      .from("bot_reminders")
      .delete()
      .eq("owner_id", ownerId)
      .eq("id", id)
      .select("id");
    return (data?.length ?? 0) > 0;
  } catch (err) {
    console.error("Ошибка удаления напоминания:", err);
    return false;
  }
}

// Возвращает наступившие напоминания (по всем владельцам) и удаляет их.
export async function popDueReminders(now: number): Promise<Reminder[]> {
  const nowIso = new Date(now).toISOString();
  try {
    const { data, error } = await db()
      .from("bot_reminders")
      .select("*")
      .lte("fire_at", nowIso);
    if (error || !data || data.length === 0) return [];
    const due = (data as Row[]).map(toReminder);
    await db().from("bot_reminders").delete().lte("fire_at", nowIso);
    return due;
  } catch (err) {
    console.error("Ошибка проверки напоминаний:", err);
    return [];
  }
}
