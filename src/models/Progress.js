import mongoose from 'mongoose';

const ProgressSchema = new mongoose.Schema({
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    language: { type: String, required: true },

    completedLevels: { type: [Number], default: [] },
    completedLessons: { type: [String], default: [] },

    currentLevel: { type: Number, default: 1 },
    totalXP: { type: Number, default: 0 },
    weeklyXP: { type: Number, default: 0 },
    weeklyXPResetAt: { type: Date, default: Date.now },

    // Streak
    streak: { type: Number, default: 0 },
    longestStreak: { type: Number, default: 0 },
    lastCompletedDate: { type: String, default: null },  // YYYY-MM-DD
    lastCompletedLessonAt: { type: Date, default: null },

    // Daily tracking
    dailyCompleted: { type: Number, default: 0 },
    dailyDateKey: { type: String, default: null },
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

const Progress = mongoose.model('Progress', ProgressSchema);

export default Progress;