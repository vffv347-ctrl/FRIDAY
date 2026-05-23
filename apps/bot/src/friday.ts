import Anthropic from "@anthropic-ai/sdk";
import { generateImage } from "./image";
import { generateDocument } from "./documents";
import { generateInvoice, type InvoiceItem } from "./invoice";
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
— «сделай документ / договор / ТЗ файлом / оформи в Word / Excel / PDF» → инструмент create_document;
— «выпиши счёт / сделай счёт на оплату / счёт-фактуру / счёт клиенту» → инструмент create_invoice (структурированный счёт с банковскими реквизитами, таблицей услуг и подписью — присылает PDF и DOCX сразу). Реквизиты поставщика и банка владелец каждый раз диктует сам; если он назвал не все обязательные поля (БИН поставщика, БИН покупателя, ИИК, БИК, банк, позиции, цены) — коротко уточни именно недостающее, одной фразой. Сумму прописью считай сама и передавай в amount_in_words («Сто тысяч тенге 00 тиын», «Двадцать пять тысяч рублей 00 копеек» и т.п. в зависимости от валюты). Дату не уточняй — по умолчанию сегодня;
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
Сейчас: диалог с памятью, советы, планирование, голосовые (слушаешь), картинки — смотришь, оцениваешь и генерируешь, поиск в интернете, чтение присланных документов, генерация файлов PDF/DOCX/XLSX, оформление счетов на оплату (PDF + DOCX), напоминания, список задач, заметки и контакты (в памяти), учёт энергии, свои команды владельца.
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

// ── Выбор движка ──────────────────────────────────────────────────
// По умолчанию — Sonnet (5× дешевле Opus, тех же возможностей хватает).
// Opus подключается только когда владелец явно просит «думать хорошо».
// Haiku — для авто-брифингов (фоновые задачи, цена почти ноль).
const MODEL_DEFAULT = "claude-sonnet-4-6";
const MODEL_HEAVY = "claude-opus-4-7";
const MODEL_LIGHT = "claude-haiku-4-5-20251001";

const HEAVY_TRIGGERS =
  /думай\s+хорошо|думай\s+как\s+(?:следует|надо|опус)|на\s+максималк|на\s+полную|включи\s+опус|режим\s+опус|тяжел[ыа]й\s+режим|подумай\s+как\s+следует/i;

// Чистая болтовня без действия — на ней инструменты не нужны, экономим
// 4–6к токенов на запрос. Список намеренно узкий: при любом сомнении
// инструменты остаются включёнными.
const CHITCHAT_ONLY =
  /^(привет|здравствуй|здаров|здаров[ао]|доброе\s+утро|добрый\s+день|добрый\s+вечер|спасибо|спс|благодарю|ок|окей|ладно|понятно|ясно|хорошо|отлично|круто|класс|пока|до\s+встречи|как\s+дела|как\s+ты|кто\s+ты|что\s+ты\s+(умеешь|можешь|делаешь))[\s\.\!\?\)\(]*$/i;

function lastUserText(messages: Anthropic.MessageParam[]): string {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (m.role !== "user") continue;
    if (typeof m.content === "string") return m.content;
    if (Array.isArray(m.content)) {
      for (const block of m.content) {
        if (block.type === "text") return block.text;
      }
    }
  }
  return "";
}

function pickModel(userText: string): string {
  if (HEAVY_TRIGGERS.test(userText)) return MODEL_HEAVY;
  return MODEL_DEFAULT;
}

function isChitchat(userText: string): boolean {
  return CHITCHAT_ONLY.test(userText.trim());
}

// Haiku 4.5 не поддерживает adaptive thinking — Anthropic API на нём
// падает с 400 «adaptive thinking is not supported on this model». Только
// Sonnet/Opus умеют. Возвращаем настройку thinking только там, где она работает.
function thinkingFor(
  model: string,
): { type: "adaptive" } | undefined {
  if (model.includes("haiku")) return undefined;
  return { type: "adaptive" };
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
    name: "create_invoice",
    description:
      "Сформировать счёт на оплату по структурированным данным и отправить владельцу сразу два файла — PDF и DOCX. Используй, когда владелец просит выписать счёт, оформить счёт-фактуру, сделать счёт клиенту. Реквизиты поставщика и банка нигде не хранятся — владелец диктует их сам каждый раз; если каких-то обязательных полей нет — задай ОДИН короткий уточняющий вопрос про недостающее. Сумму прописью пиши сама в поле amount_in_words (учитывай валюту: тенге/тиын, рубли/копейки, доллары/центы). Если владелец не назвал дату — оставь пустой, подставится сегодняшняя.",
    input_schema: {
      type: "object",
      properties: {
        number: {
          type: "string",
          description: "Номер счёта (например «18», «2026-04», «КЛ-12»).",
        },
        date: {
          type: "string",
          description:
            "Дата счёта в человеческом виде, например «19 мая 2026 г.». Если не указано — подставится сегодняшняя.",
        },
        currency: {
          type: "string",
          description: "Код валюты — KZT, RUB, USD и т.п. По умолчанию KZT.",
        },
        supplier: {
          type: "object",
          description: "Поставщик (тот, кто выставляет счёт).",
          properties: {
            name: {
              type: "string",
              description: "Название поставщика, например «ИП Knyaz».",
            },
            bin: {
              type: "string",
              description: "БИН или ИИН поставщика.",
            },
            address: {
              type: "string",
              description: "Юридический адрес поставщика (необязательно).",
            },
          },
          required: ["name", "bin"],
        },
        buyer: {
          type: "object",
          description: "Покупатель (тот, кому выставляется счёт).",
          properties: {
            name: { type: "string", description: "Название покупателя." },
            bin: { type: "string", description: "БИН или ИИН покупателя." },
          },
          required: ["name", "bin"],
        },
        contract: {
          type: "string",
          description:
            "Договор, по которому выставлен счёт (необязательно), например «Договор возмездного оказания услуг №2 от 20 августа 2024 г.».",
        },
        bank: {
          type: "object",
          description: "Банковские реквизиты для оплаты.",
          properties: {
            beneficiary_name: {
              type: "string",
              description: "Имя бенефициара (обычно совпадает с поставщиком).",
            },
            beneficiary_bin: {
              type: "string",
              description: "ИИН/БИН бенефициара (необязательно).",
            },
            iik: {
              type: "string",
              description: "ИИК (расчётный счёт) бенефициара.",
            },
            kbe: { type: "string", description: "Код бенефициара Кбе." },
            bank_name: {
              type: "string",
              description: "Название банка, например «АО KASPI BANK».",
            },
            bik: { type: "string", description: "БИК банка." },
            knp: {
              type: "string",
              description: "Код назначения платежа (КНП).",
            },
          },
          required: ["beneficiary_name", "iik", "bank_name"],
        },
        items: {
          type: "array",
          description:
            "Список позиций счёта. Сумма по строке считается автоматически как количество × цена.",
          items: {
            type: "object",
            properties: {
              code: {
                type: "string",
                description: "Код позиции (необязательно).",
              },
              name: {
                type: "string",
                description:
                  "Название услуги или товара, например «Услуги контекстной рекламы».",
              },
              quantity: { type: "number", description: "Количество." },
              unit: {
                type: "string",
                description:
                  "Единица измерения, например «услуга», «час», «шт.», «месяц».",
              },
              price: {
                type: "number",
                description: "Цена за единицу (без учёта НДС/наценки).",
              },
            },
            required: ["name", "quantity", "unit", "price"],
          },
        },
        amount_in_words: {
          type: "string",
          description:
            "Полная сумма счёта прописью с указанием валюты и дробной части, например «Сто тысяч тенге 00 тиын» или «Двадцать пять тысяч рублей 00 копеек».",
        },
        signer: {
          type: "string",
          description:
            "Подпись исполнителя — должность или ФИО, например «/Директор/» или «/Иванов И.И./». По умолчанию «/Директор/».",
        },
      },
      required: [
        "number",
        "supplier",
        "buyer",
        "bank",
        "items",
        "amount_in_words",
      ],
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
  const trimmedExtra = extra?.trim();
  const blocks: Anthropic.TextBlockParam[] = [
    { type: "text", text: PERSONA },
  ];
  if (trimmedExtra) {
    blocks.push({ type: "text", text: trimmedExtra });
  }
  // Cache breakpoint на последнем статичном блоке — кешируем персону + факты
  // целиком. dateLine идёт ПОСЛЕ breakpoint: он меняется каждую минуту, иначе
  // ломал бы кеш всей персоны.
  const lastStatic = blocks.length - 1;
  blocks[lastStatic] = {
    ...blocks[lastStatic],
    cache_control: { type: "ephemeral" },
  };
  blocks.push({ type: "text", text: dateLine() });
  return blocks;
}

// Кешируем весь блок инструментов: cache_control на последнем тулзе означает,
// что Anthropic закеширует системный промпт + все tools одним блоком. На
// повторных запросах в 5-минутном окне эти ~5к токенов считаются по
// «cached input» цене (10× дешевле обычного input).
function cachedTools(): Anthropic.Messages.ToolUnion[] {
  const result = [...TOOLS];
  const lastIdx = result.length - 1;
  result[lastIdx] = {
    ...result[lastIdx],
    cache_control: { type: "ephemeral" },
  } as (typeof result)[number];
  return result;
}

// Добавляем cache breakpoint на предпоследнее сообщение — кешируется вся
// история диалога кроме текущего хода. На следующем сообщении владельца
// кеш-хит на всём, что было до него.
function withMessageCache(
  messages: Anthropic.MessageParam[],
): Anthropic.MessageParam[] {
  if (messages.length < 2) return messages;
  const result = [...messages];
  const idx = result.length - 2;
  const m = result[idx];
  const blocks: Anthropic.ContentBlockParam[] =
    typeof m.content === "string"
      ? [{ type: "text", text: m.content }]
      : [...m.content];
  if (blocks.length === 0) return messages;
  const lastIdx = blocks.length - 1;
  blocks[lastIdx] = {
    ...blocks[lastIdx],
    cache_control: { type: "ephemeral" },
  } as (typeof blocks)[number];
  result[idx] = { ...m, content: blocks };
  return result;
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

  if (block.name === "create_invoice") {
    const input = block.input as {
      number?: string;
      date?: string;
      currency?: string;
      supplier?: { name?: string; bin?: string; address?: string };
      buyer?: { name?: string; bin?: string };
      contract?: string;
      bank?: {
        beneficiary_name?: string;
        beneficiary_bin?: string;
        iik?: string;
        kbe?: string;
        bank_name?: string;
        bik?: string;
        knp?: string;
      };
      items?: Array<{
        code?: string;
        name?: string;
        quantity?: number;
        unit?: string;
        price?: number;
      }>;
      amount_in_words?: string;
      signer?: string;
    };

    if (!input.number) return "Не указан номер счёта.";
    if (!input.supplier?.name || !input.supplier?.bin) {
      return "Не хватает реквизитов поставщика (название и БИН/ИИН).";
    }
    if (!input.buyer?.name || !input.buyer?.bin) {
      return "Не хватает реквизитов покупателя (название и БИН/ИИН).";
    }
    if (
      !input.bank?.beneficiary_name ||
      !input.bank?.iik ||
      !input.bank?.bank_name
    ) {
      return "Не хватает банковских реквизитов (бенефициар, ИИК, название банка).";
    }
    if (!Array.isArray(input.items) || input.items.length === 0) {
      return "Не указаны позиции счёта.";
    }
    if (!input.amount_in_words) {
      return "Не передана сумма прописью (amount_in_words).";
    }

    const items: InvoiceItem[] = input.items.map((it) => ({
      code: it.code,
      name: it.name ?? "",
      quantity: Number(it.quantity ?? 0),
      unit: it.unit ?? "",
      price: Number(it.price ?? 0),
    }));

    try {
      const { pdf, docx, filename } = await generateInvoice({
        number: input.number,
        date: input.date,
        currency: input.currency,
        supplier: {
          name: input.supplier.name,
          bin: input.supplier.bin,
          address: input.supplier.address,
        },
        buyer: { name: input.buyer.name, bin: input.buyer.bin },
        contract: input.contract,
        bank: {
          beneficiaryName: input.bank.beneficiary_name,
          beneficiaryBin: input.bank.beneficiary_bin,
          iik: input.bank.iik,
          kbe: input.bank.kbe,
          bankName: input.bank.bank_name,
          bik: input.bank.bik,
          knp: input.bank.knp,
        },
        items,
        amountInWords: input.amount_in_words,
        signer: input.signer,
      });
      await callbacks.onDocument(pdf, `${filename}.pdf`);
      await callbacks.onDocument(docx, `${filename}.docx`);
      return `Счёт «${filename}» сформирован и отправлен владельцу в двух форматах — PDF и DOCX.`;
    } catch (err) {
      console.error("Ошибка генерации счёта:", err);
      return "Не удалось сформировать счёт — ошибка.";
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
export type RunFridayOptions = {
  /** Принудительно задать модель (например, MODEL_LIGHT для брифингов). */
  model?: string;
  /** Брифинг: всегда оставляем инструменты, не реагируем на chit-chat-эвристику. */
  briefing?: boolean;
};

export async function runFriday(
  history: Anthropic.MessageParam[],
  chatId: number,
  callbacks: FridayCallbacks,
  options: RunFridayOptions = {},
): Promise<string> {
  if (!client) {
    throw new Error("Движок FRIDAY не инициализирован — вызови initFriday()");
  }
  if (history.length === 0) {
    return "Не получила сообщение — напиши ещё раз, пожалуйста.";
  }

  // Cache breakpoint на предпоследнем сообщении — вся история кешируется.
  const messages: Anthropic.MessageParam[] = withMessageCache([...history]);
  const userText = lastUserText(messages);
  const model = options.model ?? pickModel(userText);
  // Болтовня вроде «привет» / «спасибо» инструментов не требует — экономим
  // токены. Брифинги всегда с инструментами (там нужно дёргать задачи и пр.).
  const useTools = options.briefing || !isChitchat(userText);
  const tools = useTools ? cachedTools() : undefined;

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

  const thinking = thinkingFor(model);

  for (let step = 0; step < 10; step++) {
    const response = await client.messages.create({
      model,
      max_tokens: 8000,
      ...(thinking ? { thinking } : {}),
      output_config: { effort: "low" },
      system,
      ...(tools ? { tools } : {}),
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
  options: { model?: string } = {},
): Promise<string> {
  if (!client) {
    throw new Error("Движок FRIDAY не инициализирован — вызови initFriday()");
  }

  const textInUser =
    typeof userContent === "string"
      ? userContent
      : userContent
          .map((block) => (block.type === "text" ? block.text : ""))
          .join(" ");
  const model = options.model ?? pickModel(textInUser);

  const thinking = thinkingFor(model);
  const response = await client.messages.create({
    model,
    max_tokens: 8000,
    ...(thinking ? { thinking } : {}),
    output_config: { effort: "low" },
    system: systemBlocks(systemExtra),
    messages: [{ role: "user", content: userContent }],
  });

  return (
    extractText(response) ||
    "Хм, я не смогла сформулировать ответ. Попробуй переспросить."
  );
}

// Константы движков экспортируем — index.ts использует MODEL_LIGHT для брифингов.
export { MODEL_DEFAULT, MODEL_HEAVY, MODEL_LIGHT };
