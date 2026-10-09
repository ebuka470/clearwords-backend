import express from 'express';
import User from '../models/User.js';
import Progress from '../models/Progress.js';
import Pod from '../models/Pod.js';
import Pair from '../models/Pair.js';

import {
    authenticateUser,
    authenticateOptionalUser
} from '../middleware/auth.js';

const router = express.Router();

// ============================================
// VALID ENUM VALUES
// Kept in sync with models/User.js — reject silently invalid
// values by falling back to defaults instead of throwing.
// ============================================
const VALID_ACCOUNT_TYPES = ['personal', 'family'];
const VALID_LEARNING_FOR = ['myself', 'child', 'family', 'both'];
const VALID_GOALS = [
    'talk_family',
    'understand',
    'speak',
    'pronunciation',
    'culture',
    'read_write',
    'teach_child',
    'visit_nigeria'
];

// ============================================
// PUT /api/users/profile
// ============================================

router.put(
    '/profile',
    authenticateUser,
    async (req, res) => {
        const {
            fullName,
            username,
            bio,
            location,
            language,
            primaryLanguage,
            segment,
            isPublic,
            learningLanguages,
            teachingLanguages,
            timezoneOffsetMinutes,
            accountType,
            learningFor,
            goals,
            savedWords,
            notificationsEnabled
        } = req.body;

        try {
            const user = await User.findById(req.userId);

            if (!user) {
                return res.status(404).json({ error: 'User not found' });
            }

            // ------------------------------------
            // Username
            // ------------------------------------

            if (username !== undefined && username !== null) {
                const normalizedUsername = String(username)
                    .trim()
                    .toLowerCase()
                    .replace(/^@/, '');

                if (normalizedUsername && normalizedUsername !== user.username) {
                    if (normalizedUsername.length < 3 || normalizedUsername.length > 30) {
                        return res.status(400).json({
                            error: 'Username must be between 3 and 30 characters'
                        });
                    }

                    if (!/^[a-z0-9._]+$/.test(normalizedUsername)) {
                        return res.status(400).json({
                            error: 'Username can only contain letters, numbers, dots and underscores'
                        });
                    }

                    const existing = await User.findOne({
                        username: normalizedUsername,
                        _id: { $ne: user._id }
                    });

                    if (existing) {
                        return res.status(409).json({ error: 'Username already taken' });
                    }

                    user.username = normalizedUsername;
                }
            }

            // ------------------------------------
            // Basic profile fields
            // ------------------------------------

            if (typeof fullName === 'string' && fullName.trim()) {
                user.fullName = fullName.trim();
            }

            if (typeof bio === 'string') {
                user.bio = bio.trim();
            }

            if (typeof location === 'string') {
                user.location = location.trim();
            }

            // Language: accept either `language` or `primaryLanguage`
            const resolvedLanguage = language || primaryLanguage;
            if (typeof resolvedLanguage === 'string') {
                user.language = resolvedLanguage;
            }

            if (typeof segment === 'string') {
                user.segment = segment;
            }

            if (typeof isPublic === 'boolean') {
                user.isPublic = isPublic;
            }

            // ------------------------------------
            // Onboarding-derived fields
            // ------------------------------------

            if (typeof accountType === 'string' && VALID_ACCOUNT_TYPES.includes(accountType)) {
                user.accountType = accountType;
            }

            if (typeof learningFor === 'string' && VALID_LEARNING_FOR.includes(learningFor)) {
                user.learningFor = learningFor;
            }

            if (Array.isArray(goals)) {
                user.goals = goals
                    .filter(g => VALID_GOALS.includes(g))
                    .slice(0, 12);
            }

            // ------------------------------------
            // Languages
            // ------------------------------------

            if (Array.isArray(learningLanguages)) {
                user.learningLanguages = learningLanguages;
            }

            if (Array.isArray(teachingLanguages)) {
                user.teachingLanguages = teachingLanguages;
            }

            if (typeof timezoneOffsetMinutes === 'number') {
                user.timezoneOffsetMinutes = timezoneOffsetMinutes;
            }

            // ------------------------------------
            // Saved words (learn tab bookmark sync)
            // ------------------------------------

            if (Array.isArray(savedWords)) {
                user.savedWords = savedWords
                    .slice(0, 500)
                    .map(w => ({
                        word: String(w.word || '').slice(0, 100),
                        translation: String(w.translation || '').slice(0, 200),
                        pronunciation: String(w.pronunciation || '').slice(0, 100),
                        example: String(w.example || '').slice(0, 300),
                        language: String(w.language || user.language).slice(0, 40),
                        savedAt: w.savedAt ? new Date(w.savedAt) : new Date()
                    }))
                    .filter(w => w.word);
            }

            // ------------------------------------
            // Notification preference
            // ------------------------------------

            if (typeof notificationsEnabled === 'boolean') {
                user.notificationsEnabled = notificationsEnabled;
            }

            await user.save();

            return res.json({
                id: user._id,
                email: user.email,
                emailVerified: user.emailVerified,

                fullName: user.fullName,
                username: user.username,
                bio: user.bio,
                location: user.location,
                avatarUrl: user.avatarUrl,
                coverPhotoUrl: user.coverPhotoUrl,

                language: user.language,
                segment: user.segment,
                accountType: user.accountType,
                learningFor: user.learningFor,
                goals: user.goals || [],
                placementLevel: user.placementLevel,

                isPublic: user.isPublic,
                learningLanguages: user.learningLanguages,
                teachingLanguages: user.teachingLanguages,
                timezoneOffsetMinutes: user.timezoneOffsetMinutes,

                savedWords: user.savedWords || [],
                notificationsEnabled: !!user.notificationsEnabled
            });
        } catch (error) {
            console.error('Update profile error:', error);

            if (error.code === 11000) {
                return res.status(409).json({ error: 'Username already taken' });
            }

            return res.status(400).json({
                error: error.message || 'Could not update profile'
            });
        }
    }
);

// ============================================
// GET /api/users/:userId/stats
// ============================================

router.get(
    '/:userId/stats',
    async (req, res) => {
        try {
            const user = await User.findById(req.params.userId);

            if (!user || user.isBanned) {
                return res.status(404).json({ error: 'User not found' });
            }

            return res.json({
                podsJoined: user.podsJoined || 0,
                activePairs: user.activePairs || 0,
                cardsShared: user.cardsShared || 0
            });
        } catch (error) {
            console.error('Get stats error:', error);
            return res.status(400).json({ error: 'Could not retrieve user stats' });
        }
    }
);

// ============================================
// GET /api/users/:userId/community-profile
//
// What a pod / pair member sees when tapping someone's name or photo.
// WHITELIST ONLY: name, username, avatar, bio, language, joined date and
// learning progress. Never tier, pods, pairs, email or anything else.
// Private profiles are visible only to people who share an active pod or
// an active pair with them (and to the owner).
// ============================================

router.get(
    '/:userId/community-profile',
    authenticateUser,
    async (req, res) => {
        const { userId } = req.params;
        if (!/^[0-9a-fA-F]{24}$/.test(userId)) {
            return res.status(400).json({ error: 'Invalid user id' });
        }

        try {
            const user = await User.findById(userId);
            if (!user || user.isBanned || user.isActive === false || user.deletedAt) {
                return res.status(404).json({ error: 'User not found' });
            }

            const isSelf = String(user._id) === String(req.userId);

            if (!isSelf && user.isPublic === false) {
                const [sharedPod, sharedPair] = await Promise.all([
                    Pod.exists({
                        isActive: true,
                        $and: [{ 'members.userId': req.userId }, { 'members.userId': user._id }]
                    }),
                    Pair.exists({
                        status: 'active',
                        $or: [
                            { userA: req.userId, userB: user._id },
                            { userA: user._id, userB: req.userId }
                        ]
                    })
                ]);
                if (!sharedPod && !sharedPair) {
                    return res.json({ profile: {
                        id: user._id,
                        fullName: user.fullName,
                        username: user.username,
                        avatarUrl: user.avatarUrl,
                        isPublic: false,
                        message: 'This profile is private'
                    }});
                }
            }

            const records = await Progress.find({ userId: user._id }).lean();
            const languages = records.map(r => ({
                language: r.language,
                currentLevel: r.currentLevel || 1,
                totalXP: r.totalXP || 0,
                streak: r.streak || 0,
                lessonsCompleted: (r.completedLessons || []).length
            })).sort((a, b) => b.totalXP - a.totalXP);

            const wanted = String(req.query.language || '').toLowerCase();
            const main = languages.find(l => l.language === wanted)
                || languages.find(l => l.language === user.language)
                || languages[0]
                || { language: user.language, currentLevel: 1, totalXP: 0, streak: 0, lessonsCompleted: 0 };

            return res.json({ profile: {
                id: user._id,
                fullName: user.fullName,
                username: user.username,
                avatarUrl: user.avatarUrl,
                bio: user.bio || '',
                language: main.language,
                streak: main.streak,
                totalXP: main.totalXP,
                currentLevel: main.currentLevel,
                lessonsCompleted: main.lessonsCompleted,
                languages,
                createdAt: user.createdAt
            }});
        } catch (error) {
            console.error('Community profile error:', error);
            return res.status(400).json({ error: 'Could not retrieve profile' });
        }
    }
);

// ============================================
// GET /api/users/:identifier
//
// Public profile. Authentication is optional.
// ============================================

router.get(
    '/:identifier',
    authenticateOptionalUser,
    async (req, res) => {
        const { identifier } = req.params;

        try {
            let user;

            if (/^[0-9a-fA-F]{24}$/.test(identifier)) {
                user = await User.findById(identifier);
            } else {
                const username = identifier.replace(/^@/, '').toLowerCase();
                user = await User.findOne({ username });
            }

            if (!user) {
                return res.status(404).json({ error: 'User not found' });
            }

            if (user.isBanned) {
                return res.status(404).json({ error: 'User not found' });
            }

            // ------------------------------------
            // Is the requester the owner?
            // ------------------------------------

            const isSelf =
                !!req.userId &&
                user._id.toString() === req.userId.toString();

            // ------------------------------------
            // Private profile
            // ------------------------------------

            if (!user.isPublic && !isSelf) {
                return res.json({
                    id: user._id,
                    username: user.username,
                    fullName: user.fullName,
                    avatarUrl: user.avatarUrl,
                    isPublic: false,
                    message: 'This profile is private'
                });
            }

            // ------------------------------------
            // Public profile
            // ------------------------------------

            const publicProfile = {
                id: user._id,
                username: user.username,
                fullName: user.fullName,
                bio: user.bio,
                location: user.isPublic ? user.location : '',
                avatarUrl: user.avatarUrl,
                coverPhotoUrl: user.coverPhotoUrl,
                isVerified: user.isVerified,
                isPublic: user.isPublic,
                segment: user.segment,
                language: user.language,
                learningLanguages: user.learningLanguages,
                teachingLanguages: user.teachingLanguages,
                cardsShared: user.cardsShared,
                createdAt: user.createdAt
            };

            // ------------------------------------
            // Private fields for owner
            // ------------------------------------

            if (isSelf) {
                publicProfile.subscriptionTier = user.subscriptionTier;
                publicProfile.podsJoined = user.podsJoined;
                publicProfile.activePairs = user.activePairs;
                publicProfile.email = user.email;
                publicProfile.phone = user.phone;
                publicProfile.emailVerified = user.emailVerified;
                publicProfile.accountType = user.accountType;
                publicProfile.learningFor = user.learningFor;
                publicProfile.goals = user.goals || [];
                publicProfile.placementLevel = user.placementLevel;
                publicProfile.timezoneOffsetMinutes = user.timezoneOffsetMinutes;
                publicProfile.referralCode = user.referralCode;
                publicProfile.referralCount = user.referralCount;
                publicProfile.pendingReferrals = user.pendingReferrals;
                publicProfile.referralsRewarded = user.referralsRewarded;
                publicProfile.streakFreezesAvailable = user.streakFreezesAvailable;
                publicProfile.subscriptionExpires = user.subscriptionExpires;
                publicProfile.savedWords = user.savedWords || [];
                publicProfile.notificationsEnabled = !!user.notificationsEnabled;
            }

            return res.json(publicProfile);
        } catch (error) {
            console.error('Get user error:', error);
            return res.status(400).json({ error: 'Could not retrieve user' });
        }
    }
);

export default router;