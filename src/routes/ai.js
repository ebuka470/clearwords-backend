import express from 'express';
import { GoogleGenAI } from '@google/genai';
import User from '../models/User.js';
import Progress from '../models/Progress.js';
import UsageCounter from '../models/UsageCounter.js';
import { authenticateUser } from '../middleware/auth.js';
import { resolveProfile } from '../middleware/profile.js';
import { getUserLimits, CHAT_LIMITS } from '../middleware/tierGate.js';

const router = express.Router();

/* ============================================
   HELPERS
   ============================================ */
function getDateKey(timezoneOffsetMinutes) {
  const now = new Date();
  if (typeof timezoneOffsetMinutes === 'number' && Number.isFinite(timezoneOffsetMinutes)) {
    const shifted = new Date(now.getTime() + timezoneOffsetMinutes * 60 * 1000);
    if (!isNaN(shifted.getTime())) {
      return shifted.toISOString().slice(0, 10);
    }
  }
  return now.toISOString().slice(0, 10);
}

let _genAI = null;
function getGenAI() {
  if (_genAI) return _genAI;
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return null;
  _genAI = new GoogleGenAI({ apiKey });
  return _genAI;
}

const GEMINI_MODEL = 'gemini-3.8-flash';

async function geminiWithRetry(fn, maxRetries = 2) {
  let lastError;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;
      const status = err?.status || err?.code || err?.response?.status;
      const isRetryable = status === 429 || status === 503;
      if (!isRetryable || attempt === maxRetries) throw err;
      await new Promise(r => setTimeout(r, 1000 * Math.pow(3, attempt)));
    }
  }
  throw lastError;
}

function geminiErrorResponse(error) {
  const status = error?.status || error?.code || error?.response?.status;
  const msg = String(error?.message || '');

  if (status === 429 || /rate limit|quota|resource_exhausted/i.test(msg)) {
    return {
      status: 503,
      body: {
        status: 'error',
        message: 'Timmy is catching his breath. Try again in a few seconds.',
        retryable: true,
        source: 'gemini'
      }
    };
  }
  if (status === 401 || status === 403 || /api key|permission|unauthenticated/i.test(msg)) {
    return {
      status: 500,
      body: { status: 'error', message: 'AI service is not configured correctly.' }
    };
  }
  if (status === 400 || /invalid|safety|blocked/i.test(msg)) {
    return {
      status: 400,
      body: { status: 'error', message: 'That request was blocked by the AI safety filter.' }
    };
  }
  return {
    status: 502,
    body: { status: 'error', message: "Timmy couldn't respond just now. Please try again." }
  };
}

function buildLessonPrompt({ topic, language, level, nativeLanguage, context }) {
  const langNames = {
    yoruba: 'Yoruba',
    hausa: 'Hausa',
    igbo: 'Igbo',
    urhobo: 'Urhobo',
    itsekiri: 'Itsekiri',
    pidgin: 'Nigerian Pidgin'
  };
  const target = langNames[language] || language;

  return `You are a language teacher creating a short, practical lesson for a learner of ${target}.

Learner profile:
- Level: ${level}
- Native language: ${nativeLanguage || 'English'}
- Topic they want: ${topic}${context ? `\n- Extra context: ${context}` : ''}

Return ONLY valid JSON in this exact schema (no prose, no markdown fences):

{
  "title": "Short lesson title",
  "description": "one sentence description",
  "language": "${language}",
  "level": "${level}",
  "topic": "${topic}",
  "vocabulary": [
    {
      "word": "target-language word or phrase",
      "translation": "translation in ${nativeLanguage || 'English'}",
      "pronunciation": "phonetic hint",
      "example": "example sentence in target language",
      "exampleTranslation": "translation of the example"
    }
  ],
  "dialogue": [
    {
      "speaker": "A",
      "text": "line in target language",
      "translation": "translation of the line"
    }
  ],
  "culturalNotes": [
    {
      "title": "short title",
      "content": "1-2 sentence explanation"
    }
  ],
  "practiceExercises": [
    {
      "question": "question text",
      "options": ["a", "b", "c", "d"],
      "correctAnswer": 0,
      "explanation": "why this is correct"
    }
  ]
}

Constraints:
- Exactly 6 vocabulary items.
- Exactly 4 dialogue lines.
- Exactly 2 cultural notes.
- Exactly 4 practice questions.
- Keep everything practical and culturally appropriate for Nigerian languages.
- Output must be parseable as JSON.`;
}

function extractJSON(text) {
  if (!text) return null;
  let cleaned = text.trim();
  cleaned = cleaned.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/i, '');
  try {
    return JSON.parse(cleaned);
  } catch {
    const first = cleaned.indexOf('{');
    const last = cleaned.lastIndexOf('}');
    if (first !== -1 && last !== -1 && last > first) {
      try {
        return JSON.parse(cleaned.slice(first, last + 1));
      } catch {
        return null;
      }
    }
    return null;
  }
}

async function enforceDailyLimit(userId, profileId, key, limit, dateKey) {
  if (limit === Infinity) return { ok: true };
  const used = await UsageCounter.getCount(userId, profileId || null, key, dateKey);
  if (used >= limit) {
    return {
      ok: false,
      response: {
        status: 429,
        body: {
          error: 'Daily limit reached',
          feature: key,
          limit,
          used,
          resetsAt: `${dateKey}T23:59:59Z`,
          upgradeUrl: '/subscription'
        }
      }
    };
  }
  return { ok: true };
}

async function recordUsage(userId, profileId, key, limit, dateKey) {
  if (limit === Infinity) {
    return { unlimited: true };
  }
  const doc = await UsageCounter.increment(userId, profileId || null, key, dateKey);
  return {
    used: doc.count,
    limit,
    remaining: Math.max(0, limit - doc.count),
    dateKey
  };
}

/* ============================================
   POST /api/ai/chat
   ============================================ */
router.post('/chat', authenticateUser, resolveProfile, async (req, res) => {
  try {
    const { prompt, timezoneOffsetMinutes } = req.body;

    const client = getGenAI();
    if (!client) {
      return res.status(500).json({
        status: 'error',
        message: 'GEMINI_API_KEY not configured'
      });
    }

    if (!prompt || typeof prompt !== 'string') {
      return res.status(400).json({
        status: 'error',
        message: 'Prompt is required'
      });
    }

    if (prompt.length > 4000) {
      return res.status(400).json({
        status: 'error',
        message: 'Prompt too long (max 4000 chars)'
      });
    }

    const user = await User.findById(req.userId);
    if (!user) return res.status(404).json({ status: 'error', message: 'User not found' });
    if (user.isBanned) return res.status(403).json({ status: 'error', message: 'Account is banned' });

    const limit = CHAT_LIMITS[user.subscriptionTier] ?? CHAT_LIMITS.free;
    const dateKey = getDateKey(timezoneOffsetMinutes);

    const gate = await enforceDailyLimit(req.userId, req.profileId, 'ai_chat_message', limit, dateKey);
    if (!gate.ok) {
      return res.status(gate.response.status).json({
        status: 'error',
        ...gate.response.body
      });
    }

    let text;
    try {
      const response = await geminiWithRetry(() =>
        client.models.generateContent({
          model: GEMINI_MODEL,
          contents: prompt
        })
      );
      text = response?.text || '';
    } catch (geminiError) {
      const { status, body } = geminiErrorResponse(geminiError);
      console.error('Gemini chat error:', geminiError?.message || geminiError);
      return res.status(status).json(body);
    }

    const reply = text || '';

    const usage = await recordUsage(req.userId, req.profileId, 'ai_chat_message', limit, dateKey);

    res.status(200).json({
      status: 'success',
      data: reply,
      usage
    });

  } catch (error) {
    console.error('AI chat error:', error);
    res.status(500).json({ status: 'error', message: 'Something went wrong. Please try again.' });
  }
});

/* ============================================
   POST /api/ai/custom-lesson
   ============================================ */
router.post('/custom-lesson', authenticateUser, resolveProfile, async (req, res) => {
  const {
    topic,
    language,
    level,
    context,
    prompt,
    timezoneOffsetMinutes
  } = req.body;

  let effectiveTopic = topic;
  let effectiveLanguage = language;
  let effectiveLevel = level;

  if (!effectiveTopic && prompt) {
    const quoted = String(prompt).match(/"([^"]{2,120})"/);
    if (quoted && quoted[1]) {
      effectiveTopic = quoted[1].trim();
    } else {
      const cleaned = String(prompt).replace(/\s+/g, ' ').trim();
      const firstSentence = cleaned.split(/[.\n]/)[0].slice(0, 200);
      effectiveTopic = firstSentence
        .replace(/^create a mini .* lesson about\s*/i, '')
        .replace(/^create a .* lesson about\s*/i, '')
        .trim() || 'General practice';
    }
  }

  if (!effectiveLanguage) {
    const u = await User.findById(req.userId).select('language');
    effectiveLanguage = u?.language || 'yoruba';
  }
  if (!effectiveLevel) {
    effectiveLevel = 'beginner';
  }

  if (!effectiveTopic) {
    return res.status(400).json({ error: 'topic (or prompt) is required' });
  }

  const validLevels = ['beginner', 'intermediate', 'advanced'];
  if (!validLevels.includes(effectiveLevel)) {
    return res.status(400).json({
      error: `level must be one of: ${validLevels.join(', ')}`
    });
  }

  try {
    const user = await User.findById(req.userId);
    if (!user) return res.status(404).json({ error: 'User not found' });
    if (user.isBanned) return res.status(403).json({ error: 'Account is banned' });

    const limits = getUserLimits(user);
    const dateKey = getDateKey(timezoneOffsetMinutes);
    const customLimit = limits.customLessonsPerDay;

    const gate = await enforceDailyLimit(req.userId, req.profileId, 'ai_custom_lesson', customLimit, dateKey);
    if (!gate.ok) {
      return res.status(gate.response.status).json(gate.response.body);
    }

    const client = getGenAI();
    if (!client) {
      return res.status(500).json({
        error: 'AI service not configured',
        detail: 'GEMINI_API_KEY is missing'
      });
    }

    const lessonPrompt = buildLessonPrompt({
      topic: effectiveTopic,
      language: effectiveLanguage,
      level: effectiveLevel,
      nativeLanguage: user.language || 'english',
      context
    });

    let rawText;
    try {
      const response = await geminiWithRetry(() =>
        client.models.generateContent({
          model: GEMINI_MODEL,
          contents: lessonPrompt,
          config: {
            responseMimeType: 'application/json'
          }
        })
      );
      rawText = response?.text || '';
    } catch (geminiError) {
      const { status, body } = geminiErrorResponse(geminiError);
      console.error('Gemini lesson error:', geminiError?.message || geminiError);
      return res.status(status).json(body);
    }

    const lesson = extractJSON(rawText);

    if (!lesson) {
      console.error('Gemini returned unparseable JSON:', rawText?.slice(0, 500));
      return res.status(502).json({
        error: 'AI returned malformed lesson. Please try again.'
      });
    }

    if (!lesson.title && effectiveTopic) lesson.title = effectiveTopic;
    if (!lesson.description && effectiveTopic) {
      lesson.description = `Custom lesson: ${effectiveTopic}`;
    }
    if (!Array.isArray(lesson.vocabulary)) lesson.vocabulary = [];
    if (!Array.isArray(lesson.dialogue)) lesson.dialogue = [];
    if (!Array.isArray(lesson.culturalNotes)) lesson.culturalNotes = [];
    if (!Array.isArray(lesson.practiceExercises)) lesson.practiceExercises = [];

    const usage = await recordUsage(req.userId, req.profileId, 'ai_custom_lesson', customLimit, dateKey);

    res.status(201).json({
      success: true,
      lesson,
      usage
    });

  } catch (error) {
    console.error('Custom lesson error:', error);
    res.status(500).json({ error: 'Something went wrong. Please try again.' });
  }
});

/* ============================================
   GET /api/ai/usage
   ============================================ */
router.get('/usage', authenticateUser, resolveProfile, async (req, res) => {
  try {
    const user = await User.findById(req.userId);
    if (!user) return res.status(404).json({ error: 'User not found' });

    const limits = getUserLimits(user);
    const parsedTz = parseInt(req.query.timezoneOffsetMinutes);
    const dateKey = getDateKey(Number.isFinite(parsedTz) ? parsedTz : undefined);

    const chatLimit = CHAT_LIMITS[user.subscriptionTier] ?? CHAT_LIMITS.free;
    const customLimit = limits.customLessonsPerDay;

    const [chatUsed, customUsed] = await Promise.all([
      UsageCounter.getCount(req.userId, req.profileId || null, 'ai_chat_message', dateKey),
      UsageCounter.getCount(req.userId, req.profileId || null, 'ai_custom_lesson', dateKey)
    ]);

    res.json({
      dateKey,
      tier: user.subscriptionTier,
      chat: chatLimit === Infinity
        ? { unlimited: true, used: chatUsed }
        : { used: chatUsed, limit: chatLimit, remaining: Math.max(0, chatLimit - chatUsed) },
      customLessons: customLimit === Infinity
        ? { unlimited: true, used: customUsed }
        : { used: customUsed, limit: customLimit, remaining: Math.max(0, customLimit - customUsed) }
    });
  } catch (error) {
    console.error('Usage error:', error);
    res.status(400).json({ error: error.message });
  }
});

export default router;