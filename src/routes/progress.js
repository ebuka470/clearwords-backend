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

/* ============================================================
   CURRICULUM CACHE
   Loads every data/*.json at server start so lesson lookups
   never touch disk during a request.
   ============================================================ */
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const DATA_DIR = path.join(__dirname, '../../data');

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
                    console.log(`📚 Curriculum loaded: ${lang} (${(CURRICULUM[lang].levels || []).length} levels)`);
                } catch (err) {
                    console.warn(`Failed to parse ${file}:`, err.message);
                }
            }
        });
    } else {
        console.warn(`⚠️  Curriculum directory not found: ${DATA_DIR}`);
    }
} catch (err) {
    console.warn('Curriculum load warning:', err.message);
}

/* ============================================================
   HELPERS
   ============================================================ */

/**
 * Look up a lesson in the curriculum. Handles two shapes:
 *
 *   Format A — levels have a nested `lessons: [...]` array
 *              { level: 1, lessons: [{ id: '1-1', vocabulary: [...] }] }
 *
 *   Format B — the level IS the lesson
 *              { level: 1, vocabulary: [...], dialogue: [...] }
 *
 * Returns { lesson, level, totalLessonsInLevel, levelLessonIds } or null.
 */
function findLesson(language, levelId, lessonId) {
    const lang = CURRICULUM[language];
    if (!lang) return null;

    const levels = lang.levels || lang.curriculum?.levels || [];
    if (!levels.length) return null;

    // ---- Locate the level ----
    // Your data files use `level` as the key. Fall back to `id`.
    let level = levels.find(l => Number(l.level) === Number(levelId));
    if (!level) level = levels.find(l => Number(l.id) === Number(levelId));
    if (!level) return null;

    // ---- Custom lessons: never in the curriculum, always valid ----
    if (String(lessonId).startsWith('custom-')) {
        return {
            lesson: { id: lessonId, xpReward: 15 },
            level,
            totalLessonsInLevel: 1,
            levelLessonIds: [String(lessonId)]
        };
    }

    // ---- Format A — nested lessons ----
    if (Array.isArray(level.lessons) && level.lessons.length) {
        const lesson = level.lessons.find(l =>
            String(l.id) === String(lessonId) ||
            String(l.title) === String(lessonId)
        );
        if (!lesson) return null;
        return {
            lesson,
            level,
            totalLessonsInLevel: level.lessons.length,
            levelLessonIds: level.lessons.map(l => String(l.id))
        };
    }

    // ---- Format B — the level IS the lesson ----
    // Accept several plausible ID shapes for the same level:
    //   "1", "level-1", "level-1-anything", the level's own id, its title
    const acceptedIds = [
        String(levelId),
        `level-${levelId}`,
        level.id ? String(level.id) : null,
        level.title ? String(level.title) : null,
        level.topic ? String(level.topic) : null
    ].filter(Boolean);

    const matches =
        acceptedIds.includes(String(lessonId)) ||
        String(lessonId).startsWith(`level-${levelId}`);

    if (!matches) return null;

    return {
        lesson: level,
        level,
        totalLessonsInLevel: 1,
        levelLessonIds: [String(lessonId)]
    };
}

/**
 * Server-computed XP. Never trusts the client.
 *   Base: lesson.xpReward (or 10 if absent)
 *   Perfect bonus: +50%
 *   Speed bonus: +20% if completed under 60s
 *   Mistake penalty: −2 XP per mistake (min 5 XP)
 *   Cap: 200 XP
 */
function computeXP({ perfect, timeSpentSeconds, mistakesCount, lesson }) {
    let xp = lesson?.xpReward || 10;

    if (perfect) xp = Math.round(xp * 1.5);
    if (timeSpentSeconds > 0 && timeSpentSeconds < 60) xp = Math.round(xp * 1.2);

    xp = Math.max(5, xp - (mistakesCount * 2));
    xp = Math.min(xp, 200);

    return xp;
}

/**
 * Date key in the user's timezone, e.g. '2026-10-02'.
 */
function getDateKey(timezoneOffsetMinutes, shiftMs = 0) {
    const now = new Date(Date.now() + shiftMs);
    if (typeof timezoneOffsetMinutes === 'number') {
        const shifted = new Date(now.getTime() + timezoneOffsetMinutes * 60 * 1000);
        return shifted.toISOString().slice(0, 10);
    }
    return now.toISOString().slice(0, 10);
}

/* ============================================================
   GET /api/progress
   Fetch the user's progress for one language (creates an empty
   record on first access).
   ============================================================ */
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

/* ============================================================
   POST /api/progress/complete-lesson
   The core learning endpoint. Accepts either `levelId` or
   `levelNumber`; tolerates missing `language` by defaulting
   to the user's primary language.
   ============================================================ */
router.post('/complete-lesson', authenticateUser, async (req, res) => {
    const {
        language: bodyLanguage,
        levelId,
        levelNumber,
        lessonId,
        perfect = false,
        timeSpentSeconds = 0,
        mistakesCount = 0,
        source = 'curriculum',
        timezoneOffsetMinutes
    } = req.body;

    // Resolve language
    let language = bodyLanguage;
    if (!language) {
        const u = await User.findById(req.userId).select('language');
        language = u?.language || 'yoruba';
    }

    // Resolve level from either alias
    const resolvedLevel = levelId != null ? levelId : levelNumber;

    if (!language || resolvedLevel == null || !lessonId) {
        return res.status(400).json({
            error: 'language, levelId (or levelNumber), and lessonId are required'
        });
    }

    const safeLevel = Number(resolvedLevel);
    const safeTime = Math.min(Math.max(0, Number(timeSpentSeconds) || 0), 3600);
    const safeMistakes = Math.min(Math.max(0, Number(mistakesCount) || 0), 100);

    try {
        const user = await User.findById(req.userId);
        if (!user) return res.status(404).json({ error: 'User not found' });
        if (user.isBanned) return res.status(403).json({ error: 'Account is banned' });

        // ---- Look up lesson ----
        const found = findLesson(language, safeLevel, lessonId);

        let foundLesson;
        let xpEarned;

        if (found) {
            foundLesson = found;
            xpEarned = computeXP({
                perfect,
                timeSpentSeconds: safeTime,
                mistakesCount: safeMistakes,
                lesson: found.lesson
            });
        } else {
            // Graceful fallback for custom lessons and lessons where the
            // ID doesn't exactly match. Only reject if BOTH the lesson ID
            // isn't a custom-* string AND the level is out of range.
            const isCustom = String(lessonId).startsWith('custom-');
            const plausibleLevel = safeLevel >= 1 && safeLevel <= 100;

            if (!isCustom && !plausibleLevel) {
                return res.status(404).json({
                    error: 'Lesson not found in curriculum',
                    language,
                    levelId: safeLevel,
                    lessonId
                });
            }

            console.warn('complete-lesson: using fallback for unknown lesson', {
                language,
                levelId: safeLevel,
                lessonId,
                isCustom
            });

            foundLesson = {
                lesson: { id: lessonId, xpReward: isCustom ? 15 : 25 },
                level: { level: safeLevel },
                totalLessonsInLevel: 1,
                levelLessonIds: [String(lessonId)]
            };

            xpEarned = computeXP({
                perfect,
                timeSpentSeconds: safeTime,
                mistakesCount: safeMistakes,
                lesson: foundLesson.lesson
            });
        }

        // ---- Auto-apply streak freeze if user missed exactly one day ----
        await autoApplyFreezeIfNeeded(req.userId, language);

        // ---- Find or create Progress record ----
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

        // ---- Record the completion (or update if repeated) ----
        const existing = await LessonCompletion.findOne({
            userId: req.userId,
            language,
            levelId: safeLevel,
            lessonId
        });

        const isFirstTime = !existing;

        if (existing) {
            existing.xpEarned = Math.max(existing.xpEarned, xpEarned);
            existing.perfect = existing.perfect || perfect;
            existing.mistakesCount = Math.min(existing.mistakesCount, safeMistakes);
            existing.completedAt = new Date();
            await existing.save();
        } else {
            await LessonCompletion.create({
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

        /* ============================================
           STREAK (only on first completion of the day)
           ============================================ */
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

        /* ============================================
           XP + LESSON TRACKING
           ============================================ */
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

        /* ============================================
           LEVEL COMPLETION
           ============================================ */
        let levelCompleted = false;

        if (!progress.completedLevels.includes(safeLevel)) {
            const completedInLevel = await LessonCompletion.countDocuments({
                userId: req.userId,
                language,
                levelId: safeLevel,
                lessonId: { $in: foundLesson.levelLessonIds }
            });

            if (completedInLevel >= foundLesson.totalLessonsInLevel && foundLesson.totalLessonsInLevel > 0) {
                progress.completedLevels.push(safeLevel);
                progress.currentLevel = Math.max(progress.currentLevel, safeLevel + 1);
                levelCompleted = true;

                const levelBonus = 50 + (safeLevel * 10);
                progress.totalXP += levelBonus;

                await Notification.create({
                    userId: req.userId,
                    type: 'level_completed',
                    content: `🎉 Level ${safeLevel} complete in ${language}! +${levelBonus} XP`
                });
            }
        }

        progress.lastActive = new Date();
        progress.updatedAt = new Date();
        progress.lastCompletedLessonAt = new Date();
        await progress.save();

        /* ============================================
           REFERRAL QUALIFICATION (first-ever lesson)
           ============================================ */
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

        /* ============================================
           WEEKLY FREEZE BONUS
           ============================================ */
        let freezeBonus = { granted: false };
        if (streakChanged) {
            freezeBonus = await grantWeeklyFreezeIfEligible(
                req.userId,
                language,
                progress.streak
            );
        }

        /* ============================================
           POD WEEKLY XP UPDATE
           ============================================ */
        if (isFirstTime && xpEarned > 0) {
            const pods = await Pod.find({
                'members.userId': req.userId,
                language,
                isActive: true
            });
            for (const pod of pods) {
                pod.weeklyXP = (pod.weeklyXP || 0) + xpEarned;
                pod.totalXP = (pod.totalXP || 0) + xpEarned;
                await pod.save();
            }
        }

        /* ============================================
           RESPONSE
           ============================================ */
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

/* ============================================================
   POST /api/progress/sync
   Legacy full sync. Used by onboarding to seed the placement
   level for a fresh language.
   ============================================================ */
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

/* ============================================================
   DELETE /api/progress/:language
   Reset a language's progress.
   ============================================================ */
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

export default router;