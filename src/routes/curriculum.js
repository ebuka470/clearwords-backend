const express = require('express');
const router = express.Router();
const fs = require('fs');
const path = require('path');

// Load all curriculum data
const CURRICULUM_DATA = {};
const DATA_DIR = path.join(__dirname, '../data');

// Check if data directory exists, create if not
if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
}

// Read all JSON files in data directory
try {
    const files = fs.readdirSync(DATA_DIR);
    files.forEach((file) => {
        if (file.endsWith('.json')) {
            const language = file.replace('.json', '');
            const data = JSON.parse(fs.readFileSync(path.join(DATA_DIR, file), 'utf8'));
            CURRICULUM_DATA[language] = data;
        }
    });
} catch (error) {
    console.warn('No curriculum data found. Please add JSON files to /data directory.');
}

// Add version to each curriculum
const VERSIONS = {};
Object.keys(CURRICULUM_DATA).forEach((lang) => {
    VERSIONS[lang] = {
        version: CURRICULUM_DATA[lang].version || '1.0.0',
        lastUpdated: CURRICULUM_DATA[lang].lastUpdated || new Date().toISOString()
    };
});

/**
 * GET /api/curriculum/:language
 * Get full curriculum for a language
 */
router.get('/:language', (req, res) => {
    const { language } = req.params;
    const data = CURRICULUM_DATA[language];

    if (!data) {
        return res.status(404).json({ error: 'Language not found' });
    }

    res.json(data);
});

/**
 * GET /api/curriculum/version/:language
 * Get curriculum version
 */
router.get('/version/:language', (req, res) => {
    const { language } = req.params;
    const version = VERSIONS[language];

    if (!version) {
        return res.status(404).json({ error: 'Language not found' });
    }

    res.json(version);
});

/**
 * GET /api/curriculum/check/:language
 * Check if curriculum has been updated
 */
router.get('/check/:language', (req, res) => {
    const { language } = req.params;
    const data = CURRICULUM_DATA[language];

    if (!data) {
        return res.status(404).json({ error: 'Language not found' });
    }

    res.json({
        hasUpdate: false,
        version: data.version || '1.0.0'
    });
});

module.exports = router;