import express from 'express';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import User from '../models/User.js';
import Progress from '../models/Progress.js';
import Referral from '../models/Referral.js';
import Notification from '../models/Notification.js';
import { rateLimiter } from '../middleware/rateLimit.js';

const router = express.Router();

// ============================================
// CONSTANTS
// ============================================
const TOKEN_LIFETIME = '30d';
const BCRYPT_ROUNDS = 12;

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

/**
 * Strip sensitive fields from a User document before sending to client.
 * (Defense in depth — passwordHash already has select:false on the schema.)
 */
function publicUser(user) {
    return {
        id: user._id,
        email: user.email,
        fullName: user.fullName,
        phone: user.phone,
        segment: user.segment,
        language: user.language,
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
// Body: { email, password, fullName, segment, language, phone, referralCode }
// Returns: { success, token, user, referral }
// ============================================
router.post('/signup', async (req, res) => {
    const {
        email,
        password,
        fullName,
        segment,
        language,
        phone,
        referralCode
    } = req.body;

    if (!email || !password) {
        return res.status(400).json({ error: 'email and password are required' });
    }

    if (password.length < 6) {
        return res.status(400).json({ error: 'Password must be at least 6 characters' });
    }

    const normalizedEmail = String(email).toLowerCase().trim();

    try {
        const existing = await User.findOne({ email: normalizedEmail });
        if (existing) {
            return res.status(409).json({ error: 'Email already registered' });
        }

        const passwordHash = await bcrypt.hash(password, BCRYPT_ROUNDS);

        const user = await User.create({
            email: normalizedEmail,
            passwordHash,
            fullName: fullName || normalizedEmail.split('@')[0],
            phone: phone || '',
            segment: segment || 'young',
            language: language || 'yoruba'
        });

        await Progress.create({
            userId: user._id,
            language: language || 'yoruba',
            completedLevels: [],
            completedLessons: [],
            totalXP: 0,
            streak: 0,
            currentLevel: 1
        });

        // ============================================
        // REFERRAL REDEMPTION (non-fatal)
        // ============================================
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
// Body: { email, password }
// Returns: { success, token, user }
// Rate-limited to slow down credential stuffing.
// ============================================
router.post(
    '/login',
    rateLimiter(20, 15 * 60 * 1000),   // 20 attempts per 15 minutes per IP+path
    async (req, res) => {
        const { email, password } = req.body;

        if (!email || !password) {
            return res.status(400).json({ error: 'email and password are required' });
        }

        const normalizedEmail = String(email).toLowerCase().trim();

        try {
            // .select('+passwordHash') is required because the schema hides it by default.
            const user = await User.findOne({ email: normalizedEmail }).select('+passwordHash');

            // Same generic error for "no user" and "wrong password" so an
            // attacker can't enumerate which emails exist.
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
// GET /api/auth/me
// Reads the Bearer token, returns the current user.
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
// POST /api/auth/test-token
// DEV ONLY — creates a user with a known password and returns a JWT.
// Never enabled when NODE_ENV=production.
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