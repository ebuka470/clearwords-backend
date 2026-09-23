import mongoose from 'mongoose';

const UserSchema = new mongoose.Schema({
    auth0Id: { type: String, required: true },
    email: { type: String, required: true },
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
    learningLanguages: [{ type: String }],
    teachingLanguages: [{ type: String }],
    subscriptionTier: {
        type: String,
        enum: ['free', 'premium', 'immersive'],
        default: 'free'
    },
    subscriptionExpires: { type: Date, default: null },
    paystackCustomerCode: { type: String, default: null },
    referralCode: { type: String, sparse: true },
    referredBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    referralCount: { type: Number, default: 0 },
    podsJoined: { type: Number, default: 0 },
    activePairs: { type: Number, default: 0 },
    cardsShared: { type: Number, default: 0 },
    createdAt: { type: Date, default: Date.now },
    updatedAt: { type: Date, default: Date.now },
    lastActive: { type: Date, default: Date.now },
    deletedAt: { type: Date, default: null }
});

// Partial unique indexes — ignore null/missing values
UserSchema.index(
    { auth0Id: 1 },
    { unique: true, partialFilterExpression: { auth0Id: { $type: 'string' } } }
);
UserSchema.index(
    { email: 1 },
    { unique: true, partialFilterExpression: { email: { $type: 'string' } } }
);
UserSchema.index(
    { username: 1 },
    { unique: true, sparse: true }
);
UserSchema.index(
    { referralCode: 1 },
    { unique: true, sparse: true }
);

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

const User = mongoose.model('User', UserSchema);

export default User;