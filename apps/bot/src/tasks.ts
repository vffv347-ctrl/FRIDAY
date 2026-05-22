import { db } from "./db";

// Список задач владельца — в Supabase (таблица bot_tasks).

export type Task = {
  id: string;
  ownerId: number;
  text: string;
  done: boolean;
  createdAt: string;
  doneAt: string | null;
};

type Row = {
  id: string;
  owner_id: number;
  text: string;
  done: boolean;
  created_at: string;
  done_at: string | null;
};

function toTask(row: Row): Task {
  return {
    id: row.id,
    ownerId: row.owner_id,
    text: row.text,
    done: row.done,
    createdAt: row.created_at,
    doneAt: row.done_at,
  };
}

function genId(): string {
  return Math.random().toString(36).slice(2, 8);
}

export async function addTask(ownerId: number, text: string): Promise<Task> {
  const id = genId();
  try {
    await db()
      .from("bot_tasks")
      .insert({ id, owner_id: ownerId, text, done: false });
  } catch (err) {
    console.error("Ошибка сохранения задачи:", err);
  }
  return {
    id,
    ownerId,
    text,
    done: false,
    createdAt: new Date().toISOString(),
    doneAt: null,
  };
}

export async function listTasks(ownerId: number): Promise<Task[]> {
  try {
    const { data, error } = await db()
      .from("bot_tasks")
      .select("*")
      .eq("owner_id", ownerId)
      .order("done", { ascending: true }) // активные сверху
      .order("created_at", { ascending: true });
    if (error || !data) return [];
    return (data as Row[]).map(toTask);
  } catch (err) {
    console.error("Ошибка загрузки задач:", err);
    return [];
  }
}

export async function completeTask(
  ownerId: number,
  id: string,
): Promise<boolean> {
  try {
    const { data } = await db()
      .from("bot_tasks")
      .update({ done: true, done_at: new Date().toISOString() })
      .eq("owner_id", ownerId)
      .eq("id", id)
      .select("id");
    return (data?.length ?? 0) > 0;
  } catch (err) {
    console.error("Ошибка обновления задачи:", err);
    return false;
  }
}

export async function deleteTask(
  ownerId: number,
  id: string,
): Promise<boolean> {
  try {
    const { data } = await db()
      .from("bot_tasks")
      .delete()
      .eq("owner_id", ownerId)
      .eq("id", id)
      .select("id");
    return (data?.length ?? 0) > 0;
  } catch (err) {
    console.error("Ошибка удаления задачи:", err);
    return false;
  }
}
