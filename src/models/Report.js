import mongoose from 'mongoose';

const ReportSchema = new mongoose.Schema({
    reporterId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },

    // What's being reported
    targetType: { type: String, enum: ['user', 'pod_message', 'pair_message', 'pair'], required: true },
    targetId: { type: mongoose.Schema.Types.ObjectId, required: true, index: true },
    targetUserId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },

    reason: {
        type: String,
        enum: ['harassment', 'spam', 'hate_speech', 'sexual_content', 'threat', 'other'],
        required: true
    },
    description: { type: String, maxlength: 500, default: '' },
    evidence: { type: String, default: '' },

    status: {
        type: String,
        enum: ['pending', 'reviewing', 'resolved', 'dismissed'],
        default: 'pending'
    },
    resolution: { type: String, enum: ['warned', 'banned', 'dismissed', null], default: null },
    resolvedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    resolvedAt: { type: Date, default: null },

    createdAt: { type: Date, default: Date.now }
});

ReportSchema.index({ targetUserId: 1, createdAt: -1 });
ReportSchema.index({ status: 1, createdAt: -1 });

const Report = mongoose.model('Report', ReportSchema);

export default Report;