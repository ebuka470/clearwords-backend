const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const compression = require('compression');
const morgan = require('morgan');
require('dotenv').config();

const { connectDB } = require('./config/mongodb');

// ============================================
// APP INITIALIZATION
// ============================================

const app = express();
const PORT = process.env.PORT || 3000;

// ============================================
// ROUTES
// ============================================

const authRoutes = require('./routes/auth');
const userRoutes = require('./routes/users');
const progressRoutes = require('./routes/progress');
const postRoutes = require('./routes/posts');
const commentRoutes = require('./routes/comments');
const followRoutes = require('./routes/follow');
const notificationRoutes = require('./routes/notifications');
const subscriptionRoutes = require('./routes/subscription');
const curriculumRoutes = require('./routes/curriculum');
const ttsRouter = require('./routes/tts');

// ============================================
// CONNECT DATABASE
// ============================================

connectDB();

// ============================================
// SECURITY
// ============================================

app.use(helmet({
    contentSecurityPolicy: false,
    crossOriginEmbedderPolicy: false
}));

// ============================================
// CORS
// ============================================

app.use(cors({
    origin: function (origin, callback) {
        // Allow requests without an Origin header
        // such as server-to-server requests
        if (!origin) {
            return callback(null, true);
        }

        const allowedOrigins = [
            'https://clearwords.vercel.app',
            'http://localhost:3000',
            'http://localhost:5173',
            'http://localhost:8081',
            'http://localhost:19006'
        ];

        if (allowedOrigins.includes(origin)) {
            return callback(null, true);
        }

        console.log('Blocked CORS origin:', origin);

        return callback(new Error('Not allowed by CORS'));
    },

    credentials: true,

    methods: [
        'GET',
        'POST',
        'PUT',
        'DELETE',
        'OPTIONS'
    ],

    allowedHeaders: [
        'Content-Type',
        'Authorization',
        'X-Requested-With'
    ],

    maxAge: 86400
}));

// Explicitly handle OPTIONS preflight requests
app.options('*', cors());

// ============================================
// GENERAL MIDDLEWARE
// ============================================

app.use(compression());

app.use(morgan('dev'));

app.use(express.json({
    limit: '10mb'
}));

app.use(express.urlencoded({
    extended: true,
    limit: '10mb'
}));

// ============================================
// HEALTH CHECK
// ============================================

app.get('/health', (req, res) => {
    res.json({
        status: 'healthy',
        service: 'clearwords-backend',
        timestamp: new Date().toISOString(),
        version: '2.0.0',
        database: 'MongoDB Atlas'
    });
});

// ============================================
// CLEARWORDS TTS ROUTE
// ============================================

// This gives:
// POST /clearwordsapi/tts
// GET  /clearwordsapi/tts/credits

app.use('/clearwordsapi', ttsRouter);

// ============================================
// OTHER API ROUTES
// ============================================

app.use('/api/auth', authRoutes);
app.use('/api/users', userRoutes);
app.use('/api/progress', progressRoutes);
app.use('/api/posts', postRoutes);
app.use('/api/comments', commentRoutes);
app.use('/api/follow', followRoutes);
app.use('/api/notifications', notificationRoutes);
app.use('/api/subscription', subscriptionRoutes);
app.use('/api/curriculum', curriculumRoutes);

// Use the same ttsRouter variable
app.use('/api/tts', ttsRouter);

// ============================================
// 404 HANDLER
// ============================================

app.use((req, res) => {
    res.status(404).json({
        error: 'Endpoint not found',
        path: req.originalUrl
    });
});

// ============================================
// ERROR HANDLER
// ============================================

app.use((err, req, res, next) => {
    console.error('Server error:', err.stack);

    res.status(err.status || 500).json({
        error: err.message || 'Internal server error'
    });
});

// ============================================
// START SERVER
// ============================================

app.listen(PORT, () => {
    console.log('🚀 ClearWords Backend v2.0');
    console.log(`📍 Running on port ${PORT}`);
    console.log(`📊 Health: /health`);
    console.log(`🎤 TTS: /clearwordsapi/tts`);
});