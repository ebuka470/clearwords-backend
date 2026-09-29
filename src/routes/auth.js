import express from 'express';
import User from '../models/User.js';
import Progress from '../models/Progress.js';
import Referral from '../models/Referral.js';
import Notification from '../models/Notification.js';

import {
    authenticateUser,
    signToken
} from '../middleware/auth.js';

import {
    hashPassword,
    verifyPassword,
    validatePassword
} from '../utils/password.js';

const router = express.Router();

// ============================================
// HELPERS
// ============================================

function normalizeEmail(email) {
    return String(email || '')
        .trim()
        .toLowerCase();
}

function isValidEmail(email) {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function cleanUsername(username) {
    if (!username) return '';

    return String(username)
        .trim()
        .toLowerCase()
        .replace(/^@/, '');
}

function publicUser(user) {
    return {
        id: user._id,
        email: user.email,
        emailVerified: user.emailVerified,

        fullName: user.fullName,
        phone: user.phone,

        username: user.username,
        bio: user.bio,
        location: user.location,

        avatarUrl: user.avatarUrl,
        coverPhotoUrl: user.coverPhotoUrl,

        isPublic: user.isPublic,
        isVerified: user.isVerified,

        segment: user.segment,
        language: user.language,

        timezoneOffsetMinutes:
            user.timezoneOffsetMinutes,

        learningLanguages:
            user.learningLanguages || [],

        teachingLanguages:
            user.teachingLanguages || [],

        subscriptionTier:
            user.subscriptionTier,

        subscriptionExpires:
            user.subscriptionExpires,

        referralCode:
            user.referralCode,

        referralCount:
            user.referralCount || 0,

        pendingReferrals:
            user.pendingReferrals || 0,

        referralsRewarded:
            user.referralsRewarded || 0,

        referredBy:
            user.referredBy,

        streakFreezesAvailable:
            user.streakFreezesAvailable || 0,

        podsJoined:
            user.podsJoined || 0,

        activePairs:
            user.activePairs || 0,

        cardsShared:
            user.cardsShared || 0,

        createdAt:
            user.createdAt,

        lastActive:
            user.lastActive
    };
}

// ============================================
// GET /api/auth/config
//
// ClearWords-owned authentication config.
// No Auth0 values are returned.
// ============================================

router.get('/config', (req, res) => {
    res.json({
        provider: 'clearwords',
        method: 'email-password',
        tokenType: 'Bearer',
        expiresIn:
            process.env.JWT_EXPIRES_IN || '7d',
        passwordRecovery:
            !!process.env.RESEND_API_KEY
    });
});

// ============================================
// POST /api/auth/signup
// ============================================

router.post('/signup', async (req, res) => {
    const {
        email,
        password,
        confirmPassword,
        fullName,
        username,
        segment,
        language,
        phone,
        referralCode
    } = req.body;

    const normalizedEmail =
        normalizeEmail(email);

    // --------------------------------------------
    // Validate email
    // --------------------------------------------

    if (!normalizedEmail) {
        return res.status(400).json({
            error: 'Email is required'
        });
    }

    if (!isValidEmail(normalizedEmail)) {
        return res.status(400).json({
            error: 'Please enter a valid email address'
        });
    }

    // --------------------------------------------
    // Validate password
    // --------------------------------------------

    const passwordError =
        validatePassword(password);

    if (passwordError) {
        return res.status(400).json({
            error: passwordError
        });
    }

    if (password !== confirmPassword) {
        return res.status(400).json({
            error: 'Passwords do not match'
        });
    }

    // --------------------------------------------
    // Validate name
    // --------------------------------------------

    const normalizedFullName =
        String(fullName || '')
            .trim();

    if (!normalizedFullName) {
        return res.status(400).json({
            error: 'Full name is required'
        });
    }

    if (normalizedFullName.length > 100) {
        return res.status(400).json({
            error: 'Full name is too long'
        });
    }

    try {
        // ----------------------------------------
        // Existing account
        // ----------------------------------------

        const existingUser =
            await User.findOne({
                email: normalizedEmail
            });

        if (existingUser) {
            return res.status(409).json({
                error: 'An account with this email already exists'
            });
        }

        // ----------------------------------------
        // Username
        // ----------------------------------------

        const normalizedUsername =
            cleanUsername(username);

        if (normalizedUsername) {
            if (
                normalizedUsername.length < 3 ||
                normalizedUsername.length > 30
            ) {
                return res.status(400).json({
                    error: 'Username must be between 3 and 30 characters'
                });
            }

            if (
                !/^[a-z0-9._]+$/.test(
                    normalizedUsername
                )
            ) {
                return res.status(400).json({
                    error: 'Username can only contain letters, numbers, dots and underscores'
                });
            }

            const usernameExists =
                await User.findOne({
                    username: normalizedUsername
                });

            if (usernameExists) {
                return res.status(409).json({
                    error: 'Username already taken'
                });
            }
        }

        // ----------------------------------------
        // Password hash
        // ----------------------------------------

        const passwordHash =
            await hashPassword(password);

        // ----------------------------------------
        // Create user
        // ----------------------------------------

        const user = await User.create({
            email: normalizedEmail,
            passwordHash,

            fullName:
                normalizedFullName,

            username:
                normalizedUsername || undefined,

            phone:
                typeof phone === 'string'
                    ? phone.trim()
                    : '',

            segment:
                segment || 'young',

            language:
                language || 'yoruba',

            emailVerified: false
        });

        // ----------------------------------------
        // Create progress
        // ----------------------------------------

        await Progress.create({
            userId: user._id,
            language:
                language || user.language || 'yoruba',

            completedLevels: [],
            completedLessons: [],

            totalXP: 0,
            streak: 0,
            currentLevel: 1
        });

        // ----------------------------------------
        // Referral
        // ----------------------------------------

        let referralResult = null;

        if (referralCode) {
            try {
                const normalizedCode =
                    String(referralCode)
                        .trim()
                        .toUpperCase();

                const referrer =
                    await User.findOne({
                        referralCode:
                            normalizedCode
                    });

                if (
                    referrer &&
                    referrer._id.toString() !==
                        user._id.toString()
                ) {
                    const existingReferral =
                        await Referral.findOne({
                            referredUserId:
                                user._id
                        });

                    if (!existingReferral) {
                        await Referral.create({
                            referrerId:
                                referrer._id,

                            referrerCode:
                                referrer.referralCode,

                            referredUserId:
                                user._id,

                            referredEmail:
                                user.email,

                            status:
                                'pending'
                        });

                        user.referredBy =
                            referrer._id;

                        await user.save();

                        await User.findByIdAndUpdate(
                            referrer._id,
                            {
                                $inc: {
                                    pendingReferrals: 1
                                }
                            }
                        );

                        await Notification.create({
                            userId:
                                referrer._id,

                            type:
                                'referral_signup',

                            sourceId:
                                user._id,

                            sourceUsername:
                                user.username ||
                                'User',

                            sourceAvatar:
                                user.avatarUrl ||
                                '',

                            content:
                                `${user.fullName || 'Someone'} signed up with your code! They'll count once they finish their first lesson.`
                        });

                        referralResult = {
                            applied: true,
                            referrer:
                                referrer.username ||
                                referrer.fullName
                        };
                    } else {
                        referralResult = {
                            applied: false,
                            reason:
                                'already_referred'
                        };
                    }
                } else if (referrer) {
                    referralResult = {
                        applied: false,
                        reason:
                            'self_referral'
                    };
                } else {
                    referralResult = {
                        applied: false,
                        reason:
                            'invalid_code'
                    };
                }
            } catch (referralError) {
                console.warn(
                    'Referral signup failed:',
                    referralError.message
                );

                referralResult = {
                    applied: false,
                    reason: 'error'
                };
            }
        }

        // ----------------------------------------
        // JWT
        // ----------------------------------------

        const token =
            signToken(user);

        return res.status(201).json({
            success: true,
            token,
            user: publicUser(user),
            referral: referralResult
        });
    } catch (error) {
        console.error(
            'Signup error:',
            error
        );

        if (
            error.code === 11000
        ) {
            return res.status(409).json({
                error: 'An account with those details already exists'
            });
        }

        return res.status(400).json({
            error:
                error.message ||
                'Signup failed'
        });
    }
});

// ============================================
// POST /api/auth/login
// ============================================

router.post('/login', async (req, res) => {
    const {
        email,
        password
    } = req.body;

    const normalizedEmail =
        normalizeEmail(email);

    if (!normalizedEmail || !password) {
        return res.status(400).json({
            error:
                'Email and password are required'
        });
    }

    try {
        const user =
            await User.findOne({
                email: normalizedEmail
            }).select('+passwordHash');

        if (!user) {
            return res.status(401).json({
                error:
                    'Invalid email or password'
            });
        }

        if (user.deletedAt) {
            return res.status(401).json({
                error:
                    'This account has been deleted'
            });
        }

        if (user.isBanned) {
            return res.status(403).json({
                error:
                    'Account is banned'
            });
        }

        if (user.isActive === false) {
            return res.status(403).json({
                error:
                    'Account is inactive'
            });
        }

        if (!user.passwordHash) {
            return res.status(401).json({
                error:
                    'This account needs to be registered again'
            });
        }

        const validPassword =
            await verifyPassword(
                password,
                user.passwordHash
            );

        if (!validPassword) {
            return res.status(401).json({
                error:
                    'Invalid email or password'
            });
        }

        user.lastActive =
            new Date();

        user.lastSeen =
            new Date();

        await user.save();

        const token =
            signToken(user);

        return res.json({
            success: true,
            token,
            user: publicUser(user)
        });
    } catch (error) {
        console.error(
            'Login error:',
            error
        );

        return res.status(500).json({
            error:
                'Login failed'
        });
    }
});

// ============================================
// POST /api/auth/logout
//
// JWTs are stateless. The client removes its token.
// ============================================

router.post(
    '/logout',
    authenticateUser,
    async (req, res) => {
        return res.json({
            success: true,
            message:
                'Logged out successfully'
        });
    }
);

// ============================================
// GET /api/auth/me
// ============================================

router.get(
    '/me',
    authenticateUser,
    async (req, res) => {
        return res.json(
            publicUser(req.user)
        );
    }
);

export default router;