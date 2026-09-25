import express from 'express';
import User from '../models/User.js';
import Progress from '../models/Progress.js';
import StreakFreeze from '../models/StreakFreeze.js';
import { authenticateUser } from '../middleware/auth.js';

const router = express.Router();

// ============================================
// CONFIG
// ============================================
const XP_COST_PER_FREEZE = 200;         // Buy a freeze for 200 XP
const MAX_FREEZES = 3;                  // Cap inventory
const FREE_WEEKLY_FREEZE_THRESHOLD = 7; // 7-day streak = 1 free freeze

// ============================================
// GET /api/streak/freezes
// Current freeze inventory
// ============================================
router.get('/freezes', authenticateUser, async (req, res) => {
    try {
        const { language } = req.query;

        if (!language) {
            return res.status(400).json({ error: 'language query param required' });
        }

        const freeze = await StreakFreeze.findOne({ userId: req.userId, language });

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

// ============================================
// POST /api/streak/freezes/buy
// Buy a freeze with XP
// ============================================
router.post('/freezes/buy', authenticateUser, async (req, res) => {
    const { language } = req.body;

    if (!language) return res.status(400).json({ error: 'language required' });

    try {
        const progress = await Progress.findOne({ userId: req.userId, language });
        if (!progress) {
            return res.status(404).json({ error: 'No progress found for this language' });
        }

        let freeze = await StreakFreeze.findOne({ userId: req.userId, language });
        if (!freeze) {
            freeze = await StreakFreeze.create({
                userId: req.userId,
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

        // Deduct XP, add freeze
        progress.totalXP -= XP_COST_PER_FREEZE;
        await progress.save();

        freeze.available += 1;
        freeze.purchases.push({
            source: 'xp',
            xpCost: XP_COST_PER_FREEZE
        });
        await freeze.save();

        // Keep user in sync
        await User.findByIdAndUpdate(req.userId, {
            $set: { streakFreezesAvailable: freeze.available }
        });

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

// ============================================
// POST /api/streak/freezes/toggle-auto
// ============================================
router.post('/freezes/toggle-auto', authenticateUser, async (req, res) => {
    const { language, autoApply } = req.body;

    if (!language || typeof autoApply !== 'boolean') {
        return res.status(400).json({ error: 'language and autoApply (boolean) required' });
    }

    try {
        const freeze = await StreakFreeze.findOneAndUpdate(
            { userId: req.userId, language },
            { autoApply },
            { new: true, upsert: true, setDefaultsOnInsert: true }
        );

        res.json({ success: true, autoApply: freeze.autoApply });
    } catch (error) {
        console.error('Toggle auto error:', error);
        res.status(400).json({ error: error.message });
    }
});

// ============================================
// POST /api/streak/recover
// Recover a broken streak by spending a freeze
// Called when user opens the app after missing a day
// ============================================
router.post('/recover', authenticateUser, async (req, res) => {
    const { language } = req.body;

    if (!language) return res.status(400).json({ error: 'language required' });

    try {
        const progress = await Progress.findOne({ userId: req.userId, language });
        if (!progress) return res.status(404).json({ error: 'No progress found' });

        const freeze = await StreakFreeze.findOne({ userId: req.userId, language });
        if (!freeze || freeze.available < 1) {
            return res.status(400).json({ error: 'No streak freeze available' });
        }

        // Check if streak was actually broken recently
        // We compare lastCompletedDate to today — if it's more than 1 day back, streak is broken
        const today = new Date().toISOString().slice(0, 10);
        const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);

        if (progress.lastCompletedDate === today) {
            return res.status(400).json({ error: 'Streak is active — no recovery needed' });
        }

        // Recover: restore streak to 1 (or preserve the previous best minus one gap)
        // Simple policy: restore the previous streak value, cap at longestStreak
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

        await User.findByIdAndUpdate(req.userId, {
            $set: { streakFreezesAvailable: freeze.available }
        });

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

// ============================================
// INTERNAL — called from progress.js after lesson completion
// Auto-applies a freeze if user missed a day and has autoApply on.
// ============================================
export async function autoApplyFreezeIfNeeded(userId, language) {
    try {
        const freeze = await StreakFreeze.findOne({ userId, language });
        if (!freeze || !freeze.autoApply || freeze.available < 1) {
            return { applied: false };
        }

        const progress = await Progress.findOne({ userId, language });
        if (!progress || !progress.lastCompletedDate) return { applied: false };

        const today = new Date().toISOString().slice(0, 10);
        const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);

        // If last completed date is NOT today and NOT yesterday, a day was missed
        if (progress.lastCompletedDate !== today && progress.lastCompletedDate !== yesterday) {
            // Only auto-apply if the gap is exactly 1 day
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

                await User.findByIdAndUpdate(userId, {
                    $set: { streakFreezesAvailable: freeze.available }
                });

                return { applied: true, protectedDate: yesterday };
            }
        }

        return { applied: false };
    } catch (error) {
        console.error('Auto apply freeze error:', error);
        return { applied: false, error: error.message };
    }
}

// ============================================
// INTERNAL — grant free weekly freeze on 7-day streak
// ============================================
export async function grantWeeklyFreezeIfEligible(userId, language, streak) {
    if (streak > 0 && streak % FREE_WEEKLY_FREEZE_THRESHOLD === 0) {
        const freeze = await StreakFreeze.findOneAndUpdate(
            { userId, language },
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

        // Cap
        if (freeze.available > MAX_FREEZES) {
            freeze.available = MAX_FREEZES;
            await freeze.save();
        }

        await User.findByIdAndUpdate(userId, {
            $set: { streakFreezesAvailable: freeze.available }
        });

        return { granted: true, available: freeze.available };
    }
    return { granted: false };
}

export default router;