import express from 'express';
import jwt from 'jsonwebtoken';
import User from '../models/User.js';
import Progress from '../models/Progress.js';
import Referral from '../models/Referral.js';
import Notification from '../models/Notification.js';

const router = express.Router();

/**
 * GET /api/auth/config
 */
router.get('/config', (req, res) => {
    const {
        AUTH0_DOMAIN,
        AUTH0_CLIENT_ID,
        AUTH0_AUDIENCE,
        AUTH0_REDIRECT_URI
    } = process.env;

    if (!AUTH0_DOMAIN || !AUTH0_CLIENT_ID) {
        return res.status(500).json({
            error: 'Auth0 is not configured on the server'
        });
    }

    res.json({
        domain: AUTH0_DOMAIN,
        clientId: AUTH0_CLIENT_ID,
        audience: AUTH0_AUDIENCE || null,
        redirectUri: AUTH0_REDIRECT_URI || null,
        issuer: `https://${AUTH0_DOMAIN}/`
    });
});

/**
 * POST /api/auth/signup
 */
router.post('/signup', async (req, res) => {
    const {
        auth0Id,
        email,
        fullName,
        segment,
        language,
        phone,
        referralCode
    } = req.body;

    if (!auth0Id || !email) {
        return res.status(400).json({ error: 'auth0Id and email are required' });
    }

    try {
        let user = await User.findOne({ auth0Id });
        if (user) {
            return res.status(409).json({ error: 'User already exists', user });
        }

        user = await User.create({
            auth0Id,
            email,
            fullName: fullName || email.split('@')[0],
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

        let referralResult = null;
        if (referralCode) {
            try {
                const normalized = String(referralCode).trim().toUpperCase();
                const referrer = await User.findOne({ referralCode: normalized });

                if (referrer && referrer._id.toString() !== user._id.toString()) {
                    const existing = await Referral.findOne({ referredUserId: user._id });

                    if (!existing) {
                        await Referral.create({
                            referrerId: referrer._id,
                            referrerCode: referrer.referralCode,
                            referredUserId: user._id,
                            referredEmail: user.email,
                            referredAuth0Id: user.auth0Id,
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
                referralResult = { applied: false, reason: 'error', detail: refErr.message };
            }
        }

        res.status(201).json({
            success: true,
            user: {
                id: user._id,
                email: user.email,
                fullName: user.fullName,
                segment: user.segment,
                language: user.language,
                referralCode: user.referralCode
            },
            referral: referralResult
        });

    } catch (error) {
        console.error('Signup error:', error);
        res.status(400).json({ error: error.message || 'Signup failed' });
    }
});

/**
 * GET /api/auth/me
 */
router.get('/me', async (req, res) => {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return res.status(401).json({ error: 'Missing authorization header' });
    }

    const token = authHeader.split(' ')[1];

    try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET, {
            audience: process.env.AUTH0_AUDIENCE,
            issuer: `https://${process.env.AUTH0_DOMAIN}/`
        });

        const user = await User.findOne({ auth0Id: decoded.sub });
        if (!user) {
            return res.status(404).json({ error: 'User not found' });
        }

        user.lastActive = new Date();
        user.lastSeen = new Date();
        await user.save();

        res.json({
            id: user._id,
            auth0Id: user.auth0Id,
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
        });

    } catch (error) {
        console.error('Get user error:', error);
        res.status(401).json({ error: 'Unauthorized' });
    }
});

/**
 * POST /api/auth/test-token
 * DEV ONLY
 */
if (process.env.NODE_ENV !== 'production') {
    router.post('/test-token', async (req, res) => {
        const { auth0Id, email, fullName } = req.body;

        if (!auth0Id || !email) {
            return res.status(400).json({ error: 'auth0Id and email required' });
        }

        try {
            let user = await User.findOne({ auth0Id });
            if (!user) {
                user = await User.create({
                    auth0Id,
                    email,
                    fullName: fullName || email.split('@')[0]
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

            const token = jwt.sign(
                { sub: user.auth0Id, email: user.email, name: user.fullName },
                process.env.JWT_SECRET,
                {
                    audience: process.env.AUTH0_AUDIENCE,
                    issuer: `https://${process.env.AUTH0_DOMAIN}/`,
                    expiresIn: '1h'
                }
            );

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