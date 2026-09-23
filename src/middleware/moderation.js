const BANNED_WORDS = [
    // Add slurs, threats, etc. here
    // This is a stub — replace with real AI moderation in production
];

const SUSPICIOUS_PATTERNS = [
    /https?:\/\//i,          // no links in pod chat
    /\b\d{10,}\b/,           // long numbers (phone spam)
    /(whatsapp|telegram|t\.me)/i
];

export function moderateText(text) {
    if (!text || typeof text !== 'string') {
        return { ok: false, reason: 'Empty message' };
    }

    if (text.length > 2000) {
        return { ok: false, reason: 'Message too long' };
    }

    const lower = text.toLowerCase();

    for (const word of BANNED_WORDS) {
        if (lower.includes(word.toLowerCase())) {
            return { ok: false, reason: 'Message contains prohibited language' };
        }
    }

    for (const pattern of SUSPICIOUS_PATTERNS) {
        if (pattern.test(text)) {
            return { ok: false, reason: 'Links and contact info are not allowed in chat' };
        }
    }

    return { ok: true };
}

export function moderationMiddleware(req, res, next) {
    // Only moderate text-bearing requests
    const text = req.body?.text || req.body?.content?.text;
    if (!text) return next();

    const result = moderateText(text);
    if (!result.ok) {
        return res.status(400).json({ error: result.reason });
    }
    next();
}