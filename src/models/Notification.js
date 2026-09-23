import mongoose from 'mongoose';

const NotificationSchema = new mongoose.Schema({
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },

  type: {
    type: String,
    enum: [
        'pod_invite',
        'pod_milestone',
        'pod_message',
        'pair_matched',
        'pair_message',
        'pair_ended',
        'streak_bonus',
        'report_resolved',
        'subscription_activated',
        'subscription_ended'
    ],
    required: true
},

    // Source (who triggered it — optional for system notifications)
    sourceId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    sourceUsername: { type: String, default: '' },
    sourceAvatar: { type: String, default: '' },

    // Target context
    podId: { type: mongoose.Schema.Types.ObjectId, ref: 'Pod', default: null },
    pairId: { type: mongoose.Schema.Types.ObjectId, ref: 'Pair', default: null },

    content: { type: String, required: true },
    isRead: { type: Boolean, default: false },
    isClicked: { type: Boolean, default: false },

    createdAt: { type: Date, default: Date.now }
});

NotificationSchema.index({ userId: 1, isRead: 1, createdAt: -1 });

const Notification = mongoose.model('Notification', NotificationSchema);

export default Notification;