import express from 'express';
import axios from 'axios';
import User from '../models/User.js';
import UsageCounter from '../models/UsageCounter.js';
import { authenticateUser } from '../middleware/auth.js';

const router = express.Router();

// TTS audio daily limits
const TTS_LIMITS = {
    free: 30,
    premium: 300,
    immersive: Infinity
};

function getDateKey(timezoneOffsetMinutes) {
    const now = new Date();
    if (typeof timezoneOffsetMinutes === 'number') {
        const shifted = new Date(now.getTime() + timezoneOffsetMinutes * 60 * 1000);
        return shifted.toISOString().slice(0, 10);
    }
    return now.toISOString().slice(0, 10);
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
    if (limit === Infinity) return { unlimited: true };
    const doc = await UsageCounter.increment(user._id, key, dateKey);
    return { used: doc.count, limit, remaining: Math.max(0, limit - doc.count), dateKey };
}

// ============================================
// POST /tts
// TTS proxy (bypasses CORS) — authenticated + tier-gated
// ============================================
router.post('/tts', authenticateUser, async (req, res) => {
    try {
        const {
            text, voice, speaker, response_format,
            temperature, top_p, repetition_penalty,
            timezoneOffsetMinutes
        } = req.body;

        if (!text) {
            return res.status(400).json({ status: 'error', message: 'Missing "text" field' });
        }
        if (text.length > 500) {
            return res.status(400).json({ status: 'error', message: 'Text too long (max 500 chars)' });
        }

        const NINE_JALINGO_API_KEY = process.env.NINE_JALINGO_API_KEY;
        if (!NINE_JALINGO_API_KEY) {
            return res.status(500).json({ status: 'error', message: '9jaLingo API key not configured' });
        }

        const user = await User.findById(req.userId);
        if (!user) return res.status(404).json({ status: 'error', message: 'User not found' });
        if (user.isBanned) return res.status(403).json({ status: 'error', message: 'Account is banned' });

        const limit = TTS_LIMITS[user.subscriptionTier] ?? TTS_LIMITS.free;
        const dateKey = getDateKey(timezoneOffsetMinutes);

        const gate = await enforceDailyLimit(user, 'tts_generate', limit, dateKey);
        if (!gate.ok) return res.status(gate.response.status).json(gate.response.body);

        const requestBody = {
            text,
            voice: voice || 'titilayo_yo',
            response_format: response_format || 'mp3',
            temperature: temperature || 0.95,
            top_p: top_p || 0.95,
            repetition_penalty: repetition_penalty || 1.1
        };
        if (speaker) requestBody.speaker = speaker;

        const response = await fetch('https://api.9jalingo.org/v1/audio/speech', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-API-Key': NINE_JALINGO_API_KEY
            },
            body: JSON.stringify(requestBody)
        });

        if (!response.ok) {
            const errorText = await response.text();
            return res.status(response.status).json({
                status: 'error',
                message: `9jaLingo API error: ${response.status}`,
                detail: errorText
            });
        }

        const audioBuffer = await response.arrayBuffer();
        const usage = await recordUsage(user, 'tts_generate', limit, dateKey);

        const contentType = response_format === 'wav' ? 'audio/wav'
            : response_format === 'flac' ? 'audio/flac'
            : 'audio/mpeg';

        res.set({
            'Content-Type': contentType,
            'Content-Length': audioBuffer.byteLength,
            'Cache-Control': 'public, max-age=31536000',
            'X-Usage-Limit': String(usage.limit ?? 'unlimited'),
            'X-Usage-Used': String(usage.used ?? 'unlimited'),
            'X-Usage-Remaining': String(usage.remaining ?? 'unlimited')
        });

        res.send(Buffer.from(audioBuffer));

    } catch (error) {
        console.error('TTS proxy error:', error);
        res.status(500).json({ status: 'error', message: error.message });
    }
});

// ============================================
// GET /tts/credits
// ============================================
router.get('/tts/credits', async (req, res) => {
    try {
        const NINE_JALINGO_API_KEY = process.env.NINE_JALINGO_API_KEY;
        if (!NINE_JALINGO_API_KEY) {
            return res.status(500).json({ status: 'error', message: '9jaLingo API key not configured' });
        }
        res.status(200).json({ status: 'success', message: 'API key is configured' });
    } catch (error) {
        res.status(500).json({ status: 'error', message: error.message });
    }
});

// ============================================
// GET /tts/usage
// ============================================
router.get('/usage', authenticateUser, async (req, res) => {
    try {
        const user = await User.findById(req.userId);
        if (!user) return res.status(404).json({ error: 'User not found' });

        const dateKey = getDateKey(parseInt(req.query.timezoneOffsetMinutes));
        const limit = TTS_LIMITS[user.subscriptionTier] ?? TTS_LIMITS.free;
        const used = await UsageCounter.getCount(user._id, 'tts_generate', dateKey);

        res.json({
            dateKey,
            tier: user.subscriptionTier,
            tts: limit === Infinity
                ? { unlimited: true, used }
                : { used, limit, remaining: Math.max(0, limit - used) }
        });
    } catch (error) {
        console.error('Usage error:', error);
        res.status(400).json({ error: error.message });
    }
});

export default router;