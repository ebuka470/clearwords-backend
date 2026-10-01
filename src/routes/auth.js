import express from 'express';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import User from '../models/User.js';
import Progress from '../models/Progress.js';
import Referral from '../models/Referral.js';
import Notification from '../models/Notification.js';
import { rateLimiter } from '../middleware/rateLimit.js';
import { authenticateUser } from '../middleware/auth.js';

const router = express.Router();

// ============================================
// CONSTANTS
// ============================================
const TOKEN_LIFETIME = '30d';
const BCRYPT_ROUNDS = 12;

const VALID_ACCOUNT_TYPES = ['personal', 'family'];
const VALID_LEARNING_FOR = ['myself', 'child', 'family', 'both'];
const VALID_PLACEMENT_LEVELS = ['zero', 'few_words', 'some', 'little', 'comfortable'];
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

// How a self-reported placement level maps to a starting curriculum level.
// "zero"/"few_words" start at 1, comfortable learners start at 20.
const STARTING_LEVEL_BY_PLACEMENT = {
    zero: 1,
    few_words: 1,
    some: 5,
    little: 10,
    comfortable: 20
};

// ============================================
// HELPERS
// ============================================
function issueToken(user) {
    return jwt.sign(
        { sub: user._id.toString(), email: user.email },
        process.env.JWT_SECRET,
        { expiresIn: TOKEN_LIFETIME }
    );
}

function publicUser(user) {
    return {
        id: user._id,
        email: user.email,
        fullName: user.fullName,
        phone: user.phone,
        segment: user.segment,
        language: user.language,
        accountType: user.accountType,
        learningFor: user.learningFor,
        goals: user.goals || [],
        placementLevel: user.placementLevel,
        timezoneOffsetMinutes: user.timezoneOffsetMinutes,
        learningLanguages: user.learningLanguages || [],
        teachingLanguages: user.teachingLanguages || [],
        subscriptionTier: user.subscriptionTier,
        subscriptionExpires: user.subscriptionExpires,
        referralCode: user.referralCode,
        referralCount: user.referralCount || 0,
        pendingReferrals: user.pendingReferrals || 0,
        referralsRewarded: user.referralsRewarded || 0,
        referredBy: user.referredBy,
        streakFreezesAvailable: user.streakFreezesAvailable || 0,
        savedWords: user.savedWords || [],
        notificationsEnabled: !!user.notificationsEnabled,
        avatarUrl: user.avatarUrl,
        coverPhotoUrl: user.coverPhotoUrl,
        username: user.username,
        bio: user.bio,
        location: user.location,
        isPublic: user.isPublic,
        isVerified: user.isVerified,
        podsJoined: user.podsJoined || 0,
        activePairs: user.activePairs || 0,
        cardsShared: user.cardsShared || 0,
        createdAt: user.createdAt,
        lastActive: user.lastActive
    };
}

// ============================================
// POST /api/auth/signup
// ============================================
router.post('/signup', async (req, res) => {
    const {
        email,
        password,
        fullName,
        firstName,
        lastName,
        segment,
        language,
        primaryLanguage,
        phone,
        referralCode,
        accountType,
        learningFor,
        goals,
        level
    } = req.body;

    // --- Field alias resolution ---
    const resolvedFullName = (fullName && String(fullName).trim())
        || [firstName, lastName].filter(Boolean).join(' ').trim()
        || (email ? String(email).split('@')[0] : '');

    const resolvedLanguage = language || primaryLanguage || 'yoruba';

    if (!email || !password) {
        return res.status(400).json({ error: 'email and password are required' });
    }

    if (password.length < 6) {
        return res.status(400).json({ error: 'Password must be at least 6 characters' });
    }

    const normalizedEmail = String(email).toLowerCase().trim();

    // --- Onboarding field sanitization ---
    const resolvedAccountType = VALID_ACCOUNT_TYPES.includes(accountType)
        ? accountType
        : 'personal';

    const resolvedLearningFor = VALID_LEARNING_FOR.includes(learningFor)
        ? learningFor
        : 'myself';

    const resolvedGoals = Array.isArray(goals)
        ? goals.filter(g => VALID_GOALS.includes(g)).slice(0, 12)
        : [];

    const resolvedPlacement = VALID_PLACEMENT_LEVELS.includes(level)
        ? level
        : 'zero';

    const startingLevel = STARTING_LEVEL_BY_PLACEMENT[resolvedPlacement] || 1;

    try {
        const existing = await User.findOne({ email: normalizedEmail });
        if (existing) {
            return res.status(409).json({ error: 'Email already registered' });
        }

        const passwordHash = await bcrypt.hash(password, BCRYPT_ROUNDS);

        const user = await User.create({
            email: normalizedEmail,
            passwordHash,
            fullName: resolvedFullName,
            phone: phone || '',
            segment: segment || 'young',
            language: resolvedLanguage,
            accountType: resolvedAccountType,
            learningFor: resolvedLearningFor,
            goals: resolvedGoals,
            placementLevel: resolvedPlacement
        });

        await Progress.create({
            userId: user._id,
            language: resolvedLanguage,
            completedLevels: [],
            completedLessons: [],
            totalXP: 0,
            streak: 0,
            currentLevel: startingLevel
        });

        // ---- Referral redemption (non-fatal) ----
        let referralResult = null;
        if (referralCode) {
            try {
                const normalized = String(referralCode).trim().toUpperCase();
                const referrer = await User.findOne({ referralCode: normalized });

                if (referrer && referrer._id.toString() !== user._id.toString()) {
                    const existingReferral = await Referral.findOne({ referredUserId: user._id });

                    if (!existingReferral) {
                        await Referral.create({
                            referrerId: referrer._id,
                            referrerCode: referrer.referralCode,
                            referredUserId: user._id,
                            referredEmail: user.email,
                            status: 'pending'
                        });

                        user.referredBy = referrer._id;
                        await user.save();

                        await User.findByIdAndUpdate(referrer._id, {
                            $inc: { pendingReferrals: 1 }
                        });

                        await Notification.create({
                            userId: referrer._id,
                            type: 'referral_signup',
                            sourceId: user._id,
                            sourceUsername: user.username || 'User',
                            sourceAvatar: user.avatarUrl || '',
                            content: `${user.fullName || 'Someone'} signed up with your code! They'll count once they finish their first lesson.`
                        });

                        referralResult = {
                            applied: true,
                            referrer: referrer.username || referrer.fullName
                        };
                    } else {
                        referralResult = { applied: false, reason: 'already_referred' };
                    }
                } else if (referrer) {
                    referralResult = { applied: false, reason: 'self_referral' };
                } else {
                    referralResult = { applied: false, reason: 'invalid_code' };
                }
            } catch (refErr) {
                console.warn('Referral redemption failed (non-fatal):', refErr.message);
                referralResult = { applied: false, reason: 'error' };
            }
        }

        const token = issueToken(user);

        res.status(201).json({
            success: true,
            token,
            user: publicUser(user),
            referral: referralResult
        });

    } catch (error) {
        console.error('Signup error:', error);
        res.status(400).json({ error: error.message || 'Signup failed' });
    }
});

// ============================================
// POST /api/auth/login
// ============================================
router.post(
    '/login',
    rateLimiter(20, 15 * 60 * 1000),
    async (req, res) => {
        const { email, password } = req.body;

        if (!email || !password) {
            return res.status(400).json({ error: 'email and password are required' });
        }

        const normalizedEmail = String(email).toLowerCase().trim();

        try {
            const user = await User.findOne({ email: normalizedEmail }).select('+passwordHash');

            if (!user || !user.passwordHash) {
                return res.status(401).json({ error: 'Invalid credentials' });
            }

            if (user.isBanned) {
                return res.status(403).json({ error: 'Account is banned' });
            }

            const valid = await bcrypt.compare(password, user.passwordHash);
            if (!valid) {
                return res.status(401).json({ error: 'Invalid credentials' });
            }

            user.lastActive = new Date();
            user.lastSeen = new Date();
            await user.save();

            const token = issueToken(user);

            res.json({
                success: true,
                token,
                user: publicUser(user)
            });

        } catch (error) {
            console.error('Login error:', error);
            res.status(400).json({ error: error.message || 'Login failed' });
        }
    }
);

// ============================================
// POST /api/auth/change-password
// ============================================
router.post(
    '/change-password',
    authenticateUser,
    rateLimiter(10, 15 * 60 * 1000),
    async (req, res) => {
        const { currentPassword, newPassword } = req.body;

        if (!currentPassword || !newPassword) {
            return res.status(400).json({
                error: 'currentPassword and newPassword are required'
            });
        }

        if (newPassword.length < 6) {
            return res.status(400).json({
                error: 'New password must be at least 6 characters'
            });
        }

        if (currentPassword === newPassword) {
            return res.status(400).json({
                error: 'New password must be different from current password'
            });
        }

        try {
            const user = await User.findById(req.userId).select('+passwordHash');
            if (!user) {
                return res.status(404).json({ error: 'User not found' });
            }

            const valid = await bcrypt.compare(currentPassword, user.passwordHash);
            if (!valid) {
                return res.status(401).json({ error: 'Current password is incorrect' });
            }

            user.passwordHash = await bcrypt.hash(newPassword, BCRYPT_ROUNDS);
            user.passwordChangedAt = new Date();
            await user.save();

            const freshToken = issueToken(user);

            res.json({
                success: true,
                message: 'Password updated successfully',
                token: freshToken
            });
        } catch (error) {
            console.error('Change password error:', error);
            res.status(500).json({ error: 'Could not change password' });
        }
    }
);

// ============================================
// GET /api/auth/me
// ============================================
router.get('/me', async (req, res) => {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return res.status(401).json({ error: 'Missing authorization header' });
    }

    const token = authHeader.split(' ')[1];

    try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET, {
            algorithms: ['HS256']
        });

        const user = await User.findById(decoded.sub);
        if (!user) {
            return res.status(404).json({ error: 'User not found' });
        }

        if (
            user.passwordChangedAt &&
            decoded.iat &&
            decoded.iat * 1000 < user.passwordChangedAt.getTime()
        ) {
            return res.status(401).json({
                error: 'Session expired — please log in again'
            });
        }

        user.lastActive = new Date();
        user.lastSeen = new Date();
        await user.save();

        res.json(publicUser(user));

    } catch (error) {
        if (error.name === 'TokenExpiredError') {
            return res.status(401).json({ error: 'Token expired' });
        }
        console.error('Get user error:', error.message);
        res.status(401).json({ error: 'Unauthorized' });
    }
});

// ============================================
// POST /api/auth/test-token (DEV ONLY)
// ============================================
if (process.env.NODE_ENV !== 'production') {
    router.post('/test-token', async (req, res) => {
        const { email, password, fullName } = req.body;

        if (!email || !password) {
            return res.status(400).json({ error: 'email and password required' });
        }

        const normalizedEmail = String(email).toLowerCase().trim();

        try {
            let user = await User.findOne({ email: normalizedEmail });

            if (!user) {
                const passwordHash = await bcrypt.hash(password, BCRYPT_ROUNDS);
                user = await User.create({
                    email: normalizedEmail,
                    passwordHash,
                    fullName: fullName || normalizedEmail.split('@')[0]
                });

                await Progress.create({
                    userId: user._id,
                    language: user.language || 'yoruba',
                    completedLevels: [],
                    completedLessons: [],
                    totalXP: 0,
                    streak: 0,
                    currentLevel: 1
                });
            }

            const token = issueToken(user);

            res.json({
                token,
                user: {
                    id: user._id,
                    email: user.email,
                    fullName: user.fullName,
                    referralCode: user.referralCode
                }
            });
        } catch (error) {
            console.error('Test-token error:', error);
            res.status(400).json({ error: error.message });
        }
    });
}

export default router;