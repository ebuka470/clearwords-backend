import mongoose from 'mongoose';

const LessonCompletionSchema = new mongoose.Schema({
    userId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true,
        index: true
    },
    language: { type: String, required: true, index: true },

    levelId: { type: Number, required: true },
    lessonId: { type: String, required: true },

    // Performance
    xpEarned: { type: Number, default: 0, min: 0 },
    perfect: { type: Boolean, default: false },
    timeSpentSeconds: { type: Number, default: 0, min: 0 },
    mistakesCount: { type: Number, default: 0 },

    // Context
    completedAt: { type: Date, default: Date.now, index: true },
    source: {
        type: String,
        enum: ['curriculum', 'custom_ai', 'daily_challenge', 'pod_challenge'],
        default: 'curriculum'
    }
});

// One completion per user + language + level + lesson
LessonCompletionSchema.index(
    { userId: 1, language: 1, levelId: 1, lessonId: 1 },
    { unique: true }
);

LessonCompletionSchema.index({ userId: 1, completedAt: -1 });

const LessonCompletion = mongoose.model('LessonCompletion', LessonCompletionSchema);

export default LessonCompletion;