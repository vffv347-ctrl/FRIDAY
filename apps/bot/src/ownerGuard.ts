import type { Context, NextFunction } from "grammy";

// Замок безопасности: бот реагирует ТОЛЬКО на владельца.
//
// ctx.from.id — это всегда реальный отправитель сообщения в чате.
// Пересланные сообщения (forward_origin / forward_from) на идентификацию
// НЕ влияют — мы намеренно их не смотрим. Чужие ID молча игнорируются.
//
// Business-апдейты (business_connection, business_message) приходят от чужих
// пользователей по своей схеме — они обрабатываются отдельно и гарда не требуют.
export function createOwnerGuard(ownerTelegramId: number) {
  return async (ctx: Context, next: NextFunction): Promise<void> => {
    const upd = ctx.update as unknown as Record<string, unknown>;
    if (upd.business_connection || upd.business_message || upd.edited_business_message || upd.deleted_business_messages) {
      await next();
      return;
    }

    const fromId = ctx.from?.id;

    if (fromId !== ownerTelegramId) {
      if (fromId !== undefined) {
        console.warn(`⛔ Игнорирую сообщение от чужого Telegram ID: ${fromId}`);
      }
      return; // next() не вызываем — обработка останавливается здесь
    }

    await next();
  };
}
