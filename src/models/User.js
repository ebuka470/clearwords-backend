import mongoose from 'mongoose';

const UserSchema = new mongoose.Schema({
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
    passwordChangedAt: {
        type: Date,
        default: null
    },
    fullName: { type: String, required: true },
    phone: { type: String, default: '' },
    username: { type: String, sparse: true },
    bio: { type: String, maxlength: 500, default: '' },
    location: { type: String, default: '' },
    avatarUrl: { type: String, default: '' },
    coverPhotoUrl: { type: String, default: '' },
    isPublic: { type: Boolean, default: true },
    isVerified: { type: Boolean, default: false },
    isActive: { type: Boolean, default: true },
    isBanned: { type: Boolean, default: false },
    reportCount: { type: Number, default: 0 },
    lastSeen: { type: Date, default: Date.now },
    segment: {
        type: String,
        enum: ['parent', 'young', 'pro', 'marriage', 'nigeria'],
        default: 'young'
    },
    language: {
        type: String,
        enum: ['yoruba', 'hausa', 'igbo', 'urhobo', 'itsekiri', 'pidgin'],
        default: 'yoruba'
    },

    // ============================================
    // ONBOARDING PROFILE (persisted from signup)
    // ============================================
    accountType: {
        type: String,
        enum: ['personal', 'family'],
        default: 'personal'
    },
    learningFor: {
        type: String,
        enum: ['myself', 'child', 'family', 'both'],
        default: 'myself'
    },
    goals: [{
        type: String,
        enum: [
            'talk_family',
            'understand',
            'speak',
            'pronunciation',
            'culture',
            'read_write',
            'teach_child',
            'visit_nigeria'
        ]
    }],
    placementLevel: {
        type: String,
        enum: ['zero', 'few_words', 'some', 'little', 'comfortable'],
        default: 'zero'
    },

    timezoneOffsetMinutes: { type: Number, default: null },
    learningLanguages: [{ type: String }],
    teachingLanguages: [{ type: String }],
    subscriptionTier: {
        type: String,
        enum: ['free', 'premium', 'immersive'],
        default: 'free'
    },
    subscriptionExpires: { type: Date, default: null },
    paystackCustomerCode: { type: String, default: null },

    // Referrals
    referralCode: { type: String, sparse: true },
    referredBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    referralCount: { type: Number, default: 0 },
    referralsRewarded: { type: Number, default: 0 },
    pendingReferrals: { type: Number, default: 0 },

    // Streak
    streakFreezesAvailable: { type: Number, default: 0, min: 0 },

    // Saved words (used by learn tab)
    savedWords: [{
        word: { type: String, required: true },
        translation: { type: String, default: '' },
        pronunciation: { type: String, default: '' },
        example: { type: String, default: '' },
        language: { type: String, default: 'yoruba' },
        savedAt: { type: Date, default: Date.now }
    }],

    // Notifications preference
    notificationsEnabled: { type: Boolean, default: false },

    // Community stats
    podsJoined: { type: Number, default: 0 },
    activePairs: { type: Number, default: 0 },
    cardsShared: { type: Number, default: 0 },

    // Admin
    role: {
        type: String,
        enum: ['user', 'moderator', 'admin'],
        default: 'user'
    },

    createdAt: { type: Date, default: Date.now },
    updatedAt: { type: Date, default: Date.now },
    lastActive: { type: Date, default: Date.now },
    deletedAt: { type: Date, default: null }
});

UserSchema.index({ email: 1 }, { unique: true });
UserSchema.index({ username: 1 }, { unique: true, sparse: true });
UserSchema.index({ referralCode: 1 }, { unique: true, sparse: true });

UserSchema.pre('save', function (next) {
    if (!this.referralCode) {
        this.referralCode = 'CW' + Math.random().toString(36).substring(2, 8).toUpperCase();
    }
    if (!this.username) {
        this.username = this.email.split('@')[0];
    }
    this.updatedAt = new Date();
    next();
});

const User = mongoose.model('User', UserSchema);

export default User;