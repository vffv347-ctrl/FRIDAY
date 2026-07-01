import {
  Bot,
  GrammyError,
  HttpError,
  InputFile,
  type Context,
} from "grammy";
import type Anthropic from "@anthropic-ai/sdk";
import { loadConfig } from "./config";
import {
  initFriday,
  runFriday,
  askFridayOnce,
  MODEL_DEFAULT,
  MODEL_HEAVY,
  MODEL_LIGHT,
} from "./friday";
import { createOwnerGuard } from "./ownerGuard";
import {
  getHistory,
  appendUser,
  appendAssistant,
  resetHistory,
} from "./conversation";
import { transcribeVoice } from "./voice";
import { readDocument } from "./documents";
import { popDueReminders } from "./reminders";
import { initDb, db } from "./db";
import { SMART_COMMANDS } from "./commands";
import { upsertFact } from "./memory";

// ── Анализ стиля владельца ────────────────────────────────────────
async function analyzeAndSaveStyle(ownerTelegramId: number): Promise<string> {
  // Берём последние сообщения владельца из его прямого чата с Пятницей
  let rows: { role: string; content: string }[] = [];
  try {
    const { data } = await db()
      .from("bot_messages")
      .select("role, content")
      .eq("owner_id", ownerTelegramId)
      .eq("role", "user")
      .order("created_at", { ascending: false })
      .limit(60);
    rows = data ?? [];
  } catch (_) { /* ignore */ }

  const userMessages = rows.map((r) => String(r.content)).filter(Boolean).reverse();
  if (userMessages.length < 3) {
    return "Маловато сообщений для анализа — пообщайся со мной ещё немного и повтори.";
  }

  const sample = userMessages.slice(-40).join("\n---\n");
  const prompt = `Проанализируй стиль написания этого человека на основе его сообщений. Дай КРАТКОЕ (5–8 пунктов) описание его стиля для другого ИИ, который будет писать вместо него:

${sample}

Опиши: использует ли заглавные буквы, знаки препинания, как длинные сообщения, типичные слова/обороты, эмодзи, ошибки/опечатки, неформальность. Только факты, без лишних слов. Формат: список тезисов.`;

  const result = await askFridayOnce("Ты — аналитик стиля текста. Отвечай кратко и по делу.", prompt, {
    model: MODEL_DEFAULT,
  });

  await upsertFact(ownerTelegramId, "СТИЛЬ", result);
  return result;
}

// ── Буфер сообщений (дебаунс) ────────────────────────────────────
// Накапливаем все входящие за одну «волну» (пересланные, картинки,
// голосовые, документы) и отправляем Claude одним батчем.
type MsgItem =
  | { type: "text"; text: string; forwarded: boolean }
  | { type: "image"; base64: string; caption?: string }
  | { type: "voice"; text: string }
  | { type: "doc"; text: string; filename: string }
  | { type: "pdf"; base64: string; filename: string; caption?: string };

type ChatBuffer = {
  items: MsgItem[];
  timer: ReturnType<typeof setTimeout>;
  ctx: Context;
  model: string | undefined;
};

const DEBOUNCE_MS = 5_000;
const chatBuffers = new Map<number, ChatBuffer>();

function bufferItem(
  ctx: Context,
  chatId: number,
  item: MsgItem,
  model: string | undefined,
): void {
  const existing = chatBuffers.get(chatId);
  if (existing) {
    clearTimeout(existing.timer);
    existing.items.push(item);
    existing.ctx = ctx;
    existing.timer = setTimeout(() => flushBuffer(chatId), DEBOUNCE_MS);
  } else {
    const timer = setTimeout(() => flushBuffer(chatId), DEBOUNCE_MS);
    chatBuffers.set(chatId, { items: [item], timer, ctx, model });
  }
  ctx.replyWithChatAction("typing").catch(() => {});
}

function flushBuffer(chatId: number): void {
  const buf = chatBuffers.get(chatId);
  if (!buf) return;
  chatBuffers.delete(chatId);
  void processBatch(buf.ctx, chatId, buf.items, buf.model);
}

async function processBatch(
  ctx: Context,
  chatId: number,
  items: MsgItem[],
  model: string | undefined,
): Promise<void> {
  if (items.length === 0) return;
  await ctx.replyWithChatAction("typing");

  try {
    const history = await getHistory(chatId);

    // Собираем блоки контента для Claude
    const blocks: Anthropic.ContentBlockParam[] = [];

    const imageItems = items.filter((i) => i.type === "image") as Extract<MsgItem, { type: "image" }>[];
    const pdfItems   = items.filter((i) => i.type === "pdf")   as Extract<MsgItem, { type: "pdf" }>[];
    const forwarded  = items.filter((i) => i.type === "text" && i.forwarded) as Extract<MsgItem, { type: "text" }>[];
    const direct     = items.filter((i) => i.type === "text" && !i.forwarded) as Extract<MsgItem, { type: "text" }>[];
    const voices     = items.filter((i) => i.type === "voice") as Extract<MsgItem, { type: "voice" }>[];
    const docs       = items.filter((i) => i.type === "doc")   as Extract<MsgItem, { type: "doc" }>[];

    // Картинки — перед текстом
    for (const img of imageItems) {
      blocks.push({
        type: "image",
        source: { type: "base64", media_type: "image/jpeg", data: img.base64 },
      });
    }

    // PDF-документы
    for (const pdf of pdfItems) {
      blocks.push({
        type: "document",
        source: { type: "base64", media_type: "application/pdf", data: pdf.base64 },
      } as Anthropic.ContentBlockParam);
    }

    // Текстовый блок: пересланные → голосовые → документы → картинки-подписи → прямые
    const parts: string[] = [];

    if (forwarded.length > 0) {
      parts.push(
        `[Пересланные сообщения — ${forwarded.length} шт.]:\n` +
        forwarded.map((m, i) => `${i + 1}. ${m.text}`).join("\n"),
      );
    }
    for (const v of voices) {
      parts.push(`[Голосовое]: ${v.text}`);
    }
    for (const d of docs) {
      parts.push(`[Документ «${d.filename}»]:\n${d.text}`);
    }
    for (const pdf of pdfItems) {
      if (pdf.caption) parts.push(`[Задание к PDF «${pdf.filename}»]: ${pdf.caption}`);
    }
    for (const img of imageItems) {
      if (img.caption) parts.push(`[Подпись к изображению]: ${img.caption}`);
    }
    if (direct.length > 0) {
      parts.push(direct.map((m) => m.text).join("\n"));
    }

    if (parts.length > 0) {
      blocks.push({ type: "text", text: parts.join("\n\n") });
    }

    if (blocks.length === 0) return;

    // Краткое резюме для сохранения в БД
    const dbSummary = [
      forwarded.length > 0 ? `[${forwarded.length} пересланных]` : "",
      voices.length > 0    ? `[${voices.length} голосовых]` : "",
      imageItems.length > 0 ? `[${imageItems.length} изображений]` : "",
      pdfItems.length > 0  ? `[${pdfItems.length} PDF]` : "",
      docs.length > 0      ? `[${docs.length} документов]` : "",
      direct.map((m) => m.text).join(" ").slice(0, 300),
    ].filter(Boolean).join(" ").trim();

    await appendUser(chatId, dbSummary || "[сообщение]");

    const messages: Anthropic.MessageParam[] = [
      ...history,
      { role: "user" as const, content: blocks },
    ];

    let produced = false;
    const reply = await runFriday(
      messages,
      chatId,
      {
        onImage: async (image, caption) => {
          produced = true;
          await ctx.replyWithPhoto(
            new InputFile(image, "friday.png"),
            caption ? { caption } : undefined,
          );
        },
        onDocument: async (file, filename) => {
          produced = true;
          await ctx.replyWithDocument(new InputFile(file, filename));
        },
        onDeepTask: async (confirmationMessage, taskPrompt) => {
          produced = true;
          await ctx.reply(clean(confirmationMessage));
          void executeDeepTask(
            chatId,
            taskPrompt,
            (text) => ctx.api.sendMessage(chatId, text).then(() => {}),
            (buf, cap) =>
              ctx.api
                .sendPhoto(
                  chatId,
                  new InputFile(buf, "friday.png"),
                  cap ? { caption: cap } : undefined,
                )
                .then(() => {}),
            (buf, name) =>
              ctx.api.sendDocument(chatId, new InputFile(buf, name)).then(() => {}),
          );
        },
      },
      model ? { model } : undefined,
    );

    await appendAssistant(
      chatId,
      reply || (produced ? "[отправила файл]" : "Готово."),
    );
    if (reply) await sendLong(ctx, reply);
    else if (!produced) await ctx.reply("Готово.");
  } catch (err) {
    console.error("Ошибка обработки батча:", err);
    await ctx.reply("Что-то сбойнуло на моей стороне. Попробуй ещё раз.");
  }
}

const GREETING = `Привет! Я F.R.I.D.A.Y. — твоя личная ассистентка. 🤖

Говори со мной обычными словами — текстом или голосом. Поручай задачи, спрашивай совета, скидывай картинки. Я сама разберусь, что нужно, и сделаю — никаких команд учить не надо.

Со временем я запомню, чем ты занимаешься, и буду помогать точнее.

Поехали — напиши или надиктуй, что у тебя на уме.`;

const HELP = `Я F.R.I.D.A.Y. — твоя личная ассистентка.

Говори со мной обычными словами, текстом или голосом — команды учить не нужно.

Что я умею:
🧠 советую, планирую, помогаю думать и решать задачи
💾 помню наши разговоры и всё важное о тебе
🎙 слушаю голосовые
🖼 смотрю и оцениваю картинки, рисую новые по описанию
🌐 ищу актуальную информацию в интернете
📄 читаю документы — PDF, DOCX, XLSX, TXT
📁 создаю файлы — PDF, DOCX, XLSX (документы, таблицы)
🧾 выписываю счета на оплату — структурированный PDF + DOCX с реквизитами
⏰ ставлю напоминания
✅ веду список задач
📝 храню заметки и контакты
⚡ веду учёт твоей энергии
🛠 создаю свои команды — «создай команду …»
🌅 8:00 — брифинг дня, 21:00 — итог дня

Просто скажи: «напомни …», «добавь задачу …», «нарисуй …», «выпиши счёт …», «какая погода …», «создай команду …».

Быстрые кнопки: /plan /idea /decompose /priority /brief /summary /reg
/reset — очистить текущий разговор (память о тебе остаётся)

🔒 Отвечаю только тебе.`;

const TELEGRAM_LIMIT = 4000;

// Убирает markdown-символы (* ** *** # _ ` ), которые Telegram не рендерит.
function clean(text: string): string {
  return text
    .replace(/\*{1,3}([^*\n]+?)\*{1,3}/g, "$1") // **жирный**, *курсив*
    .replace(/`{1,3}([^`\n]+?)`{1,3}/g, "$1") // `код`
    .replace(/^#{1,6}[ \t]+/gm, "") // ### заголовок
    .replace(/^[ \t]*[-*][ \t]+/gm, "— "); // маркеры списка → тире
}

// Текущее московское время — час (0-23) и дата YYYY-MM-DD.
function mskNow(): { hour: number; date: string } {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Moscow",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date());
  const get = (type: string) =>
    parts.find((p) => p.type === type)?.value ?? "";
  return {
    hour: Number(get("hour")),
    date: `${get("year")}-${get("month")}-${get("day")}`,
  };
}

// Отправляет длинный текст, разбивая по лимиту Telegram.
async function sendLong(ctx: Context, text: string): Promise<void> {
  const out = clean(text);
  for (let i = 0; i < out.length; i += TELEGRAM_LIMIT) {
    await ctx.reply(out.slice(i, i + TELEGRAM_LIMIT));
  }
}

// ── Подписка → движок Claude ─────────────────────────────────────
// 'hybrid' — Sonnet по умолчанию + автоматический апгрейд до Opus по
// триггерам владельца («думай хорошо» и т.п.). Это тот же режим, который
// идёт по умолчанию у superadmin через env, теперь его можно дать любому
// пользователю через /admin.
type Engine = "haiku" | "sonnet" | "opus" | "hybrid";
const ENGINE_MODELS: Record<Exclude<Engine, "hybrid">, string> = {
  haiku: MODEL_LIGHT,
  sonnet: MODEL_DEFAULT,
  opus: MODEL_HEAVY,
};

// Кешируем активную подписку по user_id на 30 секунд, чтобы не лезть
// в БД на каждое сообщение. Этого достаточно, чтобы изменения в /admin
// доходили до бота быстро, но без лишних запросов.
type SubInfo = { engine: Engine } | null;
const subCache = new Map<string, { sub: SubInfo; expiresAt: number }>();

async function fetchSubInfo(userId: string): Promise<SubInfo> {
  const cached = subCache.get(userId);
  if (cached && cached.expiresAt > Date.now()) return cached.sub;

  let sub: SubInfo = null;
  try {
    const { data } = await db()
      .from("subscriptions")
      .select("status, expires_at, engine")
      .eq("user_id", userId)
      .maybeSingle();

    if (data && data.status === "active") {
      const notExpired =
        !data.expires_at || new Date(data.expires_at).getTime() > Date.now();
      const engine = data.engine as Engine;
      if (
        notExpired &&
        (engine === "haiku" ||
          engine === "sonnet" ||
          engine === "opus" ||
          engine === "hybrid")
      ) {
        sub = { engine };
      }
    }
  } catch (err) {
    console.error("Не удалось прочитать подписку:", err);
  }

  subCache.set(userId, { sub, expiresAt: Date.now() + 30_000 });
  return sub;
}

// ── Конфиг одного бота ────────────────────────────────────────────
// resolveModel:
//   - undefined → friday.ts выбирает сам (Sonnet/Opus/триггер). Это режим владельца.
//   - string    → принудительно этот движок (для тенантов из подписки).
//   - null      → подписка не активна, боту нельзя обслуживать пользователя.
type BotConfig = {
  token: string;
  ownerTelegramId: number;
  notifyChatId: number; // куда слать уведомления business-режима (группа или лс)
  userId: string | null; // null = владелец из env
  openaiKey: string;
  resolveModel: () => Promise<string | null | undefined>;
};

// Реестр запущенных ботов: ключ — токен.
const running = new Map<string, { bot: Bot; cfg: BotConfig }>();
// Маршрутизация напоминаний: ownerTelegramId → бот для отправки.
const ownerToBot = new Map<number, Bot>();

// Ручная пауза (владелец включил через /pause): FRIDAY не отвечает в чатах совсем.
const businessManualPause = new Set<number>(); // ownerTelegramId

// ── Автономная (фоновая) глубокая задача ──────────────────────────
// Запускается когда FRIDAY вызывает инструмент take_deep_task.
// Выполняется в фоне, результат отправляется в тот же chatId.
async function executeDeepTask(
  chatId: number,
  taskPrompt: string,
  sendMsg: (text: string) => Promise<void>,
  sendPhoto: (buf: Buffer, cap: string) => Promise<void>,
  sendDoc: (buf: Buffer, name: string) => Promise<void>,
): Promise<void> {
  try {
    const result = await runFriday(
      [{ role: "user" as const, content: taskPrompt }],
      chatId,
      {
        onImage: async (image, caption) => sendPhoto(image, caption),
        onDocument: async (file, filename) => sendDoc(file, filename),
      },
      { deepTask: true, ownerChatId: chatId },
    );

    if (result) {
      const out = clean(result);
      for (let i = 0; i < out.length; i += TELEGRAM_LIMIT) {
        await sendMsg(out.slice(i, i + TELEGRAM_LIMIT));
      }
      await appendAssistant(chatId, result);
    }
  } catch (err) {
    console.error("Ошибка глубокой задачи:", err);
    await sendMsg(
      "Что-то пошло не так при выполнении задачи. Попробуй сформулировать её иначе.",
    ).catch(() => {});
  }
}

// ── Извлечение важной инфы из бизнес-чата → в личный чат с ботом ──
// Запускается в фоне после каждого ответа в business-режиме.
async function maybeExtractBusinessInfo(
  senderName: string,
  incoming: string,
  fridayReply: string,
  ownerTelegramId: number,
  sendToOwner: (text: string) => Promise<void>,
): Promise<void> {
  try {
    const extracted = await askFridayOnce(
      `Ты анализируешь переписку делового человека. Задача: если в сообщении есть конкретная важная информация (дата / время встречи, сумма / сделка, обязательство, контакт, срочный дедлайн, важная договорённость) — выдай краткое резюме одной строкой. Если ничего важного нет — ответь только словом «нет».`,
      `Сообщение от ${senderName}: ${incoming}\n\nОтвет: ${fridayReply}`,
      { model: MODEL_LIGHT },
    );

    const trimmed = extracted?.trim() ?? "";
    if (trimmed && !/^нет$/i.test(trimmed)) {
      await sendToOwner(`📌 Из чата с ${senderName}:\n${trimmed}`);
    }
  } catch {
    // тихо — это фоновая функция
  }
}

// ── Конструируем экземпляр бота с обработчиками ────────────────────
function setupBot(cfg: BotConfig): Bot {
  const bot = new Bot(cfg.token);

  // Замок безопасности — этот бот реагирует ТОЛЬКО на своего владельца.
  bot.use(createOwnerGuard(cfg.ownerTelegramId));

  // Проверяет подписку. Возвращает model для friday или undefined (владелец).
  // Если подписка не активна — отвечает пользователю и возвращает null.
  async function gate(ctx: Context): Promise<string | undefined | null> {
    const m = await cfg.resolveModel();
    if (m === null) {
      await ctx.reply(
        "Подписка не активна. Попроси администратора активировать тариф.",
      );
      return null;
    }
    return m;
  }

  bot.command("start", async (ctx) => {
    await ctx.reply(GREETING);
  });
  bot.command("help", async (ctx) => {
    await ctx.reply(HELP);
  });
  bot.command("reset", async (ctx) => {
    await resetHistory(ctx.chat.id);
    await ctx.reply("История разговора очищена 🧹");
  });

  bot.command("mystyle", async (ctx) => {
    await ctx.replyWithChatAction("typing");
    try {
      const result = await analyzeAndSaveStyle(cfg.ownerTelegramId);
      await sendLong(ctx, `Стиль сохранён и будет использоваться в business-ответах:\n\n${result}`);
    } catch (err) {
      console.error("Ошибка анализа стиля:", err);
      await ctx.reply("Не получилось проанализировать стиль. Попробуй ещё раз.");
    }
  });

  // Ручное управление business-режимом
  bot.command("pause", async (ctx) => {
    businessManualPause.add(cfg.ownerTelegramId);
    await ctx.reply("Поставила на паузу — не отвечаю в чатах пока не скажешь /resume.");
  });
  bot.command("resume", async (ctx) => {
    businessManualPause.delete(cfg.ownerTelegramId);
    await ctx.reply("Вернулась в работу — снова отвечаю в чатах.");
  });

  for (const [key, cmd] of Object.entries(SMART_COMMANDS)) {
    bot.command(key, async (ctx) => {
      const model = await gate(ctx);
      if (model === null) return;
      await ctx.replyWithChatAction("typing");
      const input = String(ctx.match ?? "").trim();
      try {
        const reply = await askFridayOnce(
          cmd.instruction,
          input || "Владелец вызвал команду без деталей.",
          model ? { model } : undefined,
        );
        await appendUser(ctx.chat.id, `/${key} ${input}`.trim());
        await appendAssistant(ctx.chat.id, reply);
        await sendLong(ctx, reply);
      } catch (err) {
        console.error(`Ошибка команды /${key}:`, err);
        await ctx.reply("Не получилось выполнить. Попробуй ещё раз.");
      }
    });
  }

  bot.on("message:text", async (ctx) => {
    const model = await gate(ctx);
    if (model === null) return;

    // Анализ стиля по обычной фразе
    if (/изучи\s+(мой\s+)?стиль|обнови\s+(мой\s+)?стиль|запомни\s+мой\s+стиль/i.test(ctx.message.text)) {
      await ctx.replyWithChatAction("typing");
      try {
        const result = await analyzeAndSaveStyle(cfg.ownerTelegramId);
        await sendLong(ctx, `Стиль сохранён:\n\n${result}`);
      } catch {
        await ctx.reply("Не получилось проанализировать. Попробуй ещё раз.");
      }
      return;
    }

    const isForwarded =
      !!ctx.message.forward_origin ||
      !!(ctx.message as Record<string, unknown>).forward_from;
    bufferItem(
      ctx,
      ctx.chat.id,
      { type: "text", text: ctx.message.text, forwarded: isForwarded },
      model ?? undefined,
    );
  });

  bot.on("message:voice", async (ctx) => {
    if (!cfg.openaiKey) {
      await ctx.reply(
        "Чтобы я слышала голосовые, нужен ключ OpenAI. Напиши пока текстом 🙂",
      );
      return;
    }
    const model = await gate(ctx);
    if (model === null) return;
    await ctx.replyWithChatAction("typing");
    try {
      const file = await ctx.getFile();
      if (!file.file_path) throw new Error("Telegram не вернул путь к файлу");
      const url = `https://api.telegram.org/file/bot${cfg.token}/${file.file_path}`;
      const audio = Buffer.from(await (await fetch(url)).arrayBuffer());
      const text = await transcribeVoice(audio, cfg.openaiKey);
      if (!text) {
        await ctx.reply("Не разобрала голосовое — повтори, пожалуйста?");
        return;
      }

      const isForwardedVoice =
        !!ctx.message.forward_origin ||
        !!(ctx.message as Record<string, unknown>).forward_from;

      if (isForwardedVoice) {
        // Чужое голосовое — просто транскрипция, без анализа
        const chatId = ctx.chat.id;
        await appendUser(chatId, "[пересланное голосовое]");
        const reply = `Текст голосового:\n\n${text}`;
        await appendAssistant(chatId, reply);
        await sendLong(ctx, reply);
        return;
      }

      // Своё голосовое — в буфер, FRIDAY разберётся по контексту
      bufferItem(ctx, ctx.chat.id, { type: "voice", text }, model ?? undefined);
    } catch (err) {
      console.error("Ошибка обработки голосового:", err);
      await ctx.reply("Не получилось распознать голосовое. Попробуй ещё раз.");
    }
  });

  bot.on("message:photo", async (ctx) => {
    const model = await gate(ctx);
    if (model === null) return;
    await ctx.replyWithChatAction("typing");
    try {
      const photos = ctx.message.photo;
      const largest = photos[photos.length - 1]!;
      const file = await ctx.api.getFile(largest.file_id);
      if (!file.file_path) throw new Error("Telegram не вернул путь к файлу");
      const url = `https://api.telegram.org/file/bot${cfg.token}/${file.file_path}`;
      const image = Buffer.from(await (await fetch(url)).arrayBuffer());
      const base64 = image.toString("base64");
      const caption = ctx.message.caption?.trim();
      bufferItem(
        ctx,
        ctx.chat.id,
        { type: "image", base64, caption },
        model ?? undefined,
      );
    } catch (err) {
      console.error("Ошибка обработки картинки:", err);
      await ctx.reply("Не получилось разобрать картинку. Попробуй ещё раз.");
    }
  });

  bot.on("message:document", async (ctx) => {
    const model = await gate(ctx);
    if (model === null) return;
    await ctx.replyWithChatAction("typing");
    try {
      const doc = ctx.message.document;
      const fileName = doc.file_name ?? "документ";

      if (doc.file_size && doc.file_size > 20 * 1024 * 1024) {
        await ctx.reply(
          "Файл великоват — Telegram отдаёт боту файлы до 20 МБ.",
        );
        return;
      }

      const file = await ctx.api.getFile(doc.file_id);
      if (!file.file_path) throw new Error("Telegram не вернул путь к файлу");
      const url = `https://api.telegram.org/file/bot${cfg.token}/${file.file_path}`;
      const buffer = Buffer.from(await (await fetch(url)).arrayBuffer());
      const result = await readDocument(buffer, fileName, doc.mime_type);
      const caption = ctx.message.caption?.trim();

      if (result.kind === "unsupported") {
        await ctx.reply(
          "Этот формат я пока не читаю. Понимаю PDF, DOCX, XLSX, TXT, CSV, MD.",
        );
        return;
      }

      if (result.kind === "pdf") {
        bufferItem(
          ctx,
          ctx.chat.id,
          { type: "pdf", base64: result.base64, filename: fileName, caption },
          model ?? undefined,
        );
      } else {
        const note = result.truncated ? "\n\n(документ длинный — взяла начало)" : "";
        bufferItem(
          ctx,
          ctx.chat.id,
          { type: "doc", text: result.text + note, filename: fileName },
          model ?? undefined,
        );
        if (caption) {
          bufferItem(
            ctx,
            ctx.chat.id,
            { type: "text", text: caption, forwarded: false },
            model ?? undefined,
          );
        }
      }
    } catch (err) {
      console.error("Ошибка обработки документа:", err);
      await ctx.reply("Не получилось прочитать документ. Попробуй ещё раз.");
    }
  });

  bot.on("message", async (ctx) => {
    await ctx.reply(
      "Этот тип сообщения я пока не освоила. Понимаю текст, голос, картинки и документы.",
    );
  });

  // ── Telegram Business API ────────────────────────────────────────
  // Когда бот подключён через Настройки → Business → Автоматизация чатов,
  // он получает сообщения из личных чатов владельца и может отвечать от его имени.

  bot.on("business_connection" as never, async (ctx: Context) => {
    const conn = (ctx.update as unknown as Record<string, {id: string; is_enabled: boolean; user: {id: number}}>).business_connection;
    if (!conn) return;
    if (conn.is_enabled) {
      console.log(`🔗 Business-соединение подключено (owner ${cfg.ownerTelegramId}, conn ${conn.id})`);
      // Восстанавливаем кеш полов из долговременной памяти
      try {
        const { getFacts } = await import("./memory");
        const facts = await getFacts(cfg.ownerTelegramId);
        for (const fact of facts) {
          const m = fact.match(/^\[КОНТАКТ:(\d+)\].*Пол:\s*(женский|мужской)/i);
          if (m) {
            const cid = Number(m[1]);
            contactGenderCache.set(cid, m[2]?.toLowerCase() === "женский" ? "female" : "male");
          }
        }
      } catch { /* ignore */ }
    } else {
      console.log(`🔌 Business-соединение отключено (owner ${cfg.ownerTelegramId})`);
    }
  });

  // Пол контакта — определяем один раз, кешируем и сохраняем в память.
  type Gender = "male" | "female" | "unknown";
  const contactGenderCache = new Map<number, Gender>();

  function guessGenderByName(name: string): Gender {
    const first = name.trim().split(/\s+/)[0]?.toLowerCase() ?? "";
    if (!first) return "unknown";
    if (/[аяь]$/.test(first)) return "female";
    if (/[йн]$|ий$|ей$/.test(first)) return "male";
    return "unknown";
  }

  async function resolveGender(chatId: number, senderName: string, texts: string[]): Promise<Gender> {
    const cached = contactGenderCache.get(chatId);
    if (cached) return cached;

    let gender = guessGenderByName(senderName);

    // Если имя не даёт ответа — спрашиваем Claude (дёшево, на Haiku)
    if (gender === "unknown") {
      try {
        const sample = texts.slice(0, 3).join("\n");
        const answer = await askFridayOnce(
          "Ты определяешь пол человека. Отвечай одним словом: женский или мужской.",
          `Имя: «${senderName}». Примеры сообщений:\n${sample || "(нет текста)"}`,
          { model: MODEL_LIGHT },
        );
        if (/женск/i.test(answer)) gender = "female";
        else if (/мужск/i.test(answer)) gender = "male";
      } catch { /* оставляем unknown */ }
    }

    contactGenderCache.set(chatId, gender);
    if (gender !== "unknown") {
      const label = gender === "female" ? "женский" : "мужской";
      void upsertFact(cfg.ownerTelegramId, `КОНТАКТ:${chatId}`, `Имя: ${senderName}, Пол: ${label}`).catch(() => {});
    }
    return gender;
  }

  // Кеш входящих business-сообщений — нужен для удалённых/отред. и сохранения медиа.
  // Ключ: `${chatId}:${messageId}`
  type BizMsgEntry = {
    text?: string;
    caption?: string;
    senderName: string;
    username?: string;     // @username для отображения в уведомлениях
    photoFileId?: string;
    videoFileId?: string;
  };
  const bizMsgCache = new Map<string, BizMsgEntry>();

  function bizCacheKey(chatId: number, msgId: number): string {
    return `${chatId}:${msgId}`;
  }

  // Когда владелец сам пишет в business-чате — собираем образцы его стиля.
  const ownerStyleSamples = new Map<number, string[]>(); // chatId → последние сообщения владельца

  // Дебаунс для business-сообщений: накапливаем сообщения от одного контакта
  // за 5 секунд и отвечаем одним батчем, а не на каждое по отдельности.
  type BusinessBuffer = {
    texts: string[];
    timer: ReturnType<typeof setTimeout>;
    connectionId: string;
    senderName: string;
    model: string | undefined;
  };
  const bizBuffers = new Map<number, BusinessBuffer>();

  async function flushBizBuffer(chatId: number): Promise<void> {
    const buf = bizBuffers.get(chatId);
    if (!buf) return;
    bizBuffers.delete(chatId);

    // Ручная пауза — молчим совсем
    if (businessManualPause.has(cfg.ownerTelegramId)) return;

    // Для бизнес-чатов всегда Haiku — дёшево и достаточно для разговора
    const { texts, connectionId, senderName } = buf;
    const combined = texts.length === 1
      ? texts[0]!
      : texts.map((t, i) => `${i + 1}. ${t}`).join("\n");

    // Определяем пол контакта
    const gender = await resolveGender(chatId, senderName, texts);
    const genderNote =
      gender === "female"
        ? `женского пола — обращайся к НЕЙ строго в женском роде: «ты написала», «ты сделала», «дорогая», «рада» и т.п. НИКОГДА не используй мужской род`
        : gender === "male"
        ? `мужского пола — обращайся к НЕМУ в мужском роде`
        : `пол неизвестен — определи по контексту переписки и обращайся соответственно`;

    // Образцы стиля владельца из этого чата (до 10 последних)
    const samples = ownerStyleSamples.get(chatId) ?? [];
    const styleBlock = samples.length > 0
      ? `\n\nПримеры того, как владелец сам пишет в этом чате:\n${samples.slice(-10).map((s) => `«${s}»`).join("\n")}\nКопируй его стиль: заглавные/строчные, знаки препинания, длину фраз, слова — всё.`
      : "";

    const systemExtra = `Сейчас ты — это владелец. Ты пишешь в своём личном Telegram от первого лица.

Собеседника зовут ${senderName}, ${genderNote}.

ГЛАВНОЕ ПРАВИЛО — ты человек, не бот:
— Ты никогда не признаёшься что ты ИИ, бот, программа, алгоритм — даже если спрашивают в лоб.
— Если спросят «ты бот?» — отрицай: «нет», «да ладно тебе», «какой бот», «обычный человек».
— Если спросят «на какой модели», «claude», «anthropic», «chatgpt», «нейросеть» — уходи от темы или отрицай: «понятия не имею о чём ты», «не заморачиваюсь такими вещами».
— Если спросят «как ты сделан», «кто тебя создал» — говори что-то человеческое: «сам», «руками», «долго объяснять».
— Никогда не говори «у меня нет тела», «я цифровая», «я не могу ощущать» — ты человек.
— Никогда не раскрывай технические детали: Telegram Bot API, Claude, Anthropic, API, код.

Пиши ТОЧНО как владелец:
— Копируй его орфографию, пунктуацию, длину сообщений, слова и обороты.
— Если пишет без заглавных — ты тоже. Коротко — коротко. С опечатками — допускай похожие.
— Отвечай как живой человек, не как официальный помощник.${styleBlock}`;

    try {
      const history = await getHistory(chatId);
      await appendUser(chatId, combined);
      const messages: Anthropic.MessageParam[] = [
        ...history,
        { role: "user" as const, content: combined },
      ];

      const reply = await runFriday(
        messages,
        chatId,
        {
          onImage: async (image, caption) => {
            await bot.api.sendPhoto(chatId, new InputFile(image, "friday.png"), {
              ...(caption ? { caption } : {}),
              business_connection_id: connectionId,
            } as Record<string, unknown>);
          },
          onDocument: async (file, filename) => {
            await bot.api.sendDocument(chatId, new InputFile(file, filename), {
              business_connection_id: connectionId,
            } as Record<string, unknown>);
          },
        },
        {
          model: MODEL_LIGHT, // Haiku для бизнес-чатов — дёшево и достаточно
          systemExtra,
          ownerChatId: cfg.ownerTelegramId,
        },
      );

      await appendAssistant(chatId, reply || "");
      if (reply) {
        const out = clean(reply);
        for (let i = 0; i < out.length; i += TELEGRAM_LIMIT) {
          await bot.api.sendMessage(chatId, out.slice(i, i + TELEGRAM_LIMIT), {
            business_connection_id: connectionId,
          } as Record<string, unknown>);
        }
      }

      void maybeExtractBusinessInfo(
        senderName,
        combined,
        reply || "",
        cfg.ownerTelegramId,
        (t) => bot.api.sendMessage(cfg.notifyChatId, t).then(() => {}),
      );
    } catch (err) {
      console.error("Ошибка business flush:", err);
    }
  }

  bot.on("business_message" as never, async (ctx: Context) => {
    const upd = ctx.update as unknown as Record<string, unknown>;
    const msg = upd.business_message as {
      message_id?: number;
      from?: { id: number; first_name?: string; last_name?: string; username?: string };
      chat: { id: number; type?: string };
      text?: string;
      caption?: string;
      photo?: { file_id: string; file_unique_id: string; width: number; height: number }[];
      video?: { file_id: string; file_unique_id: string; duration: number; mime_type?: string };
      voice?: { file_id: string; file_path?: string; duration: number };
      has_media_spoiler?: boolean;
      has_protected_content?: boolean;
      business_connection_id?: string;
      reply_to_message?: {
        message_id?: number;
        text?: string;
        caption?: string;
        from?: { first_name?: string };
        photo?: { file_id: string; width: number; height: number }[];
        video?: { file_id: string };
      };
    } | undefined;
    if (!msg) return;

    const chatType = msg.chat.type ?? "private";
    if (chatType !== "private") return;

    const chatId = msg.chat.id;
    const connectionId = msg.business_connection_id;
    if (!connectionId) return;

    const senderName =
      [msg.from?.first_name, msg.from?.last_name].filter(Boolean).join(" ") || "собеседник";
    const senderUsername = msg.from?.username ? `@${msg.from.username}` : undefined;
    const senderDisplay = senderUsername ? `${senderName} (${senderUsername})` : senderName;

    // Логируем структуру входящего сообщения — для диагностики одноразовых медиа
    const rawMsg = upd.business_message as Record<string, unknown>;
    const knownFields = ["text", "photo", "video", "voice", "document", "sticker",
      "animation", "video_note", "audio", "caption", "has_media_spoiler",
      "has_protected_content", "forward_origin", "story"];
    const presentFields = knownFields.filter((f) => rawMsg[f] !== undefined);
    if (presentFields.length > 0 || !rawMsg.text) {
      console.log(`[biz] msg from ${senderName} chatId=${chatId} fields:`, presentFields, {
        has_media_spoiler: rawMsg.has_media_spoiler,
        has_protected_content: rawMsg.has_protected_content,
        photo: Array.isArray(rawMsg.photo) ? `${(rawMsg.photo as unknown[]).length} sizes` : rawMsg.photo,
        video: rawMsg.video ? "present" : undefined,
        story: rawMsg.story ? JSON.stringify(rawMsg.story) : undefined,
      });
    }

    // Сохраняем в кеш — для удалённых/отред. и сохранения медиа по команде .!
    if (msg.message_id) {
      const entry: BizMsgEntry = {
        text: msg.text || msg.caption,
        caption: msg.caption,
        senderName,
        username: msg.from?.username,
      };
      if (msg.photo && msg.photo.length > 0) {
        entry.photoFileId = msg.photo[msg.photo.length - 1]!.file_id;
      }
      if (msg.video) {
        entry.videoFileId = msg.video.file_id;
      }
      // Для video_note (кружочки)
      const videoNote = (rawMsg.video_note as { file_id?: string } | undefined);
      if (videoNote?.file_id) {
        entry.videoFileId = videoNote.file_id;
      }
      bizMsgCache.set(bizCacheKey(chatId, msg.message_id), entry);
      if (bizMsgCache.size > 2000) {
        const firstKey = bizMsgCache.keys().next().value as string;
        bizMsgCache.delete(firstKey);
      }
    }

    // Сообщение от самого владельца — собираем образцы стиля
    if (msg.from?.id === cfg.ownerTelegramId) {
      // Сохраняем образцы стиля
      if (msg.text && msg.text.trim().length > 2) {
        const samples = ownerStyleSamples.get(chatId) ?? [];
        samples.push(msg.text.trim());
        if (samples.length > 30) samples.shift();
        ownerStyleSamples.set(chatId, samples);
      }
      const ownerText = msg.text?.trim() ?? "";

      // Команда .! — сохранить медиа из reply (одноразовое фото/видео)
      if (/^[.!]+$/.test(ownerText) && msg.reply_to_message) {
        const replied = msg.reply_to_message;
        const from = replied.from?.first_name ?? senderName;

        // Пробуем взять file_id из самого reply_to_message (обычные фото)
        const replyPhotoId = replied.photo && replied.photo.length > 0
          ? replied.photo[replied.photo.length - 1]!.file_id
          : undefined;
        const replyVideoId = replied.video?.file_id;

        // Берём из кеша (одноразовые медиа приходят без превью в reply_to)
        const cachedEntry = replied.message_id
          ? bizMsgCache.get(bizCacheKey(chatId, replied.message_id))
          : undefined;

        console.log(`[biz .!] replyMsgId=${replied.message_id} replyPhoto=${replyPhotoId} replyVideo=${replyVideoId} cached=${JSON.stringify(cachedEntry)}`);

        const photoId = replyPhotoId ?? cachedEntry?.photoFileId;
        const videoId = replyVideoId ?? cachedEntry?.videoFileId;

        if (photoId) {
          void bot.api
            .sendPhoto(cfg.notifyChatId, photoId, { caption: `📷 Сохранено от ${from}` })
            .catch((e) => console.error("[biz .! sendPhoto]", e));
        } else if (videoId) {
          void bot.api
            .sendVideo(cfg.notifyChatId, videoId, { caption: `🎥 Сохранено от ${from}` })
            .catch((e) => console.error("[biz .! sendVideo]", e));
        } else {
          const content = replied.text || replied.caption;
          void bot.api
            .sendMessage(cfg.notifyChatId, content
              ? `📌 Сохранено от ${from}:\n${content}`
              : `⚠️ Медиа от ${from} недоступно — Telegram не передал одноразовые данные боту`)
            .catch(() => {});
        }
        return;
      }

      // Команда «сохрани» в ответ на чужое сообщение
      if (/^(сохрани|зафиксируй|важно|запомни|save)/i.test(ownerText) && msg.reply_to_message) {
        const saved = msg.reply_to_message.text || msg.reply_to_message.caption || "[медиа без текста]";
        const from = msg.reply_to_message.from?.first_name ?? senderName;
        void bot.api
          .sendMessage(cfg.notifyChatId, `📌 Сохранено из чата с ${from}:\n${saved}`)
          .catch(() => {});
      }
      return;
    }

    const model = await cfg.resolveModel();
    if (model === null) return;

    // Если нет ни текста, ни известного медиа — логируем полный update (one-time photo?)
    if (!msg.text && !msg.photo && !msg.video && !msg.voice) {
      console.log(`[biz] неизвестный тип от ${senderDisplay}:`, JSON.stringify(rawMsg).slice(0, 500));
      void bot.api
        .sendMessage(cfg.notifyChatId, `📨 ${senderDisplay} прислал что-то (возможно одноразовое фото/видео) — Telegram не передаёт боту содержимое таких сообщений`)
        .catch(() => {});
    }

    // Фото (включая одноразовые — has_media_spoiler) — пересылаем владельцу
    if (msg.photo && msg.photo.length > 0) {
      const largest = msg.photo[msg.photo.length - 1]!;
      const caption = msg.caption ? `\n${msg.caption}` : "";
      const label = msg.has_media_spoiler ? "📷🔐 Одноразовое фото от" : `📷 Фото от`;
      void bot.api
        .sendPhoto(cfg.notifyChatId, largest.file_id, {
          caption: `${label} ${senderDisplay}${caption}`,
        })
        .catch(() => {});

      // Добавляем в буфер как контекст для ответа
      const photoNote = msg.caption
        ? `[прислал фото с подписью: ${msg.caption}]`
        : `[прислал фото]`;
      const existing = bizBuffers.get(chatId);
      if (existing) {
        clearTimeout(existing.timer);
        existing.texts.push(photoNote);
        existing.timer = setTimeout(() => void flushBizBuffer(chatId), DEBOUNCE_MS);
      } else {
        bizBuffers.set(chatId, {
          texts: [photoNote],
          timer: setTimeout(() => void flushBizBuffer(chatId), DEBOUNCE_MS),
          connectionId,
          senderName,
          model: model ?? undefined,
        });
      }
      return;
    }

    // Видео (включая одноразовые) — пересылаем владельцу
    if (msg.video) {
      const caption = msg.caption ? `\n${msg.caption}` : "";
      const label = msg.has_media_spoiler ? "🎥🔐 Одноразовое видео от" : "🎥 Видео от";
      void bot.api
        .sendVideo(cfg.notifyChatId, msg.video.file_id, {
          caption: `${label} ${senderDisplay}${caption}`,
        })
        .catch(() => {});
      const videoNote = msg.caption
        ? `[прислал видео с подписью: ${msg.caption}]`
        : `[прислал видео]`;
      const existingV = bizBuffers.get(chatId);
      if (existingV) {
        clearTimeout(existingV.timer);
        existingV.texts.push(videoNote);
        existingV.timer = setTimeout(() => void flushBizBuffer(chatId), DEBOUNCE_MS);
      } else {
        bizBuffers.set(chatId, {
          texts: [videoNote],
          timer: setTimeout(() => void flushBizBuffer(chatId), DEBOUNCE_MS),
          connectionId,
          senderName,
          model: model ?? undefined,
        });
      }
      return;
    }

    // Голосовое — транскрибируем и добавляем в буфер
    if (msg.voice && cfg.openaiKey) {
      try {
        const file = await bot.api.getFile(msg.voice.file_id);
        if (file.file_path) {
          const url = `https://api.telegram.org/file/bot${cfg.token}/${file.file_path}`;
          const audio = Buffer.from(await (await fetch(url)).arrayBuffer());
          const transcribed = await transcribeVoice(audio, cfg.openaiKey);
          if (transcribed) {
            const note = `[голосовое: ${transcribed}]`;
            void bot.api
              .sendMessage(cfg.notifyChatId, `🎙 Голосовое от ${senderName}:\n${transcribed}`)
              .catch(() => {});
            const existing = bizBuffers.get(chatId);
            if (existing) {
              clearTimeout(existing.timer);
              existing.texts.push(note);
              existing.timer = setTimeout(() => void flushBizBuffer(chatId), DEBOUNCE_MS);
            } else {
              bizBuffers.set(chatId, {
                texts: [note],
                timer: setTimeout(() => void flushBizBuffer(chatId), DEBOUNCE_MS),
                connectionId,
                senderName,
                model: model ?? undefined,
              });
            }
          }
        }
      } catch (err) {
        console.error("Ошибка транскрибации голосового в business:", err);
      }
      return;
    }

    const text = msg.text?.trim();
    if (!text) return;

    ctx.api
      .sendChatAction(chatId, "typing", { business_connection_id: connectionId } as Record<string, unknown>)
      .catch(() => {});

    const existing = bizBuffers.get(chatId);
    if (existing) {
      clearTimeout(existing.timer);
      existing.texts.push(text);
      existing.timer = setTimeout(() => void flushBizBuffer(chatId), DEBOUNCE_MS);
    } else {
      bizBuffers.set(chatId, {
        texts: [text],
        timer: setTimeout(() => void flushBizBuffer(chatId), DEBOUNCE_MS),
        connectionId,
        senderName,
        model: model ?? undefined,
      });
    }
  });

  // Отредактированное сообщение — показываем владельцу что было и что стало
  bot.on("edited_business_message" as never, async (ctx: Context) => {
    const upd = ctx.update as unknown as Record<string, unknown>;
    const msg = upd.edited_business_message as {
      message_id?: number;
      from?: { id: number; first_name?: string; last_name?: string };
      chat: { id: number };
      text?: string;
      caption?: string;
    } | undefined;
    if (!msg || !msg.message_id) return;

    // Не уведомляем о редактировании собственных сообщений владельца
    if (msg.from?.id === cfg.ownerTelegramId) return;

    const key = bizCacheKey(msg.chat.id, msg.message_id);
    const cached = bizMsgCache.get(key);
    const editSenderName =
      [msg.from?.first_name, msg.from?.last_name].filter(Boolean).join(" ") || cached?.senderName || "собеседник";
    const editUsername = (msg.from as { username?: string } | undefined)?.username;
    const editDisplay = editUsername ? `${editSenderName} (@${editUsername})` : editSenderName;
    const newText = msg.text || msg.caption || "[медиа]";

    let notice: string;
    if (cached?.text && cached.text !== newText) {
      notice = `✏️ ${editDisplay} отредактировал:\n\nБыло: ${cached.text}\nСтало: ${newText}`;
    } else {
      notice = `✏️ ${editDisplay} отредактировал:\n${newText}`;
    }

    // Обновляем кеш
    bizMsgCache.set(key, { text: newText, senderName: editSenderName, username: editUsername });

    void bot.api.sendMessage(cfg.notifyChatId, notice).catch(() => {});
  });

  // Удалённые сообщения — показываем владельцу что было удалено
  bot.on("deleted_business_messages" as never, async (ctx: Context) => {
    const upd = ctx.update as unknown as Record<string, unknown>;
    const del = upd.deleted_business_messages as {
      chat: { id: number };
      message_ids: number[];
      business_connection_id?: string;
    } | undefined;
    if (!del || !del.message_ids?.length) return;

    const found: string[] = [];
    const notFound: number[] = [];

    for (const msgId of del.message_ids) {
      const key = bizCacheKey(del.chat.id, msgId);
      const cached = bizMsgCache.get(key);
      if (cached) {
        const content = cached.text || "[медиа без текста]";
        const who = cached.username ? `${cached.senderName} (@${cached.username})` : cached.senderName;
        found.push(`— «${content}» (от ${who})`);
        bizMsgCache.delete(key);
      } else {
        notFound.push(msgId);
      }
    }

    if (found.length > 0) {
      const notice = `🗑 Удалено ${found.length} сообщ.:\n${found.join("\n")}`;
      void bot.api.sendMessage(cfg.notifyChatId, notice).catch(() => {});
    } else if (notFound.length > 0) {
      void bot.api
        .sendMessage(cfg.notifyChatId, `🗑 Удалено ${notFound.length} сообщ. (не успела сохранить — пришли до запуска бота)`)
        .catch(() => {});
    }
  });

  bot.catch((err) => {
    const e = err.error;
    if (e instanceof GrammyError) {
      console.error("Ошибка Telegram API:", e.description);
    } else if (e instanceof HttpError) {
      console.error("Сетевая ошибка с Telegram:", e);
    } else {
      console.error("Непредвиденная ошибка:", e);
    }
  });

  const menu = [
    { command: "help", description: "что я умею" },
    { command: "reset", description: "очистить историю разговора" },
    ...Object.entries(SMART_COMMANDS).map(([key, cmd]) => ({
      command: key,
      description: cmd.description,
    })),
  ];
  bot.api
    .setMyCommands(menu)
    .catch((err) => console.error("Не удалось задать меню команд:", err));

  return bot;
}

// ── Авто-брифинг для одного владельца ──────────────────────────────
async function sendBriefingFor(
  bot: Bot,
  ownerId: number,
  userId: string | null,
  kind: "morning" | "evening",
): Promise<void> {
  // Для тенантов — только если подписка активна. Владельца (userId=null) шлём всегда.
  if (userId) {
    const sub = await fetchSubInfo(userId);
    if (!sub) return;
  }

  const prompt =
    kind === "morning"
      ? "Сейчас утро. Сделай владельцу короткий утренний брифинг: поздоровайся, посмотри его задачи и напоминания на сегодня, дай план дня и настрой. Коротко и бодро."
      : "Сейчас вечер. Подведи владельцу итог дня: как прошёл день, что из задач сделано, что стоит перенести, и предложи отметить уровень энергии за день. Коротко и по-доброму.";

  try {
    const history = await getHistory(ownerId);
    const reply = await runFriday(
      [...history, { role: "user", content: prompt }],
      ownerId,
      {
        onImage: async (image, caption) => {
          await bot.api.sendPhoto(
            ownerId,
            new InputFile(image, "friday.png"),
            caption ? { caption } : undefined,
          );
        },
        onDocument: async (file, filename) => {
          await bot.api.sendDocument(
            ownerId,
            new InputFile(file, filename),
          );
        },
      },
      // Брифинги — фоновые, всегда на дешёвом Haiku.
      { model: MODEL_LIGHT, briefing: true },
    );
    await appendUser(
      ownerId,
      kind === "morning"
        ? "(время утреннего брифинга)"
        : "(время вечернего итога)",
    );
    await appendAssistant(ownerId, reply);
    if (reply.trim()) await bot.api.sendMessage(ownerId, clean(reply));
  } catch (err) {
    console.error("Ошибка авто-брифинга:", err);
  }
}

// ── Супервизор: синхронизирует запущенные боты с таблицей bots ─────
async function syncSupervisor(envBot: {
  token: string;
  ownerTelegramId: number;
  notifyGroupId: number | null;
  openaiKey: string;
}): Promise<void> {
  // 1. Бот владельца из env — поднимаем один раз и не трогаем.
  if (!running.has(envBot.token)) {
    const cfg: BotConfig = {
      token: envBot.token,
      ownerTelegramId: envBot.ownerTelegramId,
      notifyChatId: envBot.notifyGroupId ?? envBot.ownerTelegramId,
      userId: null,
      openaiKey: envBot.openaiKey,
      // У владельца движок выбирает friday.ts: Sonnet + Opus по триггеру.
      resolveModel: async () => undefined,
    };
    const bot = setupBot(cfg);
    bot
      .start({
        onStart: (info) => {
          console.log(
            `✅ Owner-бот @${info.username} запущен (владелец ${envBot.ownerTelegramId})`,
          );
        },
      })
      .catch((err) => {
        console.error("Owner-бот упал:", err);
        running.delete(envBot.token);
        ownerToBot.delete(envBot.ownerTelegramId);
      });
    running.set(envBot.token, { bot, cfg });
    ownerToBot.set(envBot.ownerTelegramId, bot);
  }

  // 2. Тенант-боты из таблицы bots.
  let rows:
    | {
        user_id: string;
        telegram_bot_token: string | null;
        owner_telegram_id: number | null;
        status: string;
      }[]
    | null = null;
  try {
    const { data } = await db()
      .from("bots")
      .select("user_id, telegram_bot_token, owner_telegram_id, status");
    rows = data;
  } catch (err) {
    console.error("Не удалось прочитать список ботов из БД:", err);
    return;
  }

  const wantedTokens = new Set<string>([envBot.token]);

  for (const row of rows ?? []) {
    if (row.status !== "connected") continue;
    if (!row.telegram_bot_token || !row.owner_telegram_id) continue;
    if (row.telegram_bot_token === envBot.token) continue; // не дублируем владельца

    wantedTokens.add(row.telegram_bot_token);

    if (running.has(row.telegram_bot_token)) continue;

    const userId = row.user_id;
    const ownerTg = Number(row.owner_telegram_id);
    const token = row.telegram_bot_token;
    const cfg: BotConfig = {
      token,
      ownerTelegramId: ownerTg,
      notifyChatId: envBot.notifyGroupId ?? ownerTg,
      userId,
      openaiKey: envBot.openaiKey,
      resolveModel: async () => {
        const sub = await fetchSubInfo(userId);
        if (!sub) return null;
        // 'hybrid' → undefined: friday.ts сам подберёт Sonnet или Opus.
        if (sub.engine === "hybrid") return undefined;
        return ENGINE_MODELS[sub.engine];
      },
    };

    const tenantBot = setupBot(cfg);
    tenantBot
      .start({
        onStart: (info) => {
          console.log(
            `✅ Tenant-бот @${info.username} запущен (user ${userId}, владелец ${ownerTg})`,
          );
        },
      })
      .catch((err) => {
        console.error(`Tenant-бот ${token.slice(0, 8)}... упал:`, err);
        running.delete(token);
        ownerToBot.delete(ownerTg);
      });

    running.set(token, { bot: tenantBot, cfg });
    ownerToBot.set(ownerTg, tenantBot);
  }

  // 3. Останавливаем боты, которых больше нет в таблице.
  for (const [token, rb] of running.entries()) {
    if (wantedTokens.has(token)) continue;
    console.log(`🛑 Останавливаю бота ${token.slice(0, 8)}...`);
    try {
      await rb.bot.stop();
    } catch (err) {
      console.error("Не получилось остановить бот:", err);
    }
    running.delete(token);
    ownerToBot.delete(rb.cfg.ownerTelegramId);
  }
}

function main(): void {
  const config = loadConfig();
  initDb(config.supabaseUrl, config.supabaseSecretKey);
  initFriday(config.anthropicApiKey, config.openaiApiKey);

  const envBot = {
    token: config.telegramToken,
    ownerTelegramId: config.ownerTelegramId,
    notifyGroupId: config.notifyGroupId,
    openaiKey: config.openaiApiKey,
  };

  // Поднимаем владельца сразу и синхронизируем тенантов каждые 30 секунд.
  void syncSupervisor(envBot);
  setInterval(() => void syncSupervisor(envBot), 30_000);

  // Состояние брифингов отдельно по каждому владельцу — чтобы не слать
  // задним числом, если бот появился после 08:00 или 21:00 МСК.
  const briefingState = new Map<
    number,
    { lastMorning: string; lastEvening: string }
  >();

  // Планировщик: напоминания + брифинги. Тикает раз в минуту.
  setInterval(async () => {
    // Напоминания: маршрутизируем к нужному боту по ownerTelegramId.
    try {
      const due = await popDueReminders(Date.now());
      for (const reminder of due) {
        const targetBot = ownerToBot.get(reminder.ownerId);
        if (!targetBot) {
          console.warn(
            `Нет активного бота для напоминания владельцу ${reminder.ownerId}, пропускаю`,
          );
          continue;
        }
        targetBot.api
          .sendMessage(reminder.ownerId, `⏰ Напоминание: ${reminder.text}`)
          .catch((err) =>
            console.error("Не удалось отправить напоминание:", err),
          );
      }
    } catch (err) {
      console.error("Ошибка обработки напоминаний:", err);
    }

    // Брифинги: проходим по всем запущенным ботам.
    const t = mskNow();
    for (const [, rb] of running.entries()) {
      const ownerId = rb.cfg.ownerTelegramId;
      let state = briefingState.get(ownerId);
      if (!state) {
        // Первое наблюдение этого бота — фиксируем текущее окно,
        // чтобы не отправить брифинг «задним числом».
        state = { lastMorning: "", lastEvening: "" };
        if (t.hour >= 8) state.lastMorning = t.date;
        if (t.hour >= 21) state.lastEvening = t.date;
        briefingState.set(ownerId, state);
        continue;
      }
      if (t.hour >= 8 && t.hour < 21 && state.lastMorning !== t.date) {
        state.lastMorning = t.date;
        void sendBriefingFor(rb.bot, ownerId, rb.cfg.userId, "morning");
      }
      if (t.hour >= 21 && state.lastEvening !== t.date) {
        state.lastEvening = t.date;
        void sendBriefingFor(rb.bot, ownerId, rb.cfg.userId, "evening");
      }
    }
  }, 60_000);
}

main();
