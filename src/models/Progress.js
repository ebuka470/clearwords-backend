const mongoose = require('mongoose');

const ProgressSchema = new mongoose.Schema({
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    language: { type: String, required: true },
    completedLevels: { type: [Number], default: [] },
    currentLevel: { type: Number, default: 1 },
    totalXP: { type: Number, default: 0 },
    streak: { type: Number, default: 0 },
    longestStreak: { type: Number, default: 0 },
    dailyCompleted: { type: Number, default: 0 },
    perfectScores: { type: Number, default: 0 },
    favorites: { type: [Number], default: [] },
    progress: { type: mongoose.Schema.Types.Mixed, default: {} },
    dailyChallenges: { type: [mongoose.Schema.Types.Mixed], default: [] },
    lastChallengeGen: { type: Date, default: null },
    lastActive: { type: Date, default: Date.now },
    createdAt: { type: Date, default: Date.now },
    updatedAt: { type: Date, default: Date.now }
});

ProgressSchema.index({ userId: 1, language: 1 }, { unique: true });

module.exports = mongoose.model('Progress', ProgressSchema);