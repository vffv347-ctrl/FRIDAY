import { db } from "./db";

// Учёт энергии владельца — в Supabase (таблица bot_energy).

export type EnergyEntry = {
  ownerId: number;
  level: number; // 1..10
  note: string;
  at: string; // ISO 8601
};

type Row = {
  owner_id: number;
  level: number;
  note: string;
  at: string;
};

function toEntry(row: Row): EnergyEntry {
  return {
    ownerId: row.owner_id,
    level: row.level,
    note: row.note,
    at: row.at,
  };
}

export async function logEnergy(
  ownerId: number,
  level: number,
  note: string,
): Promise<EnergyEntry> {
  const safeLevel = Math.max(1, Math.min(10, Math.round(level)));
  try {
    await db()
      .from("bot_energy")
      .insert({ owner_id: ownerId, level: safeLevel, note });
  } catch (err) {
    console.error("Ошибка сохранения энергии:", err);
  }
  return {
    ownerId,
    level: safeLevel,
    note,
    at: new Date().toISOString(),
  };
}

export async function getEnergyLog(
  ownerId: number,
  limit = 30,
): Promise<EnergyEntry[]> {
  try {
    const { data, error } = await db()
      .from("bot_energy")
      .select("*")
      .eq("owner_id", ownerId)
      .order("at", { ascending: false })
      .limit(limit);
    if (error || !data) return [];
    return (data as Row[]).map(toEntry);
  } catch (err) {
    console.error("Ошибка загрузки энергии:", err);
    return [];
  }
}
