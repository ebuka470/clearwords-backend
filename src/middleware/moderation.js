// ============================================
// BASELINE BANNED WORD LIST
// Small, high-signal list. Extend as you see abuse.
// ============================================
const BANNED_WORDS = [
    // Slurs (English/Nigerian Pidgin baseline)
    'nigger', 'nigga', 'kike', 'chink', 'spic', 'wetback',
    'faggot', 'fag', 'dyke', 'tranny', 'retard',
    // Severe insults / harassment
    'kys', 'kill yourself', 'kysl',
    // Sexual content (baseline)
    'porn', 'nsfw', 'xxx', 'cum', 'dick pic', 'nudes',
    // Scam signals
    'send money', 'send cash', 'western union', 'bitcoin address',
    'nude photos', 'nude pics'
];

// ============================================
// SUSPICIOUS PATTERNS
// ============================================
const SUSPICIOUS_PATTERNS = [
    { pattern: /https?:\/\//i, reason: 'Links are not allowed in chat' },
    { pattern: /\b\d{10,}\b/, reason: 'Long numbers (possible phone spam) are not allowed' },
    { pattern: /(whatsapp|telegram|t\.me|wa\.me)/i, reason: 'Contact sharing is not allowed' },
    { pattern: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/, reason: 'Email sharing is not allowed' },
    // Repeated character spam (e.g. "aaaaaaaaaa")
    { pattern: /(.)\1{10,}/, reason: 'Spam (repeated characters) is not allowed' },
    // Excessive caps (5+ all-caps words)
    { pattern: /\b[A-Z]{4,}\b(?:\s+\b[A-Z]{4,}\b){3,}/, reason: 'Please do not shout' }
];

const MAX_MESSAGE_LENGTH = 2000;

// ============================================
// AI MODERATION (OpenAI moderation endpoint)
// ============================================
const OPENAI_MODERATION_URL = 'https://api.openai.com/v1/moderations';

/**
 * Calls OpenAI's moderation endpoint.
 * Returns null if disabled or errored (falls back to regex-only).
 */
async function aiModerate(text) {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) return null;

    try {
        const response = await fetch(OPENAI_MODERATION_URL, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${apiKey}`
            },
            body: JSON.stringify({
                model: 'omni-moderation-latest',
                input: text
            })
        });

        if (!response.ok) {
            console.warn('OpenAI moderation non-OK:', response.status);
            return null;
        }

        const data = await response.json();
        const result = data.results?.[0];
        if (!result) return null;

        if (result.flagged) {
            const categories = Object.entries(result.category_scores || {});
            const [topCategory] = categories.sort((a, b) => b[1] - a[1])[0] || ['unknown'];
            return { ok: false, reason: `Message flagged by AI moderation (${topCategory})` };
        }

        return { ok: true };
    } catch (err) {
        console.error('AI moderation error:', err.message);
        return null;
    }
}

// ============================================
// LOCAL SYNC CHECK
// ============================================
export function moderateText(text) {
    if (!text || typeof text !== 'string') {
        return { ok: false, reason: 'Empty message' };
    }

    const trimmed = text.trim();

    if (trimmed.length === 0) {
        return { ok: false, reason: 'Message cannot be empty' };
    }

    if (trimmed.length > MAX_MESSAGE_LENGTH) {
        return { ok: false, reason: `Message too long (max ${MAX_MESSAGE_LENGTH} characters)` };
    }

    const lower = trimmed.toLowerCase();

    for (const word of BANNED_WORDS) {
        if (lower.includes(word.toLowerCase())) {
            return { ok: false, reason: 'Message contains prohibited language' };
        }
    }

    for (const { pattern, reason } of SUSPICIOUS_PATTERNS) {
        if (pattern.test(trimmed)) {
            return { ok: false, reason };
        }
    }

    return { ok: true };
}

// ============================================
// MIDDLEWARE
// ============================================
export async function moderationMiddleware(req, res, next) {
    const text = req.body?.text || req.body?.content?.text;
    if (!text) return next();

    // 1. Fast local check (sync)
    const local = moderateText(text);
    if (!local.ok) {
        return res.status(400).json({ error: local.reason });
    }

    // 2. AI check (async, optional)
    const ai = await aiModerate(text);
    if (ai && !ai.ok) {
        return res.status(400).json({ error: ai.reason });
    }

    next();
}