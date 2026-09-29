import express from 'express';
import User from '../models/User.js';

import {
    authenticateUser,
    authenticateOptionalUser
} from '../middleware/auth.js';

const router = express.Router();

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
            segment,
            isPublic,
            learningLanguages,
            teachingLanguages,
            timezoneOffsetMinutes
        } = req.body;

        try {
            const user =
                await User.findById(
                    req.userId
                );

            if (!user) {
                return res.status(404).json({
                    error:
                        'User not found'
                });
            }

            // ------------------------------------
            // Username
            // ------------------------------------

            if (
                username !== undefined &&
                username !== null
            ) {
                const normalizedUsername =
                    String(username)
                        .trim()
                        .toLowerCase()
                        .replace(/^@/, '');

                if (
                    normalizedUsername &&
                    normalizedUsername !==
                        user.username
                ) {
                    if (
                        normalizedUsername.length <
                            3 ||
                        normalizedUsername.length >
                            30
                    ) {
                        return res.status(400).json({
                            error:
                                'Username must be between 3 and 30 characters'
                        });
                    }

                    if (
                        !/^[a-z0-9._]+$/.test(
                            normalizedUsername
                        )
                    ) {
                        return res.status(400).json({
                            error:
                                'Username can only contain letters, numbers, dots and underscores'
                        });
                    }

                    const existing =
                        await User.findOne({
                            username:
                                normalizedUsername,
                            _id: {
                                $ne:
                                    user._id
                            }
                        });

                    if (existing) {
                        return res.status(409).json({
                            error:
                                'Username already taken'
                        });
                    }

                    user.username =
                        normalizedUsername;
                }
            }

            // ------------------------------------
            // Basic profile fields
            // ------------------------------------

            if (
                typeof fullName ===
                    'string' &&
                fullName.trim()
            ) {
                user.fullName =
                    fullName.trim();
            }

            if (
                typeof bio === 'string'
            ) {
                user.bio =
                    bio.trim();
            }

            if (
                typeof location === 'string'
            ) {
                user.location =
                    location.trim();
            }

            if (
                typeof language === 'string'
            ) {
                user.language =
                    language;
            }

            if (
                typeof segment === 'string'
            ) {
                user.segment =
                    segment;
            }

            if (
                typeof isPublic ===
                'boolean'
            ) {
                user.isPublic =
                    isPublic;
            }

            // ------------------------------------
            // Languages
            // ------------------------------------

            if (
                Array.isArray(
                    learningLanguages
                )
            ) {
                user.learningLanguages =
                    learningLanguages;
            }

            if (
                Array.isArray(
                    teachingLanguages
                )
            ) {
                user.teachingLanguages =
                    teachingLanguages;
            }

            if (
                typeof timezoneOffsetMinutes ===
                'number'
            ) {
                user.timezoneOffsetMinutes =
                    timezoneOffsetMinutes;
            }

            await user.save();

            return res.json({
                id: user._id,
                email: user.email,
                emailVerified:
                    user.emailVerified,

                fullName:
                    user.fullName,

                username:
                    user.username,

                bio:
                    user.bio,

                location:
                    user.location,

                avatarUrl:
                    user.avatarUrl,

                coverPhotoUrl:
                    user.coverPhotoUrl,

                language:
                    user.language,

                segment:
                    user.segment,

                isPublic:
                    user.isPublic,

                learningLanguages:
                    user.learningLanguages,

                teachingLanguages:
                    user.teachingLanguages,

                timezoneOffsetMinutes:
                    user.timezoneOffsetMinutes
            });
        } catch (error) {
            console.error(
                'Update profile error:',
                error
            );

            if (
                error.code === 11000
            ) {
                return res.status(409).json({
                    error:
                        'Username already taken'
                });
            }

            return res.status(400).json({
                error:
                    error.message ||
                    'Could not update profile'
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
            const user =
                await User.findById(
                    req.params.userId
                );

            if (!user || user.isBanned) {
                return res.status(404).json({
                    error:
                        'User not found'
                });
            }

            return res.json({
                podsJoined:
                    user.podsJoined || 0,

                activePairs:
                    user.activePairs || 0,

                cardsShared:
                    user.cardsShared || 0
            });
        } catch (error) {
            console.error(
                'Get stats error:',
                error
            );

            return res.status(400).json({
                error:
                    'Could not retrieve user stats'
            });
        }
    }
);

// ============================================
// GET /api/users/:identifier
//
// Public profile.
// Authentication is optional.
// ============================================

router.get(
    '/:identifier',
    authenticateOptionalUser,
    async (req, res) => {
        const {
            identifier
        } = req.params;

        try {
            let user;

            if (
                /^[0-9a-fA-F]{24}$/.test(
                    identifier
                )
            ) {
                user =
                    await User.findById(
                        identifier
                    );
            } else {
                const username =
                    identifier
                        .replace(/^@/, '')
                        .toLowerCase();

                user =
                    await User.findOne({
                        username
                    });
            }

            if (!user) {
                return res.status(404).json({
                    error:
                        'User not found'
                });
            }

            if (user.isBanned) {
                return res.status(404).json({
                    error:
                        'User not found'
                });
            }

            // ------------------------------------
            // Determine whether requester owns
            // this profile.
            // ------------------------------------

            const isSelf =
                !!req.userId &&
                user._id.toString() ===
                    req.userId.toString();

            // ------------------------------------
            // Private profile
            // ------------------------------------

            if (
                !user.isPublic &&
                !isSelf
            ) {
                return res.json({
                    id: user._id,
                    username:
                        user.username,
                    fullName:
                        user.fullName,
                    avatarUrl:
                        user.avatarUrl,
                    isPublic: false,
                    message:
                        'This profile is private'
                });
            }

            // ------------------------------------
            // Public profile
            // ------------------------------------

            const publicProfile = {
                id: user._id,

                username:
                    user.username,

                fullName:
                    user.fullName,

                bio:
                    user.bio,

                location:
                    user.isPublic
                        ? user.location
                        : '',

                avatarUrl:
                    user.avatarUrl,

                coverPhotoUrl:
                    user.coverPhotoUrl,

                isVerified:
                    user.isVerified,

                isPublic:
                    user.isPublic,

                segment:
                    user.segment,

                language:
                    user.language,

                learningLanguages:
                    user.learningLanguages,

                teachingLanguages:
                    user.teachingLanguages,

                subscriptionTier:
                    user.subscriptionTier,

                podsJoined:
                    user.podsJoined,

                activePairs:
                    user.activePairs,

                cardsShared:
                    user.cardsShared,

                createdAt:
                    user.createdAt
            };

            // ------------------------------------
            // Private fields for owner
            // ------------------------------------

            if (isSelf) {
                publicProfile.email =
                    user.email;

                publicProfile.phone =
                    user.phone;

                publicProfile.emailVerified =
                    user.emailVerified;

                publicProfile.timezoneOffsetMinutes =
                    user.timezoneOffsetMinutes;

                publicProfile.referralCode =
                    user.referralCode;

                publicProfile.referralCount =
                    user.referralCount;

                publicProfile.pendingReferrals =
                    user.pendingReferrals;

                publicProfile.referralsRewarded =
                    user.referralsRewarded;

                publicProfile.streakFreezesAvailable =
                    user.streakFreezesAvailable;

                publicProfile.subscriptionExpires =
                    user.subscriptionExpires;
            }

            return res.json(
                publicProfile
            );
        } catch (error) {
            console.error(
                'Get user error:',
                error
            );

            return res.status(400).json({
                error:
                    'Could not retrieve user'
            });
        }
    }
);

export default router;