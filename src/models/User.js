const mongoose = require('mongoose');

const UserSchema = new mongoose.Schema({
    auth0Id: { type: String, required: true, unique: true, index: true },
    email: { type: String, required: true, unique: true, index: true },
    fullName: { type: String, required: true },
    phone: { type: String, default: '' },
    username: { type: String, unique: true, sparse: true },
    bio: { type: String, maxlength: 500, default: '' },
    location: { type: String, default: '' },
    avatarUrl: { type: String, default: '' },
    coverPhotoUrl: { type: String, default: '' },
    isPublic: { type: Boolean, default: true },
    isVerified: { type: Boolean, default: false },
    isActive: { type: Boolean, default: true },
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
    subscriptionTier: {
        type: String,
        enum: ['free', 'premium', 'immersive'],
        default: 'free'
    },
    subscriptionExpires: { type: Date, default: null },
    paystackCustomerCode: { type: String, default: null },
    referralCode: { type: String, unique: true, sparse: true },
    referredBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    referralCount: { type: Number, default: 0 },
    postsCount: { type: Number, default: 0 },
    commentsCount: { type: Number, default: 0 },
    likesReceived: { type: Number, default: 0 },
    followersCount: { type: Number, default: 0 },
    followingCount: { type: Number, default: 0 },
    createdAt: { type: Date, default: Date.now },
    updatedAt: { type: Date, default: Date.now },
    lastActive: { type: Date, default: Date.now },
    deletedAt: { type: Date, default: null }
});

UserSchema.pre('save', function(next) {
    if (!this.referralCode) {
        this.referralCode = 'CW' + Math.random().toString(36).substring(2, 8).toUpperCase();
    }
    if (!this.username) {
        this.username = this.email.split('@')[0];
    }
    this.updatedAt = new Date();
    next();
});

module.exports = mongoose.model('User', UserSchema);