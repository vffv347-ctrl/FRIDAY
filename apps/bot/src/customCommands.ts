import { db } from "./db";

// Свои команды владельца — в Supabase (таблица bot_commands).
// Команда = имя + инструкция, что делать.

export type CustomCommand = {
  ownerId: number;
  name: string;
  instruction: string;
  createdAt: string;
};

type Row = {
  owner_id: number;
  name: string;
  instruction: string;
  created_at: string;
};

function toCommand(row: Row): CustomCommand {
  return {
    ownerId: row.owner_id,
    name: row.name,
    instruction: row.instruction,
    createdAt: row.created_at,
  };
}

// Создаёт или перезаписывает команду с таким именем.
export async function createCommand(
  ownerId: number,
  name: string,
  instruction: string,
): Promise<CustomCommand> {
  const cleanName = name.trim();
  try {
    await db()
      .from("bot_commands")
      .upsert(
        { owner_id: ownerId, name: cleanName, instruction },
        { onConflict: "owner_id,name" },
      );
  } catch (err) {
    console.error("Ошибка сохранения команды:", err);
  }
  return {
    ownerId,
    name: cleanName,
    instruction,
    createdAt: new Date().toISOString(),
  };
}

export async function listCommands(
  ownerId: number,
): Promise<CustomCommand[]> {
  try {
    const { data, error } = await db()
      .from("bot_commands")
      .select("*")
      .eq("owner_id", ownerId)
      .order("name", { ascending: true });
    if (error || !data) return [];
    return (data as Row[]).map(toCommand);
  } catch (err) {
    console.error("Ошибка загрузки команд:", err);
    return [];
  }
}

export async function deleteCommand(
  ownerId: number,
  name: string,
): Promise<boolean> {
  try {
    const { data } = await db()
      .from("bot_commands")
      .delete()
      .eq("owner_id", ownerId)
      .eq("name", name.trim())
      .select("name");
    return (data?.length ?? 0) > 0;
  } catch (err) {
    console.error("Ошибка удаления команды:", err);
    return false;
  }
}
