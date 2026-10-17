import mongoose from 'mongoose';

const NotificationSchema = new mongoose.Schema({
    userId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true,
        index: true
    },
    profileId: { type: mongoose.Schema.Types.ObjectId, default: null, index: true },

    type: {
        type: String,
        enum: [
            'referral_signup',
            'referral_qualified',
            'pod_invite',
            'pod_milestone',
            'pod_message',
            'streak_bonus',
            'pair_matched',
            'pair_message',
            'pair_ended',
            'level_completed',
            'report_resolved',
            'subscription_activated',
            'subscription_ended'
        ],
        required: true
    },

    sourceId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        default: null
    },
    sourceUsername: { type: String, default: '' },
    sourceAvatar: { type: String, default: '' },

    podId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Pod',
        default: null
    },
    pairId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Pair',
        default: null
    },

    content: { type: String, required: true },
    title: { type: String, default: '' },

    isRead: { type: Boolean, default: false },
    isClicked: { type: Boolean, default: false },

    createdAt: { type: Date, default: Date.now }
});

NotificationSchema.index({ userId: 1, profileId: 1, isRead: 1, createdAt: -1 });
NotificationSchema.index({ userId: 1, profileId: 1, createdAt: -1 });

const Notification = mongoose.model('Notification', NotificationSchema);

export default Notification;