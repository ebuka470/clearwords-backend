import mongoose from 'mongoose';
import User from './models/User.js';
import Progress from './models/Progress.js';
import LessonCompletion from './models/LessonCompletion.js';
import Notification from './models/Notification.js';
import PodMessage from './models/PodMessage.js';
import PairMessage from './models/PairMessage.js';
import UsageCounter from './models/UsageCounter.js';
import StreakFreeze from './models/StreakFreeze.js';

// Use your project's existing DB connection!
// (Change './config/mongodb.js' if your connection file is somewhere else)
import { connectDB } from './config/mongodb.js';

async function fixOrphanedData() {
    try {
        console.log('Connecting to MongoDB...');
        
        // This uses your project's existing connection logic
        await connectDB(); 
        console.log('Connected! Scanning for orphaned data...');

        const users = await User.find({});
        let count = 0;

        for (const user of users) {
            const nullScope = { 
                userId: user._id, 
                $or: [{ profileId: null }, { profileId: { $exists: false } }] 
            };

            const p1 = await Progress.updateMany(nullScope, { $set: { profileId: null } });
            const p2 = await LessonCompletion.updateMany(nullScope, { $set: { profileId: null } });
            const p3 = await Notification.updateMany(nullScope, { $set: { profileId: null } });
            const p4 = await UsageCounter.updateMany(nullScope, { $set: { profileId: null } });
            const p5 = await StreakFreeze.updateMany(nullScope, { $set: { profileId: null } });
            
            const p6 = await PodMessage.updateMany({ 
                authorId: user._id, 
                $or: [{ profileId: null }, { profileId: { $exists: false } }] 
            }, { $set: { profileId: null } });
            
            const p7 = await PairMessage.updateMany({ 
                senderId: user._id, 
                $or: [{ profileId: null }, { profileId: { $exists: false } }] 
            }, { $set: { profileId: null } });

            const moved = (p1.modifiedCount || 0) + (p2.modifiedCount || 0) + (p3.modifiedCount || 0) + 
                          (p4.modifiedCount || 0) + (p5.modifiedCount || 0) + (p6.modifiedCount || 0) + (p7.modifiedCount || 0);
            
            if (moved > 0) {
                console.log(`✅ Fixed ${moved} orphaned records for user: ${user.email}`);
                count += moved;
            }
        }

        console.log(`\n🎉 Done! Successfully tagged ${count} records with profileId: null.`);
        process.exit(0);
    } catch (error) {
        console.error('❌ Error:', error);
        process.exit(1);
    }
}

fixOrphanedData();