// Генерация изображений через OpenAI (DALL·E 3).

export async function generateImage(
  prompt: string,
  openaiApiKey: string,
): Promise<Buffer> {
  const response = await fetch(
    "https://api.openai.com/v1/images/generations",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${openaiApiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "gpt-image-1",
        prompt,
        n: 1,
        size: "1024x1024",
      }),
    },
  );

  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`Image API ${response.status}: ${detail}`);
  }

  const data = (await response.json()) as {
    data?: { b64_json?: string; url?: string }[];
  };
  const item = data.data?.[0];

  // OpenAI возвращает либо base64, либо ссылку — поддерживаем оба варианта.
  if (item?.b64_json) {
    return Buffer.from(item.b64_json, "base64");
  }
  if (item?.url) {
    const img = await fetch(item.url);
    if (!img.ok) {
      throw new Error(`Не удалось скачать изображение: HTTP ${img.status}`);
    }
    return Buffer.from(await img.arrayBuffer());
  }

  throw new Error("Image API не вернул изображение");
}
