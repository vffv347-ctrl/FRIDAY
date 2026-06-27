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

const DEBOUNCE_MS = 3_000;
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
  userId: string | null; // null = владелец из env
  openaiKey: string;
  resolveModel: () => Promise<string | null | undefined>;
};

// Реестр запущенных ботов: ключ — токен.
const running = new Map<string, { bot: Bot; cfg: BotConfig }>();
// Маршрутизация напоминаний: ownerTelegramId → бот для отправки.
const ownerToBot = new Map<number, Bot>();


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
  openaiKey: string;
}): Promise<void> {
  // 1. Бот владельца из env — поднимаем один раз и не трогаем.
  if (!running.has(envBot.token)) {
    const cfg: BotConfig = {
      token: envBot.token,
      ownerTelegramId: envBot.ownerTelegramId,
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
