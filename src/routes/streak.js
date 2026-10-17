import express from 'express';
import User from '../models/User.js';
import Progress from '../models/Progress.js';
import StreakFreeze from '../models/StreakFreeze.js';
import { authenticateUser } from '../middleware/auth.js';
import { resolveProfile } from '../middleware/profile.js';

const router = express.Router();

const XP_COST_PER_FREEZE = 200;
const MAX_FREEZES = 3;
const FREE_WEEKLY_FREEZE_THRESHOLD = 7;

/* ============================================================
   GET /api/streak/freezes
   ============================================================ */
router.get('/freezes', authenticateUser, resolveProfile, async (req, res) => {
    try {
        const { language } = req.query;
        if (!language) {
            return res.status(400).json({ error: 'language query param required' });
        }

        const freeze = await StreakFreeze.findOne({
            userId: req.userId,
            profileId: req.profileId || null,
            language
        });

        res.json({
            language,
            available: freeze?.available || 0,
            max: MAX_FREEZES,
            xpCostPerFreeze: XP_COST_PER_FREEZE,
            autoApply: freeze?.autoApply ?? true
        });
    } catch (error) {
        console.error('Get freezes error:', error);
        res.status(400).json({ error: error.message });
    }
});

/* ============================================================
   POST /api/streak/freezes/buy
   ============================================================ */
router.post('/freezes/buy', authenticateUser, resolveProfile, async (req, res) => {
    const { language } = req.body;
    if (!language) return res.status(400).json({ error: 'language required' });

    const profileScope = { profileId: req.profileId || null };

    try {
        const progress = await Progress.findOne({ userId: req.userId, ...profileScope, language });
        if (!progress) {
            return res.status(404).json({ error: 'No progress found for this language' });
        }

        let freeze = await StreakFreeze.findOne({ userId: req.userId, ...profileScope, language });
        if (!freeze) {
            freeze = await StreakFreeze.create({
                userId: req.userId,
                ...profileScope,
                language,
                available: 0
            });
        }

        if (freeze.available >= MAX_FREEZES) {
            return res.status(400).json({
                error: `You already have the max (${MAX_FREEZES}) freezes`,
                available: freeze.available
            });
        }

        if (progress.totalXP < XP_COST_PER_FREEZE) {
            return res.status(400).json({
                error: 'Not enough XP',
                needed: XP_COST_PER_FREEZE,
                have: progress.totalXP
            });
        }

        progress.totalXP -= XP_COST_PER_FREEZE;
        await progress.save();

        freeze.available += 1;
        freeze.purchases.push({ source: 'xp', xpCost: XP_COST_PER_FREEZE });
        await freeze.save();

        res.json({
            success: true,
            available: freeze.available,
            totalXP: progress.totalXP,
            xpSpent: XP_COST_PER_FREEZE
        });
    } catch (error) {
        console.error('Buy freeze error:', error);
        res.status(400).json({ error: error.message });
    }
});

/* ============================================================
   POST /api/streak/freezes/toggle-auto
   ============================================================ */
router.post('/freezes/toggle-auto', authenticateUser, resolveProfile, async (req, res) => {
    const { language: bodyLanguage, autoApply, enabled } = req.body || {};

    const resolvedAutoApply = typeof autoApply === 'boolean'
        ? autoApply
        : typeof enabled === 'boolean'
            ? enabled
            : null;

    let language = bodyLanguage;
    if (!language) {
        const u = await User.findById(req.userId).select('language');
        language = u?.language || 'yoruba';
    }

    if (resolvedAutoApply === null) {
        return res.status(400).json({ error: 'autoApply (or enabled) boolean is required' });
    }

    try {
        const freeze = await StreakFreeze.findOneAndUpdate(
            { userId: req.userId, profileId: req.profileId || null, language },
            { autoApply: resolvedAutoApply },
            { new: true, upsert: true, setDefaultsOnInsert: true }
        );

        res.json({ success: true, autoApply: freeze.autoApply });
    } catch (error) {
        console.error('Toggle auto error:', error);
        res.status(400).json({ error: error.message });
    }
});

/* ============================================================
   POST /api/streak/recover
   ============================================================ */
router.post('/recover', authenticateUser, resolveProfile, async (req, res) => {
    const { language } = req.body;
    if (!language) return res.status(400).json({ error: 'language required' });

    const profileScope = { profileId: req.profileId || null };

    try {
        const progress = await Progress.findOne({ userId: req.userId, ...profileScope, language });
        if (!progress) return res.status(404).json({ error: 'No progress found' });

        const freeze = await StreakFreeze.findOne({ userId: req.userId, ...profileScope, language });
        if (!freeze || freeze.available < 1) {
            return res.status(400).json({ error: 'No streak freeze available' });
        }

        const today = new Date().toISOString().slice(0, 10);
        const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);

        if (progress.lastCompletedDate === today) {
            return res.status(400).json({ error: 'Streak is active — no recovery needed' });
        }

        const previousStreak = progress.longestStreak || 1;

        freeze.available -= 1;
        freeze.used.push({
            usedAt: new Date(),
            protectedDate: yesterday,
            previousStreak
        });
        await freeze.save();

        progress.streak = previousStreak;
        progress.lastCompletedDate = today;
        await progress.save();

        res.json({
            success: true,
            restoredStreak: previousStreak,
            freezesRemaining: freeze.available
        });
    } catch (error) {
        console.error('Recover streak error:', error);
        res.status(400).json({ error: error.message });
    }
});

/* ============================================================
   INTERNAL — auto-applies freeze (called from progress.js)
   ============================================================ */
export async function autoApplyFreezeIfNeeded(userId, profileId, language) {
    try {
        const scope = { userId, profileId: profileId || null, language };
        const freeze = await StreakFreeze.findOne(scope);
        if (!freeze || !freeze.autoApply || freeze.available < 1) {
            return { applied: false };
        }

        const progress = await Progress.findOne(scope);
        if (!progress || !progress.lastCompletedDate) return { applied: false };

        const today = new Date().toISOString().slice(0, 10);
        const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);

        if (progress.lastCompletedDate !== today && progress.lastCompletedDate !== yesterday) {
            const last = new Date(progress.lastCompletedDate);
            const gapDays = Math.floor((new Date(today) - last) / 86400000);

            if (gapDays === 2) {
                freeze.available -= 1;
                freeze.used.push({
                    usedAt: new Date(),
                    protectedDate: yesterday,
                    previousStreak: progress.streak
                });
                await freeze.save();
                return { applied: true, protectedDate: yesterday };
            }
        }

        return { applied: false };
    } catch (error) {
        console.error('Auto apply freeze error:', error);
        return { applied: false, error: error.message };
    }
}

/* ============================================================
   INTERNAL — grant weekly freeze
   ============================================================ */
export async function grantWeeklyFreezeIfEligible(userId, profileId, language, streak) {
    if (streak > 0 && streak % FREE_WEEKLY_FREEZE_THRESHOLD === 0) {
        const freeze = await StreakFreeze.findOneAndUpdate(
            { userId, profileId: profileId || null, language },
            {
                $inc: { available: 1 },
                $push: {
                    purchases: {
                        purchasedAt: new Date(),
                        source: 'weekly_bonus',
                        xpCost: 0
                    }
                }
            },
            { new: true, upsert: true, setDefaultsOnInsert: true }
        );

        if (freeze.available > MAX_FREEZES) {
            freeze.available = MAX_FREEZES;
            await freeze.save();
        }

        return { granted: true, available: freeze.available };
    }
    return { granted: false };
}

export default router;