import mongoose from 'mongoose';

const UsageCounterSchema = new mongoose.Schema({
    userId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true,
        index: true
    },
    key: {
        type: String,
        required: true,
        // Examples: 'ai_custom_lesson', 'ai_chat_message', 'tts_generate'
    },
    dateKey: {
        type: String,
        required: true,
        // Format: 'YYYY-MM-DD' in the user's timezone (or UTC)
    },
    count: {
        type: Number,
        default: 0,
        min: 0
    },
    createdAt: { type: Date, default: Date.now },
    updatedAt: { type: Date, default: Date.now }
});

// Enforce one counter per user + key + day
UsageCounterSchema.index(
    { userId: 1, key: 1, dateKey: 1 },
    { unique: true }
);

// TTL: auto-delete counters older than 90 days
UsageCounterSchema.index(
    { createdAt: 1 },
    { expireAfterSeconds: 90 * 24 * 60 * 60 }
);

UsageCounterSchema.pre('save', function (next) {
    this.updatedAt = new Date();
    next();
});

/**
 * Atomically increment and return the new count.
 * Uses findOneAndUpdate with upsert to avoid races.
 */
UsageCounterSchema.statics.increment = async function (userId, key, dateKey) {
    const doc = await this.findOneAndUpdate(
        { userId, key, dateKey },
        { $inc: { count: 1 }, $set: { updatedAt: new Date() } },
        { new: true, upsert: true, setDefaultsOnInsert: true }
    );
    return doc;
};

/**
 * Read current count (0 if no document yet).
 */
UsageCounterSchema.statics.getCount = async function (userId, key, dateKey) {
    const doc = await this.findOne({ userId, key, dateKey });
    return doc ? doc.count : 0;
};

const UsageCounter = mongoose.model('UsageCounter', UsageCounterSchema);

export default UsageCounter;