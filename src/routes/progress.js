import express from 'express';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import Progress from '../models/Progress.js';
import User from '../models/User.js';
import LessonCompletion from '../models/LessonCompletion.js';
import Pod from '../models/Pod.js';
import Notification from '../models/Notification.js';
import { authenticateUser } from '../middleware/auth.js';
import { qualifyReferralForUser } from './referrals.js';
import { autoApplyFreezeIfNeeded, grantWeeklyFreezeIfEligible } from './streak.js';

const router = express.Router();

// ============================================
// CURRICULUM CACHE (for XP + level completion)
// ============================================
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const DATA_DIR = path.join(__dirname, '../data');

const CURRICULUM = {};
try {
    if (fs.existsSync(DATA_DIR)) {
        const files = fs.readdirSync(DATA_DIR);
        files.forEach(file => {
            if (file.endsWith('.json')) {
                const lang = file.replace('.json', '');
                try {
                    CURRICULUM[lang] = JSON.parse(
                        fs.readFileSync(path.join(DATA_DIR, file), 'utf8')
                    );
                } catch (err) {
                    console.warn(`Failed to parse ${file}:`, err.message);
                }
            }
        });
    }
} catch (err) {
    console.warn('Curriculum load warning:', err.message);
}

/**
 * Look up a lesson in the curriculum.
 * Returns { lesson, level, totalLessonsInLevel } or null.
 */
function findLesson(language, levelId, lessonId) {
    const lang = CURRICULUM[language];
    if (!lang) return null;

    const levels = lang.levels || lang.curriculum?.levels || [];
    const level = levels.find(l => Number(l.id) === Number(levelId));
    if (!level) return null;

    const lessons = level.lessons || [];
    const lesson = lessons.find(l => String(l.id) === String(lessonId));
    if (!lesson) return null;

    return {
        lesson,
        level,
        totalLessonsInLevel: lessons.length,
        levelLessonIds: lessons.map(l => String(l.id))
    };
}

/**
 * Compute XP server-side. Never trust the client.
 *   Base: 10 XP per lesson
 *   Perfect bonus: +50%
 *   Speed bonus: +20% if completed under 60s
 *   Mistake penalty: -2 XP per mistake (min 5 XP)
 */
function computeXP({ perfect, timeSpentSeconds, mistakesCount, lesson }) {
    let xp = lesson?.xpReward || 10;

    if (perfect) xp = Math.round(xp * 1.5);
    if (timeSpentSeconds > 0 && timeSpentSeconds < 60) xp = Math.round(xp * 1.2);

    xp = Math.max(5, xp - (mistakesCount * 2));
    xp = Math.min(xp, 200); // hard cap

    return xp;
}

/**
 * GET /api/progress
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
 * Server computes XP. Client only reports performance metrics.
 */
router.post('/complete-lesson', authenticateUser, async (req, res) => {
    const {
        language,
        levelId,
        lessonId,
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

    const safeLevel = Number(levelId);
    const safeTime = Math.min(Math.max(0, Number(timeSpentSeconds) || 0), 3600);
    const safeMistakes = Math.min(Math.max(0, Number(mistakesCount) || 0), 100);

    try {
        const user = await User.findById(req.userId);
        if (!user) return res.status(404).json({ error: 'User not found' });
        if (user.isBanned) return res.status(403).json({ error: 'Account is banned' });

        // Look up the lesson in the curriculum
        const found = findLesson(language, safeLevel, lessonId);
        if (!found) {
            return res.status(404).json({
                error: 'Lesson not found in curriculum',
                language,
                levelId: safeLevel,
                lessonId
            });
        }

        // Server-computed XP
        const xpEarned = computeXP({
            perfect,
            timeSpentSeconds: safeTime,
            mistakesCount: safeMistakes,
            lesson: found.lesson
        });

        // Auto-apply streak freeze if user missed exactly one day
        await autoApplyFreezeIfNeeded(req.userId, language);

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

        const dateKey = getDateKey(timezoneOffsetMinutes);

        const existing = await LessonCompletion.findOne({
            userId: req.userId,
            language,
            levelId: safeLevel,
            lessonId
        });

        const isFirstTime = !existing;

        let completion;
        if (existing) {
            existing.xpEarned = Math.max(existing.xpEarned, xpEarned);
            existing.perfect = existing.perfect || perfect;
            existing.mistakesCount = Math.min(existing.mistakesCount, safeMistakes);
            existing.completedAt = new Date();
            await existing.save();
            completion = existing;
        } else {
            completion = await LessonCompletion.create({
                userId: req.userId,
                language,
                levelId: safeLevel,
                lessonId,
                xpEarned,
                perfect,
                timeSpentSeconds: safeTime,
                mistakesCount: safeMistakes,
                source
            });
        }

        // ============================================
        // STREAK (only on first completion of the day)
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
            progress.totalXP += xpEarned;
            progress.weeklyXP = (progress.weeklyXP || 0) + xpEarned;

            if (!progress.completedLessons.includes(lessonId)) {
                progress.completedLessons.push(lessonId);
            }

            if (perfect) progress.perfectScores = (progress.perfectScores || 0) + 1;

            if (isFirstLessonToday) {
                progress.dailyCompleted = 1;
                progress.dailyDateKey = dateKey;
            } else {
                progress.dailyCompleted = (progress.dailyCompleted || 0) + 1;
            }
        }

        // ============================================
        // LEVEL COMPLETION (real check against curriculum)
        // ============================================
        let levelCompleted = false;

        if (!progress.completedLevels.includes(safeLevel)) {
            // Count how many lessons of this level the user has completed
            const completedInLevel = await LessonCompletion.countDocuments({
                userId: req.userId,
                language,
                levelId: safeLevel,
                lessonId: { $in: found.levelLessonIds }
            });

            if (completedInLevel >= found.totalLessonsInLevel && found.totalLessonsInLevel > 0) {
                progress.completedLevels.push(safeLevel);
                progress.currentLevel = Math.max(progress.currentLevel, safeLevel + 1);
                levelCompleted = true;

                // Award level completion bonus
                const levelBonus = 50 + (safeLevel * 10);
                progress.totalXP += levelBonus;

                // Notify
                await Notification.create({
                    userId: req.userId,
                    type: 'pod_milestone',
                    content: `🎉 Level ${safeLevel} complete in ${language}! +${levelBonus} XP`
                });
            }
        }

        progress.lastActive = new Date();
        progress.updatedAt = new Date();
        progress.lastCompletedLessonAt = new Date();
        await progress.save();

        // ============================================
        // REFERRAL QUALIFICATION (first-ever lesson)
        // ============================================
        if (isFirstTime && progress.completedLessons.length === 1) {
            const anyOtherProgress = await Progress.findOne({
                userId: req.userId,
                language: { $ne: language },
                'completedLessons.0': { $exists: true }
            });

            if (!anyOtherProgress) {
                await qualifyReferralForUser(req.userId);
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
        if (isFirstTime && xpEarned > 0) {
            const pods = await Pod.find({
                'members.userId': req.userId,
                language,
                isActive: true
            });
            for (const pod of pods) {
                pod.weeklyXP += xpEarned;
                pod.totalXP += xpEarned;
                await pod.save();
            }
        }

        res.status(201).json({
            success: true,
            completion: {
                lessonId,
                levelId: safeLevel,
                xpEarned: isFirstTime ? xpEarned : 0,
                perfect,
                firstTime: isFirstTime
            },
            levelCompleted,
            progress: {
                language,
                streak: progress.streak,
                longestStreak: progress.longestStreak,
                totalXP: progress.totalXP,
                currentLevel: progress.currentLevel,
                completedLessons: progress.completedLessons.length,
                completedLevels: progress.completedLevels,
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
 * Legacy full sync
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

function getDateKey(timezoneOffsetMinutes, shiftMs = 0) {
    const now = new Date(Date.now() + shiftMs);
    if (typeof timezoneOffsetMinutes === 'number') {
        const shifted = new Date(now.getTime() + timezoneOffsetMinutes * 60 * 1000);
        return shifted.toISOString().slice(0, 10);
    }
    return now.toISOString().slice(0, 10);
}

export default router;