import mongoose from 'mongoose';

const UserSchema = new mongoose.Schema(
    {
        // ============================================
        // AUTHENTICATION
        // ============================================

        email: {
            type: String,
            required: true,
            lowercase: true,
            trim: true
        },

        passwordHash: {
            type: String,
            required: true,
            select: false
        },

        emailVerified: {
            type: Boolean,
            default: false
        },

        // ============================================
        // PROFILE
        // ============================================

        fullName: {
            type: String,
            required: true,
            trim: true
        },

        phone: {
            type: String,
            default: '',
            trim: true
        },

        username: {
            type: String,
            sparse: true,
            trim: true,
            lowercase: true
        },

        bio: {
            type: String,
            maxlength: 500,
            default: ''
        },

        location: {
            type: String,
            default: ''
        },

        avatarUrl: {
            type: String,
            default: ''
        },

        coverPhotoUrl: {
            type: String,
            default: ''
        },

        isPublic: {
            type: Boolean,
            default: true
        },

        isVerified: {
            type: Boolean,
            default: false
        },

        isActive: {
            type: Boolean,
            default: true
        },

        isBanned: {
            type: Boolean,
            default: false
        },

        reportCount: {
            type: Number,
            default: 0
        },

        // ============================================
        // LEARNING
        // ============================================

        segment: {
            type: String,
            enum: [
                'parent',
                'young',
                'pro',
                'marriage',
                'nigeria'
            ],
            default: 'young'
        },

        language: {
            type: String,
            enum: [
                'yoruba',
                'hausa',
                'igbo',
                'urhobo',
                'itsekiri',
                'pidgin'
            ],
            default: 'yoruba'
        },

        timezoneOffsetMinutes: {
            type: Number,
            default: null
        },

        learningLanguages: [
            {
                type: String
            }
        ],

        teachingLanguages: [
            {
                type: String
            }
        ],

        // ============================================
        // SUBSCRIPTION
        // ============================================

        subscriptionTier: {
            type: String,
            enum: [
                'free',
                'premium',
                'immersive'
            ],
            default: 'free'
        },

        subscriptionExpires: {
            type: Date,
            default: null
        },

        paystackCustomerCode: {
            type: String,
            default: null
        },

        // ============================================
        // REFERRALS
        // ============================================

        referralCode: {
            type: String,
            sparse: true
        },

        referredBy: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'User',
            default: null
        },

        referralCount: {
            type: Number,
            default: 0
        },

        referralsRewarded: {
            type: Number,
            default: 0
        },

        pendingReferrals: {
            type: Number,
            default: 0
        },

        // ============================================
        // STREAK
        // ============================================

        streakFreezesAvailable: {
            type: Number,
            default: 0,
            min: 0
        },

        // ============================================
        // COMMUNITY STATS
        // ============================================

        podsJoined: {
            type: Number,
            default: 0
        },

        activePairs: {
            type: Number,
            default: 0
        },

        cardsShared: {
            type: Number,
            default: 0
        },

        // ============================================
        // ADMIN
        // ============================================

        role: {
            type: String,
            enum: [
                'user',
                'moderator',
                'admin'
            ],
            default: 'user'
        },

        // ============================================
        // ACTIVITY / DATES
        // ============================================

        lastSeen: {
            type: Date,
            default: Date.now
        },

        createdAt: {
            type: Date,
            default: Date.now
        },

        updatedAt: {
            type: Date,
            default: Date.now
        },

        lastActive: {
            type: Date,
            default: Date.now
        },

        deletedAt: {
            type: Date,
            default: null
        }
    }
);

// ============================================
// INDEXES
// ============================================

UserSchema.index(
    { email: 1 },
    { unique: true }
);

UserSchema.index(
    { username: 1 },
    {
        unique: true,
        sparse: true
    }
);

UserSchema.index(
    { referralCode: 1 },
    {
        unique: true,
        sparse: true
    }
);

UserSchema.index({
    subscriptionTier: 1
});

UserSchema.index({
    lastActive: -1
});

// ============================================
// PRE-SAVE
// ============================================

UserSchema.pre('save', function (next) {
    if (!this.referralCode) {
        this.referralCode =
            'CW' +
            Math.random()
                .toString(36)
                .substring(2, 8)
                .toUpperCase();
    }

    if (!this.username && this.email) {
        this.username = this.email
            .split('@')[0]
            .toLowerCase();
    }

    this.updatedAt = new Date();

    next();
});

const User = mongoose.model(
    'User',
    UserSchema
);

export default User;