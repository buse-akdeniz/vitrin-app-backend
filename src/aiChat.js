import { z } from 'zod';

const ChatRequestSchema = z.object({
  message: z.string().trim().min(1).max(1500),
  history: z
    .array(
      z.object({
        role: z.enum(['user', 'assistant', 'system']).default('user'),
        text: z.string().max(4000).default(''),
      }),
    )
    .max(30)
    .default([]),
});

export const SupportChatSchema = ChatRequestSchema.extend({
  orderNo: z.string().trim().max(64).optional(),
});

export const StylistChatSchema = ChatRequestSchema.extend({
  occasion: z.string().trim().max(64).optional(),
  weather: z.string().trim().max(64).optional(),
});

export const ChatWsSchema = z.object({
  type: z.literal('chat'),
  mode: z.enum(['support', 'stylist']),
  message: z.string().trim().min(1).max(1500),
  history: ChatRequestSchema.shape.history,
  orderNo: z.string().trim().max(64).optional(),
  occasion: z.string().trim().max(64).optional(),
  weather: z.string().trim().max(64).optional(),
  requestId: z.string().trim().max(64).optional(),
});

export function normalizeHistory(history) {
  const safe = [];
  for (const item of history || []) {
    const role = item?.role === 'assistant' || item?.role === 'system' ? item.role : 'user';
    const text = String(item?.text || '').trim();
    if (!text) continue;
    safe.push({ role, text: text.slice(0, 4000) });
  }
  return safe.slice(-30);
}

export function suggestionsFromReply(reply) {
  const base = [
    'Bir örnek daha sorabilir miyim?',
    'Bunu adım adım anlatır mısın?',
    'Alternatif çözüm öner',
    'Özetle ve aksiyon listesi çıkar',
  ];
  if (!reply || reply.length < 10) return base;
  return base;
}

function getAiConfig() {
  const {
    AI_PROVIDER = 'openai',
    AI_MODEL = 'gpt-4o-mini',
    OPENAI_API_KEY = '',
    ANTHROPIC_API_KEY = '',
    AI_TIMEOUT_MS = '20000',
  } = process.env;
  return {
    provider: String(AI_PROVIDER || 'openai').toLowerCase(),
    model: AI_MODEL,
    openaiKey: OPENAI_API_KEY,
    anthropicKey: ANTHROPIC_API_KEY,
    timeoutMs: Number(AI_TIMEOUT_MS) || 20000,
  };
}

async function callOpenAI({ system, messages, timeoutMs, model, apiKey }) {
  if (!apiKey) throw new Error('OPENAI_API_KEY_missing');
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      signal: controller.signal,
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model,
        temperature: 0.6,
        messages: [
          { role: 'system', content: system },
          ...messages.map((m) => ({ role: m.role, content: m.text })),
        ],
      }),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`openai_error_${res.status}:${text.slice(0, 300)}`);
    }
    const data = await res.json();
    const reply = data?.choices?.[0]?.message?.content ?? '';
    return String(reply).trim();
  } finally {
    clearTimeout(t);
  }
}

async function callAnthropic({ system, messages, timeoutMs, model, apiKey }) {
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY_missing');
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      signal: controller.signal,
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model,
        max_tokens: 600,
        temperature: 0.6,
        system,
        messages: messages
          .filter((m) => m.role !== 'system')
          .map((m) => ({ role: m.role === 'assistant' ? 'assistant' : 'user', content: m.text })),
      }),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`anthropic_error_${res.status}:${text.slice(0, 300)}`);
    }
    const data = await res.json();
    const parts = data?.content ?? [];
    const text = Array.isArray(parts)
      ? parts.filter((p) => p?.type === 'text').map((p) => p.text).join('\n')
      : '';
    return String(text).trim();
  } finally {
    clearTimeout(t);
  }
}

export async function callAI({ system, messages }) {
  const { provider, model, openaiKey, anthropicKey, timeoutMs } = getAiConfig();
  if (provider === 'anthropic') {
    return callAnthropic({ system, messages, timeoutMs, model, apiKey: anthropicKey });
  }
  return callOpenAI({ system, messages, timeoutMs, model, apiKey: openaiKey });
}

export async function handleSupportChat({ message, history, orderNo }) {
  const normalizedHistory = normalizeHistory(history);
  const system = [
    'Sen Vitrin uygulamasının Türkçe müşteri destek asistanısın.',
    'Kısa, net ve çözüm odaklı cevap ver.',
    'Gizli bilgi isteme (kart, şifre, SMS kodu).',
    'Eğer bilgi eksikse en fazla 2 net soru sor.',
    orderNo ? `Sipariş No: ${orderNo}` : null,
  ]
    .filter(Boolean)
    .join('\n');

  const reply = await callAI({
    system,
    messages: [...normalizedHistory, { role: 'user', text: message }],
  });

  const text = reply || 'Şu an yanıt üretilemedi. Lütfen tekrar deneyin.';
  return { reply: text, suggestions: suggestionsFromReply(reply) };
}

export async function handleStylistChat({ message, history, occasion, weather }) {
  const normalizedHistory = normalizeHistory(history);
  const system = [
    'Sen Vitrin uygulamasının Türkçe AI stil asistanısın.',
    'Kısa, uygulanabilir kombin önerileri ver.',
    '2-4 alternatif üret; her birinde üst/alt/ayakkabı/aksesuar öner.',
    'Eğer bilgi eksikse 1-2 soru sor.',
    occasion ? `Ortam: ${occasion}` : null,
    weather ? `Hava: ${weather}` : null,
  ]
    .filter(Boolean)
    .join('\n');

  const reply = await callAI({
    system,
    messages: [...normalizedHistory, { role: 'user', text: message }],
  });

  const text = reply || 'Şu an yanıt üretilemedi. Lütfen tekrar deneyin.';
  return { reply: text, suggestions: suggestionsFromReply(reply) };
}

export async function handleChatWsPayload(payload) {
  if (payload.mode === 'stylist') {
    const parsed = StylistChatSchema.safeParse(payload);
    if (!parsed.success) throw new Error('invalid_request');
    return handleStylistChat(parsed.data);
  }
  const parsed = SupportChatSchema.safeParse(payload);
  if (!parsed.success) throw new Error('invalid_request');
  return handleSupportChat(parsed.data);
}
