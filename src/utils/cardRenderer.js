import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Cards are written here and served at /public/cards
const CARDS_DIR = path.join(__dirname, '../public/cards');

// Ensure the directory exists at import time
await fs.mkdir(CARDS_DIR, { recursive: true }).catch(() => {});

const CARD_W = 1080;
const CARD_H = 1080;

const PALETTE = {
    yoruba:   { bg: '#0F172A', accent: '#FBBF24', text: '#F8FAFC' },
    hausa:    { bg: '#1E1B4B', accent: '#F472B6', text: '#F8FAFC' },
    igbo:     { bg: '#052E16', accent: '#34D399', text: '#F8FAFC' },
    urhobo:   { bg: '#431407', accent: '#FB923C', text: '#F8FAFC' },
    itsekiri: { bg: '#1E3A8A', accent: '#60A5FA', text: '#F8FAFC' },
    pidgin:   { bg: '#3B0764', accent: '#C084FC', text: '#F8FAFC' }
};

function escapeXml(s) {
    return String(s || '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&apos;');
}

function getPalette(language) {
    return PALETTE[language] || PALETTE.yoruba;
}

function formatNumber(n) {
    if (typeof n !== 'number') return '—';
    if (n >= 1000000) return (n / 1000000).toFixed(1) + 'M';
    if (n >= 1000) return (n / 1000).toFixed(1) + 'K';
    return String(n);
}

function buildStatsBlock(stats, cardType, accent) {
    const rows = [];

    const push = (label, value) => {
        rows.push({ label, value: formatNumber(value) });
    };

    if (cardType === 'streak') {
        if (stats.streak != null) push('Day streak', stats.streak);
        if (stats.xp != null) push('Total XP', stats.xp);
    } else if (cardType === 'lessons') {
        if (stats.lessonsCompleted != null) push('Lessons done', stats.lessonsCompleted);
        if (stats.xp != null) push('Total XP', stats.xp);
    } else if (cardType === 'vocab') {
        if (stats.wordsMastered != null) push('Words mastered', stats.wordsMastered);
        if (stats.xp != null) push('Total XP', stats.xp);
    } else if (cardType === 'pronunciation') {
        if (stats.pronunciationScore != null) push('Pronunciation', stats.pronunciationScore + '%');
        if (stats.xp != null) push('Total XP', stats.xp);
    } else {
        // milestone
        if (stats.level != null) push('Level', stats.level);
        if (stats.xp != null) push('Total XP', stats.xp);
    }

    return rows;
}

export function renderCardSVG({
    username,
    language,
    cardType,
    stats = {},
    caption = '',
    avatarUrl = ''
}) {
    const p = getPalette(language);
    const langLabel = language.charAt(0).toUpperCase() + language.slice(1);

    const titleMap = {
        streak: 'Day Streak',
        lessons: 'Lessons Completed',
        vocab: 'Words Mastered',
        pronunciation: 'Pronunciation',
        milestone: 'Milestone Reached'
    };
    const headline = titleMap[cardType] || 'Progress';
    const rows = buildStatsBlock(stats, cardType, p.accent);

    const statRowHeight = 120;
    const statsTop = 480;

    const statRows = rows.slice(0, 3).map((r, i) => {
        const y = statsTop + i * statRowHeight;
        return `
            <text x="80" y="${y}" font-size="36" fill="${p.text}" opacity="0.75" font-family="Inter, Arial, sans-serif">${escapeXml(r.label)}</text>
            <text x="${CARD_W - 80}" y="${y + 8}" font-size="64" font-weight="700" text-anchor="end" fill="${p.accent}" font-family="Inter, Arial, sans-serif">${escapeXml(r.value)}</text>
            <line x1="80" y1="${y + 30}" x2="${CARD_W - 80}" y2="${y + 30}" stroke="${p.text}" stroke-opacity="0.15" stroke-width="1" />
        `;
    }).join('');

    const safeCaption = caption ? escapeXml(caption.slice(0, 120)) : '';
    const safeUsername = escapeXml(username || 'Learner');
    const avatarMark = (safeUsername[0] || '?').toUpperCase();

    return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${CARD_W}" height="${CARD_H}" viewBox="0 0 ${CARD_W} ${CARD_H}">
    <defs>
        <linearGradient id="bgGrad" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stop-color="${p.bg}" />
            <stop offset="100%" stop-color="#000000" stop-opacity="0.85" />
        </linearGradient>
        <linearGradient id="accentGrad" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0%" stop-color="${p.accent}" stop-opacity="0.9" />
            <stop offset="100%" stop-color="${p.accent}" stop-opacity="0.3" />
        </linearGradient>
    </defs>

    <!-- Background -->
    <rect width="${CARD_W}" height="${CARD_H}" fill="url(#bgGrad)" />

    <!-- Top accent bar -->
    <rect x="0" y="0" width="${CARD_W}" height="8" fill="url(#accentGrad)" />

    <!-- Brand -->
    <text x="80" y="110" font-size="32" font-weight="700" fill="${p.accent}" font-family="Inter, Arial, sans-serif">ClearWords</text>
    <text x="${CARD_W - 80}" y="110" font-size="28" text-anchor="end" fill="${p.text}" opacity="0.6" font-family="Inter, Arial, sans-serif">${escapeXml(langLabel)}</text>

    <!-- Avatar -->
    <circle cx="140" cy="270" r="60" fill="${p.accent}" fill-opacity="0.2" stroke="${p.accent}" stroke-width="3" />
    <text x="140" y="295" font-size="56" font-weight="700" text-anchor="middle" fill="${p.accent}" font-family="Inter, Arial, sans-serif">${escapeXml(avatarMark)}</text>

    <!-- Username -->
    <text x="230" y="260" font-size="44" font-weight="700" fill="${p.text}" font-family="Inter, Arial, sans-serif">${safeUsername}</text>
    <text x="230" y="305" font-size="28" fill="${p.text}" opacity="0.65" font-family="Inter, Arial, sans-serif">${escapeXml(headline)}</text>

    <!-- Big number -->
    <text x="80" y="440" font-size="160" font-weight="800" fill="${p.accent}" font-family="Inter, Arial, sans-serif">${rows[0] ? escapeXml(rows[0].value) : '—'}</text>
    <text x="80" y="475" font-size="28" fill="${p.text}" opacity="0.7" font-family="Inter, Arial, sans-serif">${rows[0] ? escapeXml(rows[0].label) : ''}</text>

    <!-- Stats -->
    ${statRows}

    <!-- Caption -->
    ${safeCaption ? `<text x="80" y="${CARD_H - 180}" font-size="32" fill="${p.text}" opacity="0.85" font-family="Inter, Arial, sans-serif">"${safeCaption}"</text>` : ''}

    <!-- Footer -->
    <text x="80" y="${CARD_H - 80}" font-size="24" fill="${p.text}" opacity="0.5" font-family="Inter, Arial, sans-serif">clearwords.com.ng</text>
    <text x="${CARD_W - 80}" y="${CARD_H - 80}" font-size="24" text-anchor="end" fill="${p.text}" opacity="0.5" font-family="Inter, Arial, sans-serif">Join the movement 🇳🇬</text>
</svg>`;
}

/**
 * Render and save an SVG card to disk.
 * Returns { imageUrl, imagePath }.
 */
export async function saveCardSVG({
    cardId,
    username,
    language,
    cardType,
    stats,
    caption,
    avatarUrl
}) {
    const svg = renderCardSVG({ username, language, cardType, stats, caption, avatarUrl });
    const filename = `card_${cardId}.svg`;
    const filePath = path.join(CARDS_DIR, filename);
    await fs.writeFile(filePath, svg, 'utf8');
    return {
        imagePath: filePath,
        imageUrl: `/public/cards/${filename}`
    };
}

export { CARDS_DIR };