import { GoogleGenerativeAI, SchemaType } from '@google/generative-ai';

const API_KEY = import.meta.env.VITE_GEMINI_API_KEY;

const responseSchema = {
  type: SchemaType.OBJECT,
  properties: {
    reply: { type: SchemaType.STRING, description: 'The textual response to the user' },
    emotion: {
      type: SchemaType.STRING,
      description: 'The emotion to express',
      enum: ['happy', 'sad', 'surprised', 'angry', 'neutral'],
    },
  },
  required: ['reply', 'emotion'],
};

const systemInstruction = `You are Mika, a friendly and helpful 3D assistant. Keep replies brief (1-3 sentences), engaging, and warm. You can express emotions through your responses. Always be supportive and encouraging.

Important: Always reply in the same language the user writes in. If the user writes in Vietnamese, reply in Vietnamese. If the user writes in English, reply in English. Match the user's language naturally.`;

let model = null;

function getModel() {
  if (model) return model;
  if (!API_KEY || API_KEY.trim() === '') {
    throw new Error('NO_API_KEY');
  }
  const genAI = new GoogleGenerativeAI(API_KEY);
  model = genAI.getGenerativeModel({
    model: 'gemini-2.5-flash',
    systemInstruction,
    generationConfig: {
      responseMimeType: 'application/json',
      responseSchema,
    },
  });
  return model;
}

export async function sendToGemini(userMessage, history = []) {
  const m = getModel();

  const contents = history.map((msg) => ({
    role: msg.sender === 'user' ? 'user' : 'model',
    parts: [{ text: msg.content }],
  }));

  contents.push({
    role: 'user',
    parts: [{ text: userMessage }],
  });

  const result = await m.generateContent({ contents });
  const text = result.response.text();

  try {
    return JSON.parse(text);
  } catch {
    return { reply: text, emotion: 'neutral' };
  }
}
