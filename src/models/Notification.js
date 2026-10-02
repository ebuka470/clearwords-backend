import mongoose from 'mongoose';

const NotificationSchema = new mongoose.Schema({
    userId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true,
        index: true
    },

    type: {
        type: String,
        enum: [
            // Referrals
            'referral_signup',
            'referral_qualified',

            // Pods
            'pod_invite',
            'pod_milestone',
            'pod_message',
            'streak_bonus',

            // Pairs
            'pair_matched',
            'pair_message',
            'pair_ended',

            // Progress
            'level_completed',

            // Reports
            'report_resolved',

            // Subscriptions
            'subscription_activated',
            'subscription_ended'
        ],
        required: true
    },

    // Who triggered the notification (optional for system messages)
    sourceId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        default: null
    },
    sourceUsername: { type: String, default: '' },
    sourceAvatar: { type: String, default: '' },

    // Context
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

    // Body
    content: { type: String, required: true },
    title: { type: String, default: '' },

    // State
    isRead: { type: Boolean, default: false },
    isClicked: { type: Boolean, default: false },

    createdAt: { type: Date, default: Date.now }
});

NotificationSchema.index({ userId: 1, isRead: 1, createdAt: -1 });
NotificationSchema.index({ userId: 1, createdAt: -1 });

const Notification = mongoose.model('Notification', NotificationSchema);

export default Notification;