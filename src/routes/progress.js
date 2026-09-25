import express from 'express';
import Progress from '../models/Progress.js';
import User from '../models/User.js';
import LessonCompletion from '../models/LessonCompletion.js';
import Pod from '../models/Pod.js';
import Notification from '../models/Notification.js';
import { authenticateUser } from '../middleware/auth.js';
import { qualifyReferralForUser } from './referrals.js';
import { autoApplyFreezeIfNeeded, grantWeeklyFreezeIfEligible } from './streak.js';

const router = express.Router();

/**
 * GET /api/progress
 * Get user progress
 */
router.get('/', authenticateUser, async (req, res) => {
    const { language } = req.query;

    try {
        const query = { userId: req.userId };
        if (language) query.language = language;

        let progress = await Progress.findOne(query);

        if (!progress) {
            progress = await Progress.create({
                userId: req.userId,
                language: language || 'yoruba',
                completedLevels: [],
                completedLessons: [],
                totalXP: 0,
                streak: 0,
                currentLevel: 1
            });
        }

        res.json(progress);
    } catch (error) {
        console.error('Get progress error:', error);
        res.status(400).json({ error: error.message });
    }
});

/**
 * POST /api/progress/complete-lesson
 * Report a completed lesson. Updates streak, XP, lessons.
 */
router.post('/complete-lesson', authenticateUser, async (req, res) => {
    const {
        language,
        levelId,
        lessonId,
        xpEarned = 0,
        perfect = false,
        timeSpentSeconds = 0,
        mistakesCount = 0,
        source = 'curriculum',
        timezoneOffsetMinutes
    } = req.body;

    if (!language || levelId == null || !lessonId) {
        return res.status(400).json({
            error: 'language, levelId, and lessonId are required'
        });
    }

    const safeXP = Math.min(Math.max(0, Number(xpEarned) || 0), 500);
    const safeLevel = Number(levelId);
    const safeTime = Math.min(Math.max(0, Number(timeSpentSeconds) || 0), 3600);

    try {
        const user = await User.findById(req.userId);
        if (!user) return res.status(404).json({ error: 'User not found' });
        if (user.isBanned) return res.status(403).json({ error: 'Account is banned' });

        // Auto-apply streak freeze if user missed exactly one day
        await autoApplyFreezeIfNeeded(req.userId, language);

        // Find or create progress
        let progress = await Progress.findOne({ userId: req.userId, language });
        if (!progress) {
            progress = await Progress.create({
                userId: req.userId,
                language,
                completedLevels: [],
                completedLessons: [],
                totalXP: 0,
                streak: 0,
                currentLevel: 1
            });
        }

        // Determine today's date key (user's timezone)
        const dateKey = getDateKey(timezoneOffsetMinutes);

        // Check if lesson already completed
        const existing = await LessonCompletion.findOne({
            userId: req.userId,
            language,
            levelId: safeLevel,
            lessonId
        });

        const isFirstTime = !existing;

        let completion;
        if (existing) {
            // Re-completion: allow XP if improved, but don't re-award streak/daily
            existing.xpEarned = Math.max(existing.xpEarned, safeXP);
            existing.perfect = existing.perfect || perfect;
            existing.mistakesCount = Math.min(existing.mistakesCount, mistakesCount);
            existing.completedAt = new Date();
            await existing.save();
            completion = existing;
        } else {
            completion = await LessonCompletion.create({
                userId: req.userId,
                language,
                levelId: safeLevel,
                lessonId,
                xpEarned: safeXP,
                perfect,
                timeSpentSeconds: safeTime,
                mistakesCount,
                source
            });
        }

        // ============================================
        // STREAK LOGIC (only on first completion of the day)
        // ============================================
        const isFirstLessonToday = progress.lastCompletedDate !== dateKey;
        let streakChanged = false;

        if (isFirstLessonToday) {
            const yesterday = getDateKey(timezoneOffsetMinutes, -86400000);
            if (progress.lastCompletedDate === yesterday) {
                progress.streak += 1;
            } else if (progress.lastCompletedDate === null) {
                progress.streak = 1;
            } else {
                // Streak was broken but auto-freeze should have handled it; if not, reset
                progress.streak = 1;
            }

            progress.lastCompletedDate = dateKey;
            streakChanged = true;

            if (progress.streak > progress.longestStreak) {
                progress.longestStreak = progress.streak;
            }
        }

        // ============================================
        // XP + LESSON TRACKING
        // ============================================
        if (isFirstTime) {
            progress.totalXP += safeXP;
            progress.weeklyXP += safeXP;

            if (!progress.completedLessons.includes(lessonId)) {
                progress.completedLessons.push(lessonId);
            }

            if (perfect) progress.perfectScores += 1;

            if (isFirstLessonToday) {
                progress.dailyCompleted = 1;
                progress.dailyDateKey = dateKey;
            } else {
                progress.dailyCompleted += 1;
            }

            // Level completion
            // (Simplified: if this is the last lesson of a level, mark it complete.
            //  You can tighten this by checking the curriculum's lesson count.)
            if (!progress.completedLevels.includes(safeLevel)) {
                // Placeholder: mark level complete after the first lesson of that level
                // Replace with a real check against the curriculum if desired
            }
        }

        progress.lastActive = new Date();
        progress.updatedAt = new Date();
        progress.lastCompletedLessonAt = new Date();
        await progress.save();

        // ============================================
        // REFERRAL QUALIFICATION (first lesson ever)
        // ============================================
        if (isFirstTime) {
            const totalLessons = progress.completedLessons.length;
            if (totalLessons === 1) {
                // This is the user's first lesson in this language
                // If it's their first ever, qualify any pending referral
                const anyOtherProgress = await Progress.findOne({
                    userId: req.userId,
                    language: { $ne: language },
                    'completedLessons.0': { $exists: true }
                });

                if (!anyOtherProgress) {
                    await qualifyReferralForUser(req.userId);
                }
            }
        }

        // ============================================
        // WEEKLY FREEZE BONUS
        // ============================================
        let freezeBonus = { granted: false };
        if (streakChanged) {
            freezeBonus = await grantWeeklyFreezeIfEligible(
                req.userId,
                language,
                progress.streak
            );
        }

        // ============================================
        // POD WEEKLY XP UPDATE
        // ============================================
        if (isFirstTime && safeXP > 0) {
            const pods = await Pod.find({
                'members.userId': req.userId,
                language,
                isActive: true
            });
            for (const pod of pods) {
                pod.weeklyXP += safeXP;
                pod.totalXP += safeXP;
                await pod.save();
            }
        }

        res.status(201).json({
            success: true,
            completion: {
                lessonId,
                levelId: safeLevel,
                xpEarned: isFirstTime ? safeXP : 0,
                perfect,
                firstTime: isFirstTime
            },
            progress: {
                language,
                streak: progress.streak,
                longestStreak: progress.longestStreak,
                totalXP: progress.totalXP,
                currentLevel: progress.currentLevel,
                completedLessons: progress.completedLessons.length,
                dailyCompleted: progress.dailyCompleted,
                lastCompletedDate: progress.lastCompletedDate
            },
            streakChanged,
            freezeBonus
        });
    } catch (error) {
        console.error('Complete lesson error:', error);
        res.status(400).json({ error: error.message });
    }
});

/**
 * POST /api/progress/sync
 * Legacy full sync (kept for compatibility)
 */
router.post('/sync', authenticateUser, async (req, res) => {
    const {
        language,
        completedLevels,
        completedLessons,
        totalXP,
        streak,
        currentLevel,
        dailyCompleted,
        perfectScores,
        favorites,
        dailyChallenges,
        lastChallengeGen
    } = req.body;

    if (!language) {
        return res.status(400).json({ error: 'Language is required' });
    }

    try {
        const progress = await Progress.findOneAndUpdate(
            { userId: req.userId, language },
            {
                completedLevels: completedLevels || [],
                completedLessons: completedLessons || [],
                totalXP: totalXP || 0,
                streak: streak || 0,
                currentLevel: currentLevel || 1,
                dailyCompleted: dailyCompleted || 0,
                perfectScores: perfectScores || 0,
                favorites: favorites || [],
                dailyChallenges: dailyChallenges || [],
                lastChallengeGen: lastChallengeGen || null,
                lastActive: new Date()
            },
            { new: true, upsert: true, setDefaultsOnInsert: true }
        );

        await User.findByIdAndUpdate(req.userId, { lastActive: new Date() });

        res.json({ success: true, data: progress });
    } catch (error) {
        console.error('Sync error:', error);
        res.status(400).json({ error: error.message });
    }
});

/**
 * DELETE /api/progress/:language
 */
router.delete('/:language', authenticateUser, async (req, res) => {
    const { language } = req.params;

    try {
        await Progress.findOneAndDelete({ userId: req.userId, language });
        await LessonCompletion.deleteMany({ userId: req.userId, language });

        const progress = await Progress.create({
            userId: req.userId,
            language,
            completedLevels: [],
            completedLessons: [],
            totalXP: 0,
            streak: 0,
            currentLevel: 1
        });

        res.json({ success: true, data: progress });
    } catch (error) {
        console.error('Reset progress error:', error);
        res.status(400).json({ error: error.message });
    }
});

// ============================================
// HELPERS
// ============================================
function getDateKey(timezoneOffsetMinutes, shiftMs = 0) {
    const now = new Date(Date.now() + shiftMs);
    if (typeof timezoneOffsetMinutes === 'number') {
        const shifted = new Date(now.getTime() + timezoneOffsetMinutes * 60 * 1000);
        return shifted.toISOString().slice(0, 10);
    }
    return now.toISOString().slice(0, 10);
}

export default router;