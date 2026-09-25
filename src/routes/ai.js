import express from 'express';
import { Mistral } from '@mistralai/mistralai';
import User from '../models/User.js';
import Progress from '../models/Progress.js';
import UsageCounter from '../models/UsageCounter.js';
import { authenticateUser } from '../middleware/auth.js';
import { getUserLimits } from '../middleware/tierGate.js';

const router = express.Router();

// ============================================
// TIER LIMITS
// ============================================
const CHAT_LIMITS = {
    free: 50,
    premium: 500,
    immersive: Infinity
};

// ============================================
// HELPERS
// ============================================
function getDateKey(timezoneOffsetMinutes) {
    const now = new Date();
    if (typeof timezoneOffsetMinutes === 'number') {
        const shifted = new Date(now.getTime() + timezoneOffsetMinutes * 60 * 1000);
        return shifted.toISOString().slice(0, 10);
    }
    return now.toISOString().slice(0, 10);
}

let _mistralClient = null;
function getMistral() {
    if (_mistralClient) return _mistralClient;
    const apiKey = process.env.MISTRAL_API_KEY;
    if (!apiKey) return null;
    _mistralClient = new Mistral({ apiKey });
    return _mistralClient;
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
  "phrases": [
    {
      "phrase": "useful phrase",
      "translation": "translation",
      "when": "when to use it"
    }
  ],
  "practiceQuestions": [
    {
      "question": "question text",
      "options": ["a", "b", "c", "d"],
      "correctIndex": 0,
      "explanation": "why this is correct"
    }
  ]
}

Constraints:
- Exactly 5 vocabulary items.
- Exactly 3 phrases.
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

async function enforceDailyLimit(user, key, limit, dateKey) {
    if (limit === Infinity) return { ok: true };
    const used = await UsageCounter.getCount(user._id, key, dateKey);
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

async function recordUsage(user, key, limit, dateKey) {
    if (limit === Infinity) {
        return { unlimited: true, tier: user.subscriptionTier };
    }
    const doc = await UsageCounter.increment(user._id, key, dateKey);
    return {
        used: doc.count,
        limit,
        remaining: Math.max(0, limit - doc.count),
        dateKey
    };
}

// ============================================
// POST /api/ai/chat
// Timmy AI chat — MOVED from /api/tts/generate
// Drop-in replacement: same body { prompt }
// ============================================
router.post('/chat', authenticateUser, async (req, res) => {
    try {
        const { prompt, timezoneOffsetMinutes } = req.body;
        const apiKey = process.env.MISTRAL_API_KEY;

        if (!apiKey) {
            return res.status(500).json({
                status: 'error',
                message: 'MISTRAL_API_KEY not configured'
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

        const gate = await enforceDailyLimit(user, 'ai_chat_message', limit, dateKey);
        if (!gate.ok) {
            return res.status(gate.response.status).json({
                status: 'error',
                ...gate.response.body
            });
        }

        const client = getMistral();
        const chatResponse = await client.chat.complete({
            model: 'mistral-small-2506',
            messages: [{ role: 'user', content: prompt }]
        });

        const reply = chatResponse.choices?.[0]?.message?.content || '';
        const usage = await recordUsage(user, 'ai_chat_message', limit, dateKey);

        res.status(200).json({
            status: 'success',
            data: reply,
            usage
        });

    } catch (error) {
        console.error('AI chat error:', error);
        res.status(500).json({ status: 'error', message: error.message });
    }
});

// ============================================
// POST /api/ai/custom-lesson
// ============================================
router.post('/custom-lesson', authenticateUser, async (req, res) => {
    const { topic, language, level, context, timezoneOffsetMinutes } = req.body;

    if (!topic || !language || !level) {
        return res.status(400).json({
            error: 'topic, language, and level are required'
        });
    }

    const validLevels = ['beginner', 'intermediate', 'advanced'];
    if (!validLevels.includes(level)) {
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

        const gate = await enforceDailyLimit(user, 'ai_custom_lesson', customLimit, dateKey);
        if (!gate.ok) {
            return res.status(gate.response.status).json(gate.response.body);
        }

        const client = getMistral();
        if (!client) {
            return res.status(500).json({
                error: 'AI service not configured',
                detail: 'MISTRAL_API_KEY is missing'
            });
        }

        const prompt = buildLessonPrompt({
            topic,
            language,
            level,
            nativeLanguage: user.language || 'english',
            context
        });

        const chatResponse = await client.chat.complete({
            model: 'mistral-small-2506',
            messages: [{ role: 'user', content: prompt }],
            temperature: 0.7,
            maxTokens: 2000
        });

        const rawText = chatResponse.choices?.[0]?.message?.content;
        const lesson = extractJSON(rawText);

        if (!lesson) {
            console.error('Mistral returned unparseable JSON:', rawText?.slice(0, 500));
            return res.status(502).json({
                error: 'AI returned malformed lesson. Please try again.'
            });
        }

        const usage = await recordUsage(user, 'ai_custom_lesson', customLimit, dateKey);

        res.status(201).json({
            success: true,
            lesson,
            usage
        });

    } catch (error) {
        console.error('Custom lesson error:', error);
        res.status(500).json({ error: error.message });
    }
});

// ============================================
// GET /api/ai/usage
// Aggregated usage across all AI features
// ============================================
router.get('/usage', authenticateUser, async (req, res) => {
    try {
        const user = await User.findById(req.userId);
        if (!user) return res.status(404).json({ error: 'User not found' });

        const limits = getUserLimits(user);
        const dateKey = getDateKey(parseInt(req.query.timezoneOffsetMinutes));

        const chatLimit = CHAT_LIMITS[user.subscriptionTier] ?? CHAT_LIMITS.free;
        const customLimit = limits.customLessonsPerDay;

        const [chatUsed, customUsed] = await Promise.all([
            UsageCounter.getCount(user._id, 'ai_chat_message', dateKey),
            UsageCounter.getCount(user._id, 'ai_custom_lesson', dateKey)
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