import {
  Bot,
  GrammyError,
  HttpError,
  InputFile,
  type Context,
} from "grammy";
import { loadConfig } from "./config";
import { initFriday, runFriday, askFridayOnce, MODEL_LIGHT } from "./friday";
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
import { initDb } from "./db";
import { SMART_COMMANDS } from "./commands";

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

// Общая обработка запроса — для текста и для расшифрованного голоса.
async function handleText(
  ctx: Context,
  chatId: number,
  text: string,
): Promise<void> {
  const history = await getHistory(chatId);
  await appendUser(chatId, text);
  // Текущее сообщение добавляем явно — на случай, если история не подгрузилась.
  const messages = [...history, { role: "user" as const, content: text }];

  let produced = false;
  const reply = await runFriday(messages, chatId, {
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
  });

  await appendAssistant(
    chatId,
    reply || (produced ? "[отправила файл]" : "Готово."),
  );

  if (reply) await sendLong(ctx, reply);
  else if (!produced) await ctx.reply("Готово.");
}

function main(): void {
  const config = loadConfig();
  initDb(config.supabaseUrl, config.supabaseSecretKey);
  initFriday(config.anthropicApiKey, config.openaiApiKey);

  const bot = new Bot(config.telegramToken);

  // Замок безопасности — строго первым.
  bot.use(createOwnerGuard(config.ownerTelegramId));

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

  // Команды-кнопки — необязательные ярлыки. Основной способ — обычная речь.
  for (const [key, cmd] of Object.entries(SMART_COMMANDS)) {
    bot.command(key, async (ctx) => {
      await ctx.replyWithChatAction("typing");
      const input = String(ctx.match ?? "").trim();
      try {
        const reply = await askFridayOnce(
          cmd.instruction,
          input || "Владелец вызвал команду без деталей.",
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

  // Текстовые сообщения — всё уходит движку, он сам понимает намерение.
  bot.on("message:text", async (ctx) => {
    await ctx.replyWithChatAction("typing");
    try {
      await handleText(ctx, ctx.chat.id, ctx.message.text);
    } catch (err) {
      console.error("Ошибка обработки текста:", err);
      await ctx.reply("Что-то сбойнуло на моей стороне. Попробуй ещё раз.");
    }
  });

  // Голосовые — распознаём через Whisper и обрабатываем как обычное сообщение.
  bot.on("message:voice", async (ctx) => {
    if (!config.openaiApiKey) {
      await ctx.reply(
        "Чтобы я слышала голосовые, нужен ключ OpenAI. Напиши пока текстом 🙂",
      );
      return;
    }
    await ctx.replyWithChatAction("typing");
    try {
      const file = await ctx.getFile();
      if (!file.file_path) throw new Error("Telegram не вернул путь к файлу");
      const url = `https://api.telegram.org/file/bot${config.telegramToken}/${file.file_path}`;
      const audio = Buffer.from(await (await fetch(url)).arrayBuffer());

      const text = await transcribeVoice(audio, config.openaiApiKey);
      if (!text) {
        await ctx.reply("Не разобрала голосовое — повтори, пожалуйста?");
        return;
      }

      await ctx.replyWithChatAction("typing");
      await handleText(ctx, ctx.chat.id, text);
    } catch (err) {
      console.error("Ошибка обработки голосового:", err);
      await ctx.reply("Не получилось распознать голосовое. Попробуй ещё раз.");
    }
  });

  // Картинки — анализируем через зрение Claude.
  bot.on("message:photo", async (ctx) => {
    await ctx.replyWithChatAction("typing");
    try {
      const photos = ctx.message.photo;
      const largest = photos[photos.length - 1]!;
      const file = await ctx.api.getFile(largest.file_id);
      if (!file.file_path) throw new Error("Telegram не вернул путь к файлу");
      const url = `https://api.telegram.org/file/bot${config.telegramToken}/${file.file_path}`;
      const image = Buffer.from(await (await fetch(url)).arrayBuffer());
      const base64 = image.toString("base64");

      const caption = ctx.message.caption?.trim();
      const prompt =
        caption ||
        "Посмотри на изображение: опиши, что на нём, и оцени — что хорошо, а что можно улучшить.";

      const reply = await askFridayOnce("", [
        {
          type: "image",
          source: { type: "base64", media_type: "image/jpeg", data: base64 },
        },
        { type: "text", text: prompt },
      ]);

      await appendUser(
        ctx.chat.id,
        `[прислал изображение] ${caption ?? ""}`.trim(),
      );
      await appendAssistant(ctx.chat.id, reply);
      await sendLong(ctx, reply);
    } catch (err) {
      console.error("Ошибка обработки картинки:", err);
      await ctx.reply("Не получилось разобрать картинку. Попробуй ещё раз.");
    }
  });

  // Документы — читаем PDF / DOCX / XLSX / текст и разбираем.
  bot.on("message:document", async (ctx) => {
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
      const url = `https://api.telegram.org/file/bot${config.telegramToken}/${file.file_path}`;
      const buffer = Buffer.from(await (await fetch(url)).arrayBuffer());

      const result = await readDocument(buffer, fileName, doc.mime_type);
      const task =
        ctx.message.caption?.trim() ||
        "Изучи документ: кратко перескажи суть и главное, что в нём.";

      if (result.kind === "unsupported") {
        await ctx.reply(
          "Этот формат я пока не читаю. Понимаю PDF, DOCX, XLSX, TXT, CSV, MD.",
        );
        return;
      }

      let reply: string;
      if (result.kind === "pdf") {
        reply = await askFridayOnce("", [
          {
            type: "document",
            source: {
              type: "base64",
              media_type: "application/pdf",
              data: result.base64,
            },
          },
          { type: "text", text: task },
        ]);
      } else {
        const note = result.truncated
          ? "\n\n(документ длинный — взяла начало)"
          : "";
        reply = await askFridayOnce(
          "",
          `Документ «${fileName}»:\n\n${result.text}${note}\n\n---\nЗадание: ${task}`,
        );
      }

      await appendUser(
        ctx.chat.id,
        `[прислал документ: ${fileName}] ${ctx.message.caption ?? ""}`.trim(),
      );
      await appendAssistant(ctx.chat.id, reply);
      await sendLong(ctx, reply);
    } catch (err) {
      console.error("Ошибка обработки документа:", err);
      await ctx.reply("Не получилось прочитать документ. Попробуй ещё раз.");
    }
  });

  // Остальные типы сообщений.
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

  // Меню команд в интерфейсе Telegram.
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

  // Авто-брифинг: генерирует и шлёт владельцу утренний план или вечерний итог.
  async function sendBriefing(kind: "morning" | "evening"): Promise<void> {
    const ownerId = config.ownerTelegramId;
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
        // Брифинги — фоновые, используют дешёвый Haiku, инструменты включены.
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

  // Если бот стартует уже после времени брифинга — не шлём задним числом.
  let lastMorning = "";
  let lastEvening = "";
  {
    const t = mskNow();
    if (t.hour >= 8) lastMorning = t.date;
    if (t.hour >= 21) lastEvening = t.date;
  }

  // Планировщик: напоминания + авто-брифинги, проверка раз в минуту.
  setInterval(async () => {
    for (const reminder of await popDueReminders(Date.now())) {
      bot.api
        .sendMessage(reminder.ownerId, `⏰ Напоминание: ${reminder.text}`)
        .catch((err) =>
          console.error("Не удалось отправить напоминание:", err),
        );
    }

    const t = mskNow();
    if (t.hour >= 8 && t.hour < 21 && lastMorning !== t.date) {
      lastMorning = t.date;
      void sendBriefing("morning");
    }
    if (t.hour >= 21 && lastEvening !== t.date) {
      lastEvening = t.date;
      void sendBriefing("evening");
    }
  }, 60_000);

  bot.start({
    onStart: (info) => {
      console.log(`✅ F.R.I.D.A.Y запущена — @${info.username}`);
      console.log(
        `   Отвечает только владельцу (ID ${config.ownerTelegramId})`,
      );
      console.log(
        `   Голос: ${config.openaiApiKey ? "включён" : "выключен (нет ключа OpenAI)"}`,
      );
    },
  });
}

main();
