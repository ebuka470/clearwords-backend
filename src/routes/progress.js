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
import { resolveProfile } from '../middleware/profile.js';
import { qualifyReferralForUser } from './referrals.js';
import { autoApplyFreezeIfNeeded, grantWeeklyFreezeIfEligible } from './streak.js';

const router = express.Router();

/* ============================================================
   CURRICULUM CACHE
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
function findLesson(language, levelId, lessonId) {
    const lang = CURRICULUM[language];
    if (!lang) return null;

    const levels = lang.levels || lang.curriculum?.levels || [];
    if (!levels.length) return null;

    let level = levels.find(l => Number(l.level) === Number(levelId));
    if (!level) level = levels.find(l => Number(l.id) === Number(levelId));
    if (!level) return null;

    if (String(lessonId).startsWith('custom-')) {
        return {
            lesson: { id: lessonId, xpReward: 15 },
            level,
            totalLessonsInLevel: 1,
            levelLessonIds: [String(lessonId)]
        };
    }

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

function computeXP({ perfect, timeSpentSeconds, mistakesCount, lesson }) {
    let xp = lesson?.xpReward || 10;
    if (perfect) xp = Math.round(xp * 1.5);
    if (timeSpentSeconds > 0 && timeSpentSeconds < 60) xp = Math.round(xp * 1.2);
    xp = Math.max(5, xp - (mistakesCount * 2));
    xp = Math.min(xp, 200);
    return xp;
}

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
   ============================================================ */
router.get('/', authenticateUser, resolveProfile, async (req, res) => {
    const { language } = req.query;

    try {
        const query = { userId: req.userId, profileId: req.profileId || null };
        if (language) query.language = language;

        let progress = await Progress.findOne(query);

        if (!progress) {
            progress = await Progress.create({
                userId: req.userId,
                profileId: req.profileId || null,
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
   ============================================================ */
router.post('/complete-lesson', authenticateUser, resolveProfile, async (req, res) => {
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

    let language = bodyLanguage;
    if (!language) {
        const u = await User.findById(req.userId).select('language');
        language = u?.language || 'yoruba';
    }

    const resolvedLevel = levelId != null ? levelId : levelNumber;

    if (!language || resolvedLevel == null || !lessonId) {
        return res.status(400).json({
            error: 'language, levelId (or levelNumber), and lessonId are required'
        });
    }

    const safeLevel = Number(resolvedLevel);
    const safeTime = Math.min(Math.max(0, Number(timeSpentSeconds) || 0), 3600);
    const safeMistakes = Math.min(Math.max(0, Number(mistakesCount) || 0), 100);
    const profileScope = { profileId: req.profileId || null };

    try {
        const user = await User.findById(req.userId);
        if (!user) return res.status(404).json({ error: 'User not found' });
        if (user.isBanned) return res.status(403).json({ error: 'Account is banned' });

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

        await autoApplyFreezeIfNeeded(req.userId, req.profileId || null, language);

        let progress = await Progress.findOne({ userId: req.userId, ...profileScope, language });
        if (!progress) {
            progress = await Progress.create({
                userId: req.userId,
                ...profileScope,
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
            ...profileScope,
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
                ...profileScope,
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

        let levelCompleted = false;

        if (!progress.completedLevels.includes(safeLevel)) {
            const completedInLevel = await LessonCompletion.countDocuments({
                userId: req.userId,
                ...profileScope,
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
                    profileId: req.profileId || null,
                    type: 'level_completed',
                    content: `🎉 Level ${safeLevel} complete in ${language}! +${levelBonus} XP`
                });
            }
        }

        progress.lastActive = new Date();
        progress.updatedAt = new Date();
        progress.lastCompletedLessonAt = new Date();
        await progress.save();

        if (isFirstTime && progress.completedLessons.length === 1) {
            const anyOtherProgress = await Progress.findOne({
                userId: req.userId,
                ...profileScope,
                language: { $ne: language },
                'completedLessons.0': { $exists: true }
            });

            if (!anyOtherProgress) {
                await qualifyReferralForUser(req.userId);
            }
        }

        let freezeBonus = { granted: false };
        if (streakChanged) {
            freezeBonus = await grantWeeklyFreezeIfEligible(
                req.userId,
                req.profileId || null,
                language,
                progress.streak
            );
        }

        if (isFirstTime && xpEarned > 0) {
            const podQuery = {
                'members.userId': req.userId,
                language,
                isActive: true
            };
            if (req.profileId) podQuery['members.profileId'] = req.profileId;
            const pods = await Pod.find(podQuery);
            for (const pod of pods) {
                pod.weeklyXP = (pod.weeklyXP || 0) + xpEarned;
                pod.totalXP = (pod.totalXP || 0) + xpEarned;
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

/* ============================================================
   POST /api/progress/sync
   ============================================================ */
router.post('/sync', authenticateUser, resolveProfile, async (req, res) => {
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
            { userId: req.userId, profileId: req.profileId || null, language },
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
   ============================================================ */
router.delete('/:language', authenticateUser, resolveProfile, async (req, res) => {
    const { language } = req.params;
    const profileScope = { profileId: req.profileId || null };

    try {
        await Progress.findOneAndDelete({ userId: req.userId, ...profileScope, language });
        await LessonCompletion.deleteMany({ userId: req.userId, ...profileScope, language });

        const progress = await Progress.create({
            userId: req.userId,
            ...profileScope,
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