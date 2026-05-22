// Распознавание речи (Speech-to-Text) через OpenAI Whisper.
// Telegram присылает голосовые в формате OGG/Opus — Whisper его принимает напрямую.

export async function transcribeVoice(
  audio: Buffer,
  openaiApiKey: string,
): Promise<string> {
  const form = new FormData();
  form.append("file", new Blob([audio], { type: "audio/ogg" }), "voice.oga");
  form.append("model", "whisper-1");
  form.append("language", "ru");

  const response = await fetch(
    "https://api.openai.com/v1/audio/transcriptions",
    {
      method: "POST",
      headers: { Authorization: `Bearer ${openaiApiKey}` },
      body: form,
    },
  );

  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`Whisper API ${response.status}: ${detail}`);
  }

  const data = (await response.json()) as { text?: string };
  return (data.text ?? "").trim();
}
