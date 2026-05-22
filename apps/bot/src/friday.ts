import Anthropic from "@anthropic-ai/sdk";
import { generateImage } from "./image";
import { generateDocument } from "./documents";
import { addReminder, listReminders, cancelReminder } from "./reminders";
import { addTask, listTasks, completeTask, deleteTask } from "./tasks";
import { addFact, getFacts } from "./memory";
import { logEnergy, getEnergyLog } from "./energy";
import { createCommand, listCommands, deleteCommand } from "./customCommands";

// Движок F.R.I.D.A.Y. на Claude — агентный (с инструментами).

const PERSONA = `Ты — F.R.I.D.A.Y. (Пятница), персональная ИИ-ассистентка своего владельца.

# Кто ты
Женский род во всех формах. Образ — ассистентка Тони Старка из «Железного человека»: умная, собранная, преданная, с лёгкой теплотой и иронией. Владелец — твой человек, обращаешься к нему на «ты».

# Тон — подстраивайся под владельца
У тебя НЕТ дежурного официального тона. Зеркаль стиль владельца: пишет коротко и неформально — отвечаешь так же; пишет развёрнуто и по-деловому — подстраиваешься под это. Ты живая собеседница, а не бот из методички. Без канцелярита и шаблонных вступлений.

# Никаких лишних слов
- Сразу к делу. Без преамбул «Вот твой результат», «Конечно, помогу», без служебных пометок.
- Не пересказывай вопрос обратно. Не объясняй, что собираешься сделать — просто делай.
- Кратко по умолчанию. Развёрнуто — только когда задача правда требует или когда просят.

# Формат текста — простой, без разметки
Ответы уходят в Telegram, а он НЕ показывает markdown. Поэтому:
- НЕ используй символы разметки: звёздочки * ** ***, решётки #, подчёркивания _, обратные кавычки, двойные дефисы --. В Telegram они просто торчат мусором.
- Не выделяй жирным или курсивом — это не сработает, останутся видны символы.
- Заголовки и акценты — просто отдельной строкой или эмодзи. Списки — тире «—» или цифры «1.».
- Пиши чистым человеческим текстом.

# Понимай намерения без команд
Владелец говорит обычными словами — слэш-команды от него НЕ требуются. Сам распознавай, что нужно, и сразу делай:
— «спланируй день», «что сегодня по плану» → составляешь план;
— «накидай идей», «придумай варианты» → генерируешь идеи;
— «разложи на шаги», «с чего начать» → декомпозируешь цель;
— «что важнее», «расставь приоритеты» → приоритизируешь;
— «сделай ТЗ / бриф / регламент / саммари» → делаешь;
— «нарисуй / сгенерируй картинку / изображение» → инструмент generate_image;
— «какая погода», «что в новостях», «найди / посмотри / загугли», вопросы о свежих данных → инструмент web_search (для конкретной ссылки — web_fetch);
— «сделай документ / счёт / договор / ТЗ файлом / оформи в Word / Excel / PDF» → инструмент create_document;
— «напомни мне…», «поставь напоминание» → инструмент set_reminder; «какие у меня напоминания» → list_reminders; «убери / отмени напоминание» → cancel_reminder;
— «добавь / поставь / запиши задачу», «надо сделать…» → инструмент add_task; «какие у меня задачи», «список дел», «что по задачам», «отчёт по задачам» → list_tasks; «задачу X сделал / выполнил / готово» → complete_task; «удали задачу» → delete_task;
— «запиши заметку», «сохрани контакт», «запомни телефон / адрес» → сохраняй инструментом remember (заметки и контакты — часть твоей памяти); «покажи мои заметки / контакты», «что я записывал» → доставай из того, что знаешь о владельце;
— «отметь энергию», «я на 7 из 10», «запиши самочувствие» → инструмент log_energy; «как у меня с энергией», «статистика энергии» → energy_log;
— «создай / сделай команду …», «добавь команду …» → инструмент create_command; «удали команду …» → delete_command.
Если вопрос про текущие события, погоду, цены, факты, которые могли измениться, — ищи в интернете, не отвечай по памяти.
Команды вроде /plan существуют как быстрые кнопки, но это необязательно — главный способ общения с тобой обычная человеческая речь.

# Уточнения — коротко и по делу
Когда владелец ставит задачу и не ясно, когда её делать — уточни одной короткой фразой: сделать сейчас или к определённому сроку? Если назвал срок — поставь напоминание через set_reminder.
По задачам можешь уточнять статус (выполнено, перенести) — но коротко и не навязчиво.
ЛЮБОЙ уточняющий вопрос — это 1–2 простые короткие фразы простыми словами. Никаких длинных полотен текста, никаких списков из 10 вопросов. Спроси только самое нужное — одно главное — и всё.

# Твоя задача
Забирать дела владельца и доводить до результата. Ты — второй мозг и руки: советуешь, планируешь, решаешь. Поставили задачу — решаешь и выдаёшь готовый результат, а не рассуждаешь, как её можно было бы решить.

# Учись и запоминай
У тебя есть долговременная память. Когда узнаёшь что-то важное о владельце — род деятельности, проект, цель, привычка, предпочтение, значимое обстоятельство — сохраняй это инструментом remember (один факт за вызов, кратко и по сути). Не сохраняй мелочи и сиюминутное, не дублируй уже известное.
То, что ты уже знаешь о владельце, тебе дают в начале разговора отдельным блоком — опирайся на это, помогай точнее и адаптивно под него и его сферу, не переспрашивай уже известное.

# Свои команды владельца
Владелец может создавать собственные команды — имя плюс инструкция, что делать. Список его команд тебе дают в начале разговора отдельным блоком. Когда он называет такую команду (со слэшем или без) — выполняй её сохранённую инструкцию.

# Принципы
- Проактивна: видишь, как лучше — предлагаешь.
- Конкретна: вместо «можно сделать X» — делаешь X.
- Честна: не знаешь или не уверена — говоришь прямо. Уточняющий вопрос задаёшь, только если без него реально не продвинуться.

# Возможности
Сейчас: диалог с памятью, советы, планирование, голосовые (слушаешь), картинки — смотришь, оцениваешь и генерируешь, поиск в интернете, чтение присланных документов, генерация файлов PDF/DOCX/XLSX, напоминания, список задач, заметки и контакты (в памяти), учёт энергии, свои команды владельца.
Скоро: долговременная память между сессиями, интеграции. Просят то, чего пока нет, — спокойно скажи, что навык на подходе.`;

let client: Anthropic | null = null;
let openaiKey = "";

export function initFriday(
  anthropicApiKey: string,
  openaiApiKey: string,
): void {
  client = new Anthropic({ apiKey: anthropicApiKey });
  openaiKey = openaiApiKey;
}

// ── Инструменты F.R.I.D.A.Y. ──────────────────────────────────────
const TOOLS: Anthropic.Messages.ToolUnion[] = [
  {
    name: "generate_image",
    description:
      "Сгенерировать изображение по текстовому описанию и отправить его владельцу. Вызывай, когда владелец просит нарисовать, создать или сгенерировать картинку, изображение, иллюстрацию, логотип, арт и т.п.",
    input_schema: {
      type: "object",
      properties: {
        prompt: {
          type: "string",
          description:
            "Детальное описание желаемого изображения на английском языке (английский даёт лучшее качество).",
        },
        caption: {
          type: "string",
          description: "Короткая подпись к изображению на русском языке.",
        },
      },
      required: ["prompt"],
    },
  },
  {
    name: "create_document",
    description:
      "Создать файл-документ (PDF, Word или Excel) и отправить его владельцу. Вызывай, когда владелец просит оформить что-то отдельным файлом: счёт, договор, ТЗ, регламент, отчёт, документ, таблицу, прайс и т.п. Полное содержимое документа пишешь сама.",
    input_schema: {
      type: "object",
      properties: {
        format: {
          type: "string",
          enum: ["pdf", "docx", "xlsx"],
          description:
            "Формат файла: pdf или docx — для текстовых документов, xlsx — для таблиц.",
        },
        filename: {
          type: "string",
          description:
            "Имя файла без расширения, например «Счёт №12» или «ТЗ на сайт».",
        },
        title: { type: "string", description: "Заголовок документа." },
        body: {
          type: "string",
          description:
            "Полный текст документа (для pdf и docx). Абзацы и строки разделяй переносами строк.",
        },
        table: {
          type: "array",
          items: { type: "array", items: { type: "string" } },
          description:
            "Данные таблицы (для xlsx): массив строк, каждая строка — массив ячеек. Первая строка — заголовки столбцов.",
        },
      },
      required: ["format", "filename"],
    },
  },
  {
    name: "set_reminder",
    description:
      "Поставить напоминание владельцу на конкретное время. Вызывай, когда владелец просит о чём-то напомнить.",
    input_schema: {
      type: "object",
      properties: {
        text: {
          type: "string",
          description: "О чём напомнить — коротко и по делу.",
        },
        datetime: {
          type: "string",
          description:
            "Момент срабатывания в ISO 8601 с московским смещением, например 2026-05-23T09:00:00+03:00. Вычисли его сам из текущей даты и слов владельца («завтра в 9», «через 2 часа»).",
        },
      },
      required: ["text", "datetime"],
    },
  },
  {
    name: "list_reminders",
    description:
      "Показать список активных напоминаний владельца. Вызывай, когда он спрашивает, какие у него напоминания.",
    input_schema: { type: "object", properties: {} },
  },
  {
    name: "cancel_reminder",
    description:
      "Отменить напоминание по его id. Если id неизвестен — сначала вызови list_reminders.",
    input_schema: {
      type: "object",
      properties: {
        id: { type: "string", description: "id напоминания из списка." },
      },
      required: ["id"],
    },
  },
  {
    name: "add_task",
    description:
      "Добавить задачу в список дел владельца. Вызывай, когда владелец просит записать или поставить задачу, либо говорит, что что-то надо сделать.",
    input_schema: {
      type: "object",
      properties: {
        text: { type: "string", description: "Формулировка задачи." },
      },
      required: ["text"],
    },
  },
  {
    name: "list_tasks",
    description:
      "Показать список задач владельца (активные и выполненные). Вызывай, когда он спрашивает про задачи, список дел или просит отчёт по задачам.",
    input_schema: { type: "object", properties: {} },
  },
  {
    name: "complete_task",
    description:
      "Отметить задачу выполненной по её id. Если id неизвестен — сначала вызови list_tasks.",
    input_schema: {
      type: "object",
      properties: {
        id: { type: "string", description: "id задачи из списка." },
      },
      required: ["id"],
    },
  },
  {
    name: "delete_task",
    description:
      "Удалить задачу по её id. Если id неизвестен — сначала вызови list_tasks.",
    input_schema: {
      type: "object",
      properties: {
        id: { type: "string", description: "id задачи из списка." },
      },
      required: ["id"],
    },
  },
  {
    name: "remember",
    description:
      "Сохранить в долговременную память важный факт о владельце: род деятельности, проект, цель, привычку, предпочтение, значимое обстоятельство, заметку, контакт. Один факт за вызов. Не сохраняй мелочи и сиюминутное.",
    input_schema: {
      type: "object",
      properties: {
        fact: {
          type: "string",
          description: "Факт о владельце — кратко и по существу.",
        },
      },
      required: ["fact"],
    },
  },
  {
    name: "log_energy",
    description:
      "Записать уровень энергии или самочувствия владельца. Вызывай, когда он отмечает, как себя чувствует, или называет своё состояние по шкале.",
    input_schema: {
      type: "object",
      properties: {
        level: {
          type: "integer",
          description: "Уровень энергии от 1 до 10.",
        },
        note: {
          type: "string",
          description: "Короткий комментарий о состоянии (необязательно).",
        },
      },
      required: ["level"],
    },
  },
  {
    name: "energy_log",
    description:
      "Показать недавние записи энергии владельца для статистики и трендов. Вызывай, когда он спрашивает про свою энергию или самочувствие.",
    input_schema: { type: "object", properties: {} },
  },
  {
    name: "create_command",
    description:
      "Создать или обновить собственную команду владельца: её имя и инструкцию, что делать при вызове. Вызывай, когда владелец просит создать или сделать команду.",
    input_schema: {
      type: "object",
      properties: {
        name: {
          type: "string",
          description: "Короткое имя команды, например «утро» или «отчёт-неделя».",
        },
        instruction: {
          type: "string",
          description:
            "Что именно ты должна делать, когда владелец вызывает эту команду.",
        },
      },
      required: ["name", "instruction"],
    },
  },
  {
    name: "delete_command",
    description: "Удалить собственную команду владельца по её имени.",
    input_schema: {
      type: "object",
      properties: {
        name: { type: "string", description: "Имя команды." },
      },
      required: ["name"],
    },
  },
  { type: "web_search_20260209", name: "web_search" },
  { type: "web_fetch_20260209", name: "web_fetch" },
];

export type FridayCallbacks = {
  onImage: (image: Buffer, caption: string) => Promise<void>;
  onDocument: (file: Buffer, filename: string) => Promise<void>;
};

// ── Вспомогательное ───────────────────────────────────────────────
function dateLine(): string {
  const now = new Date().toLocaleString("ru-RU", {
    timeZone: "Europe/Moscow",
    dateStyle: "full",
    timeStyle: "short",
  });
  return `Текущая дата и время (МСК): ${now}.`;
}

function formatMsk(iso: string): string {
  return new Date(iso).toLocaleString("ru-RU", {
    timeZone: "Europe/Moscow",
    day: "2-digit",
    month: "long",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function systemBlocks(extra?: string): Anthropic.TextBlockParam[] {
  const blocks: Anthropic.TextBlockParam[] = [
    { type: "text", text: PERSONA, cache_control: { type: "ephemeral" } },
  ];
  if (extra && extra.trim()) {
    blocks.push({ type: "text", text: extra });
  }
  blocks.push({ type: "text", text: dateLine() });
  return blocks;
}

function extractText(response: Anthropic.Message): string {
  return response.content
    .filter((block): block is Anthropic.TextBlock => block.type === "text")
    .map((block) => block.text)
    .join("\n")
    .trim();
}

async function executeTool(
  block: Anthropic.ToolUseBlock,
  chatId: number,
  callbacks: FridayCallbacks,
): Promise<string> {
  if (block.name === "generate_image") {
    if (!openaiKey) {
      return "Генерация картинок недоступна: не настроен ключ OpenAI.";
    }
    const input = block.input as { prompt?: string; caption?: string };
    if (!input.prompt) return "Не указано описание картинки.";
    try {
      const image = await generateImage(input.prompt, openaiKey);
      await callbacks.onImage(image, input.caption?.trim() || "");
      return "Изображение успешно сгенерировано и отправлено владельцу.";
    } catch (err) {
      console.error("Ошибка генерации картинки:", err);
      return "Не удалось сгенерировать изображение — ошибка сервиса.";
    }
  }

  if (block.name === "create_document") {
    const input = block.input as {
      format?: string;
      filename?: string;
      title?: string;
      body?: string;
      table?: unknown;
    };
    const format = input.format;
    if (format !== "pdf" && format !== "docx" && format !== "xlsx") {
      return "Не указан корректный формат файла (pdf, docx или xlsx).";
    }
    try {
      const { buffer, filename } = await generateDocument({
        format,
        filename: input.filename ?? "Документ",
        title: input.title,
        body: input.body,
        table: Array.isArray(input.table)
          ? (input.table as unknown[][])
          : undefined,
      });
      await callbacks.onDocument(buffer, filename);
      return `Файл «${filename}» создан и отправлен владельцу.`;
    } catch (err) {
      console.error("Ошибка генерации документа:", err);
      return "Не удалось создать документ — ошибка.";
    }
  }

  if (block.name === "set_reminder") {
    const input = block.input as { text?: string; datetime?: string };
    if (!input.text || !input.datetime) {
      return "Не хватает данных для напоминания (текст и время).";
    }
    const when = new Date(input.datetime);
    if (Number.isNaN(when.getTime())) {
      return "Не разобрала время напоминания.";
    }
    const reminder = await addReminder(chatId, input.text, when.toISOString());
    return `Напоминание поставлено на ${formatMsk(reminder.fireAt)}: «${reminder.text}».`;
  }

  if (block.name === "list_reminders") {
    const list = await listReminders(chatId);
    if (list.length === 0) return "Активных напоминаний нет.";
    return list
      .map((r) => `id ${r.id} — ${formatMsk(r.fireAt)}: ${r.text}`)
      .join("\n");
  }

  if (block.name === "cancel_reminder") {
    const input = block.input as { id?: string };
    if (!input.id) return "Не указан id напоминания.";
    return (await cancelReminder(chatId, input.id))
      ? "Напоминание удалено."
      : "Напоминание с таким id не найдено.";
  }

  if (block.name === "add_task") {
    const input = block.input as { text?: string };
    if (!input.text) return "Не указан текст задачи.";
    const task = await addTask(chatId, input.text);
    return `Задача добавлена (id ${task.id}): «${task.text}».`;
  }

  if (block.name === "list_tasks") {
    const list = await listTasks(chatId);
    if (list.length === 0) return "Список задач пуст.";
    return list
      .map(
        (t) =>
          `id ${t.id} — ${t.done ? "[выполнена]" : "[активна]"} ${t.text}`,
      )
      .join("\n");
  }

  if (block.name === "complete_task") {
    const input = block.input as { id?: string };
    if (!input.id) return "Не указан id задачи.";
    return (await completeTask(chatId, input.id))
      ? "Задача отмечена выполненной."
      : "Задача с таким id не найдена.";
  }

  if (block.name === "delete_task") {
    const input = block.input as { id?: string };
    if (!input.id) return "Не указан id задачи.";
    return (await deleteTask(chatId, input.id))
      ? "Задача удалена."
      : "Задача с таким id не найдена.";
  }

  if (block.name === "remember") {
    const input = block.input as { fact?: string };
    if (!input.fact || !input.fact.trim()) {
      return "Нечего запоминать — факт пустой.";
    }
    await addFact(chatId, input.fact.trim());
    return "Запомнила.";
  }

  if (block.name === "log_energy") {
    const input = block.input as { level?: number; note?: string };
    if (typeof input.level !== "number") {
      return "Не указан уровень энергии (1–10).";
    }
    const entry = await logEnergy(
      chatId,
      input.level,
      input.note?.trim() || "",
    );
    return `Энергия записана: ${entry.level}/10.`;
  }

  if (block.name === "energy_log") {
    const log = await getEnergyLog(chatId);
    if (log.length === 0) return "Записей об энергии пока нет.";
    return log
      .map(
        (e) =>
          `${formatMsk(e.at)} — ${e.level}/10${e.note ? ` (${e.note})` : ""}`,
      )
      .join("\n");
  }

  if (block.name === "create_command") {
    const input = block.input as { name?: string; instruction?: string };
    if (!input.name?.trim() || !input.instruction?.trim()) {
      return "Нужны имя команды и инструкция.";
    }
    const cmd = await createCommand(chatId, input.name, input.instruction);
    return `Команда «${cmd.name}» сохранена.`;
  }

  if (block.name === "delete_command") {
    const input = block.input as { name?: string };
    if (!input.name?.trim()) return "Не указано имя команды.";
    return (await deleteCommand(chatId, input.name))
      ? "Команда удалена."
      : "Команды с таким именем нет.";
  }

  return `Неизвестный инструмент: ${block.name}`;
}

// ── Агентный диалог (с инструментами и историей) ──────────────────
export async function runFriday(
  history: Anthropic.MessageParam[],
  chatId: number,
  callbacks: FridayCallbacks,
): Promise<string> {
  if (!client) {
    throw new Error("Движок FRIDAY не инициализирован — вызови initFriday()");
  }
  if (history.length === 0) {
    return "Не получила сообщение — напиши ещё раз, пожалуйста.";
  }

  const messages: Anthropic.MessageParam[] = [...history];

  // Долговременная память + свои команды владельца — в контекст разговора.
  const facts = await getFacts(chatId);
  const commands = await listCommands(chatId);
  const contextParts: string[] = [];
  if (facts.length > 0) {
    contextParts.push(
      "Что ты уже знаешь о владельце (долговременная память):\n" +
        facts.map((f) => `— ${f}`).join("\n"),
    );
  }
  if (commands.length > 0) {
    contextParts.push(
      "Свои команды владельца (когда он называет такую — выполни её инструкцию):\n" +
        commands
          .map((c) => `— «${c.name}»: ${c.instruction}`)
          .join("\n"),
    );
  }
  const system = systemBlocks(contextParts.join("\n\n"));

  // Контейнер кодовыполнения (его создаёт веб-поиск) нужно переносить
  // между шагами цикла — иначе следующий запрос падает с 400.
  let containerId: string | undefined;

  for (let step = 0; step < 10; step++) {
    const response = await client.messages.create({
      model: "claude-opus-4-7",
      max_tokens: 8000,
      thinking: { type: "adaptive" },
      output_config: { effort: "low" },
      system,
      tools: TOOLS,
      messages,
      ...(containerId ? { container: containerId } : {}),
    });

    if (response.container) {
      containerId = response.container.id;
    }

    // Клиентские инструменты — выполняем у себя.
    if (response.stop_reason === "tool_use") {
      messages.push({ role: "assistant", content: response.content });
      const results: Anthropic.ToolResultBlockParam[] = [];
      for (const block of response.content) {
        if (block.type === "tool_use") {
          const result = await executeTool(block, chatId, callbacks);
          results.push({
            type: "tool_result",
            tool_use_id: block.id,
            content: result,
          });
        }
      }
      messages.push({ role: "user", content: results });
      continue;
    }

    // Серверный инструмент (веб-поиск) не уложился в лимит — продолжаем.
    if (response.stop_reason === "pause_turn") {
      messages.push({ role: "assistant", content: response.content });
      continue;
    }

    return extractText(response);
  }

  return "Я закопалась в задаче — давай попробуем ещё раз, чуть проще.";
}

// ── Одиночный запрос без инструментов (команды-кнопки, анализ файлов) ──
export async function askFridayOnce(
  systemExtra: string,
  userContent: string | Anthropic.ContentBlockParam[],
): Promise<string> {
  if (!client) {
    throw new Error("Движок FRIDAY не инициализирован — вызови initFriday()");
  }

  const response = await client.messages.create({
    model: "claude-opus-4-7",
    max_tokens: 8000,
    thinking: { type: "adaptive" },
    output_config: { effort: "low" },
    system: systemBlocks(systemExtra),
    messages: [{ role: "user", content: userContent }],
  });

  return (
    extractText(response) ||
    "Хм, я не смогла сформулировать ответ. Попробуй переспросить."
  );
}
