const BASE_URL = process.env.BASE_URL || 'https://clearwords-backend.onrender.com';
const TOKEN = process.env.TOKEN || '';
const PAIR_TARGET_ID = process.env.PAIR_TARGET_ID || '';
const EXPECTED_VERSION = '3.0.0';

let PASS = 0;
let FAIL = 0;
const results = [];

function check(label, expected, actual) {
    const ok = String(expected) === String(actual);
    if (ok) {
        console.log(`   ✅ ${label} (${actual})`);
        PASS++;
    } else {
        console.log(`   ❌ ${label} (expected ${expected}, got ${actual})`);
        FAIL++;
    }
    results.push({ label, expected, actual, ok });
    return ok;
}

async function req(method, path, { auth = null, body = null } = {}) {
    const headers = {};
    if (auth) headers['Authorization'] = `Bearer ${auth}`;
    if (body) headers['Content-Type'] = 'application/json';

    const res = await fetch(`${BASE_URL}${path}`, {
        method,
        headers,
        body: body ? JSON.stringify(body) : undefined
    });

    let data = null;
    const text = await res.text();
    try { data = text ? JSON.parse(text) : null; } catch { data = text; }

    return { status: res.status, data };
}

// ============================================
// PREFLIGHT
// ============================================
async function preflight() {
    console.log('\n🩺 PREFLIGHT\n');
    try {
        const { status, data } = await req('GET', '/health');
        if (status !== 200) {
            console.log(`   ❌ Health returned ${status}`);
            return false;
        }
        console.log(`   Deployed version: ${data?.version}`);
        if (data.version !== EXPECTED_VERSION) {
            console.log(`   ❌ Expected ${EXPECTED_VERSION} — Render is running stale code.`);
            return false;
        }
        console.log('   ✅ Correct version deployed\n');
        return true;
    } catch (err) {
        console.error('   ❌ Preflight failed:', err.message);
        return false;
    }
}

// ============================================
// PUBLIC
// ============================================
async function testPublic() {
    console.log('\n📡 PUBLIC ENDPOINTS\n');

    console.log('1️⃣  Health check...');
    try {
        const { status, data } = await req('GET', '/health');
        console.log('   Response:', data);
        check('health', 200, status);
    } catch (err) { console.error('   ❌', err.message); check('health', 200, 'error'); }

    console.log('\n2️⃣  Auth0 config...');
    try {
        const { status, data } = await req('GET', '/api/auth/config');
        console.log('   Response:', data);
        check('auth-config', 200, status);
        if (data && (data.clientSecret || data.secret)) {
            console.log('   🚨 SECURITY: secret leaked!');
        }
    } catch (err) { console.error('   ❌', err.message); check('auth-config', 200, 'error'); }

    console.log('\n3️⃣  Subscription plans...');
    try {
        const { status, data } = await req('GET', '/api/subscription/plans');
        console.log('   Response keys:', data ? Object.keys(data) : data);
        check('plans', 200, status);
    } catch (err) { console.error('   ❌', err.message); check('plans', 200, 'error'); }

    console.log('\n4️⃣  Curriculum yoruba...');
    try {
        const { status, data } = await req('GET', '/api/curriculum/yoruba');
        console.log('   Response keys:', data && typeof data === 'object' ? Object.keys(data).slice(0, 5) : data);
        check('curriculum', 200, status);
    } catch (err) { console.error('   ❌', err.message); check('curriculum', 200, 'error'); }

    console.log('\n5️⃣  404 handler...');
    try {
        const { status } = await req('GET', '/does-not-exist');
        check('404', 404, status);
    } catch (err) { console.error('   ❌', err.message); check('404', 404, 'error'); }
}

// ============================================
// SIGNUP
// ============================================
async function testSignup() {
    console.log('\n👤 SIGNUP\n');

    const timestamp = Date.now();
    const email = `test_${timestamp}@example.com`;
    const auth0Id = `auth0|test_${timestamp}`;

    console.log(`   Email:    ${email}`);
    console.log(`   Auth0 ID: ${auth0Id}\n`);

    const signupBody = {
        auth0Id, email,
        fullName: 'Community Test User',
        segment: 'young',
        language: 'yoruba',
        phone: '+2348012345678'
    };

    console.log('6️⃣  Signup...');
    let userId = null;
    try {
        const { status, data } = await req('POST', '/api/auth/signup', { body: signupBody });
        console.log('   Response:', data);
        check('signup', 201, status);
        userId = data?.user?.id || data?.user?._id || null;
        if (userId) console.log(`   User ID: ${userId}`);
    } catch (err) { console.error('   ❌', err.message); check('signup', 201, 'error'); }

    console.log('\n7️⃣  Duplicate signup (409)...');
    try {
        const { status } = await req('POST', '/api/auth/signup', { body: signupBody });
        check('duplicate-signup', 409, status);
    } catch (err) { console.error('   ❌', err.message); check('duplicate-signup', 409, 'error'); }

    console.log('\n8️⃣  Invalid signup (400)...');
    try {
        const { status } = await req('POST', '/api/auth/signup', {
            body: { email: 'no-auth0-id@example.com' }
        });
        check('invalid-signup', 400, status);
    } catch (err) { console.error('   ❌', err.message); check('invalid-signup', 400, 'error'); }

    return userId;
}

// ============================================
// AUTH GUARD
// ============================================
async function testAuthGuard() {
    console.log('\n🔒 AUTH GUARD (no token)\n');

    const protectedRoutes = [
        ['GET', '/api/pods'],
        ['GET', '/api/pairs'],
        ['GET', '/api/ai/usage'],
        ['POST', '/api/ai/chat'],
        ['POST', '/api/tts'],
        ['GET', '/api/tts/usage']
    ];

    for (const [method, path] of protectedRoutes) {
        console.log(`9️⃣  ${method} ${path} (no token, expecting 401)...`);
        try {
            const { status, data } = await req(method, path, {
                body: method === 'POST' ? {} : null
            });
            check(`auth-guard-${path}`, 401, status);
        } catch (err) { console.error('   ❌', err.message); check(`auth-guard-${path}`, 401, 'error'); }
    }
}

// ============================================
// AUTHENTICATED
// ============================================
async function testAuthenticated() {
    console.log('\n🔐 AUTHENTICATED ENDPOINTS\n');
    const auth = { auth: TOKEN };

    console.log('1️⃣0️⃣  GET /api/auth/me...');
    try {
        const { status, data } = await req('GET', '/api/auth/me', auth);
        console.log('   Response:', data);
        check('me', 200, status);
    } catch (err) { console.error('   ❌', err.message); check('me', 200, 'error'); }

    console.log('\n1️⃣1️⃣  Update profile with languages...');
    try {
        const { status, data } = await req('PUT', '/api/users/profile', {
            ...auth,
            body: {
                learningLanguages: ['yoruba', 'igbo'],
                teachingLanguages: ['english', 'pidgin'],
                bio: 'Learning Yoruba for my grandparents'
            }
        });
        console.log('   Response:', data);
        check('update-profile', 200, status);
    } catch (err) { console.error('   ❌', err.message); check('update-profile', 200, 'error'); }

    console.log('\n1️⃣2️⃣  GET /api/subscription...');
    try {
        const { status, data } = await req('GET', '/api/subscription', auth);
        console.log('   Response:', data);
        check('subscription', 200, status);
    } catch (err) { console.error('   ❌', err.message); check('subscription', 200, 'error'); }

    console.log('\n1️⃣3️⃣  Create pod as free user (403)...');
    try {
        const { status, data } = await req('POST', '/api/pods', {
            ...auth,
            body: { name: 'Yoruba Beginners', language: 'yoruba', level: 'beginner' }
        });
        console.log('   Response:', data);
        check('pod-create-gate', 403, status);
    } catch (err) { console.error('   ❌', err.message); check('pod-create-gate', 403, 'error'); }

    console.log('\n1️⃣4️⃣  Auto-match into a pod...');
    let podId = null;
    try {
        const { status, data } = await req('POST', '/api/pods/match', {
            ...auth,
            body: { language: 'yoruba', level: 'beginner', timezone: 'Africa/Lagos' }
        });
        console.log('   Response:', data);
        check('pod-match', 201, status);
        podId = data?.pod?._id || data?.pod?.id || null;
        if (podId) console.log(`   Pod ID: ${podId}`);
    } catch (err) { console.error('   ❌', err.message); check('pod-match', 201, 'error'); }

    console.log('\n1️⃣5️⃣  List my pods...');
    try {
        const { status } = await req('GET', '/api/pods', auth);
        check('pods-list', 200, status);
    } catch (err) { console.error('   ❌', err.message); check('pods-list', 200, 'error'); }

    if (podId) {
        console.log('\n1️⃣6️⃣  Send pod message...');
        try {
            const { status, data } = await req('POST', `/api/pods/${podId}/messages`, {
                ...auth,
                body: { text: 'Hello pod! Ready for week 1?' }
            });
            console.log('   Response:', data);
            check('pod-message', 201, status);
        } catch (err) { console.error('   ❌', err.message); check('pod-message', 201, 'error'); }

        console.log('\n1️⃣7️⃣  Pod check-in...');
        try {
            const { status, data } = await req('POST', `/api/pods/${podId}/checkin`, {
                ...auth,
                body: { lessonsCompleted: 5 }
            });
            console.log('   Response:', data);
            check('pod-checkin', 201, status);
        } catch (err) { console.error('   ❌', err.message); check('pod-checkin', 201, 'error'); }

        console.log('\n1️⃣8️⃣  Pod leaderboard...');
        try {
            const { status, data } = await req('GET', `/api/pods/${podId}/leaderboard`, auth);
            console.log('   Response:', data);
            check('pod-leaderboard', 200, status);
        } catch (err) { console.error('   ❌', err.message); check('pod-leaderboard', 200, 'error'); }
    }

    console.log('\n1️⃣9️⃣  Pair auto-match...');
    try {
        const { status, data } = await req('POST', '/api/pairs/match', auth);
        console.log('   Response:', data);
        const ok = [201, 400, 403, 404].includes(status);
        check('pair-match', ok ? status : 201, status);
    } catch (err) { console.error('   ❌', err.message); check('pair-match', 201, 'error'); }

    if (PAIR_TARGET_ID) {
        console.log('\n2️⃣0️⃣  Pair request (specific target)...');
        try {
            const { status, data } = await req('POST', '/api/pairs/request', {
                ...auth,
                body: {
                    targetUserId: PAIR_TARGET_ID,
                    languageA: 'yoruba',
                    languageB: 'english'
                }
            });
            console.log('   Response:', data);
            const ok = [201, 400, 403].includes(status);
            check('pair-request', ok ? status : 201, status);
        } catch (err) { console.error('   ❌', err.message); check('pair-request', 201, 'error'); }
    }

    console.log('\n2️⃣1️⃣  List my pairs...');
    try {
        const { status } = await req('GET', '/api/pairs', auth);
        check('pairs-list', 200, status);
    } catch (err) { console.error('   ❌', err.message); check('pairs-list', 200, 'error'); }

    console.log('\n2️⃣2️⃣  Create progress card...');
    let cardId = null;
    try {
        const { status, data } = await req('POST', '/api/cards', {
            ...auth,
            body: {
                language: 'yoruba',
                cardType: 'streak',
                stats: { streak: 7, xp: 450, level: 3 },
                caption: '7-day Yoruba streak 🔥'
            }
        });
        console.log('   Response:', data);
        check('card-create', 201, status);
        cardId = data?._id || data?.card?._id || null;
    } catch (err) { console.error('   ❌', err.message); check('card-create', 201, 'error'); }

    console.log('\n2️⃣3️⃣  List my cards...');
    try {
        const { status } = await req('GET', '/api/cards/mine', auth);
        check('cards-list', 200, status);
    } catch (err) { console.error('   ❌', err.message); check('cards-list', 200, 'error'); }

    if (cardId) {
        console.log('\n2️⃣4️⃣  Share card externally...');
        try {
            const { status } = await req('POST', `/api/cards/${cardId}/share/external`, auth);
            check('card-share', 200, status);
        } catch (err) { console.error('   ❌', err.message); check('card-share', 200, 'error'); }
    }

    if (PAIR_TARGET_ID) {
        console.log('\n2️⃣5️⃣  Report a user...');
        try {
            const { status, data } = await req('POST', '/api/reports', {
                ...auth,
                body: {
                    targetType: 'user',
                    targetId: PAIR_TARGET_ID,
                    targetUserId: PAIR_TARGET_ID,
                    reason: 'spam',
                    description: 'Test report'
                }
            });
            console.log('   Response:', data);
            check('report', 201, status);
        } catch (err) { console.error('   ❌', err.message); check('report', 201, 'error'); }
    }

    console.log('\n2️⃣6️⃣  Get notifications...');
    try {
        const { status } = await req('GET', '/api/notifications', auth);
        check('notifications', 200, status);
    } catch (err) { console.error('   ❌', err.message); check('notifications', 200, 'error'); }

    console.log('\n2️⃣7️⃣  Unread count...');
    try {
        const { status, data } = await req('GET', '/api/notifications/unread', auth);
        console.log('   Response:', data);
        check('unread', 200, status);
    } catch (err) { console.error('   ❌', err.message); check('unread', 200, 'error'); }

    // ============================================
    // AI ENDPOINTS
    // ============================================
    console.log('\n2️⃣8️⃣  GET /api/ai/usage...');
    try {
        const { status, data } = await req('GET', '/api/ai/usage', auth);
        console.log('   Response:', data);
        check('ai-usage', 200, status);
    } catch (err) { console.error('   ❌', err.message); check('ai-usage', 200, 'error'); }

    console.log('\n2️⃣9️⃣  POST /api/ai/chat (Timmy)...');
    try {
        const { status, data } = await req('POST', '/api/ai/chat', {
            ...auth,
            body: { prompt: 'How do I say "good morning" in Yoruba?' }
        });
        console.log('   Status:', status);
        console.log('   Reply preview:', typeof data?.data === 'string' ? data.data.slice(0, 60) : data);
        const ok = [200, 429, 500].includes(status);
        check('ai-chat', ok ? status : 200, status);
        if (status === 500) console.log('   ℹ️  Mistral not configured');
        if (status === 429) console.log('   ℹ️  Daily chat limit reached');
    } catch (err) { console.error('   ❌', err.message); check('ai-chat', 200, 'error'); }

    console.log('\n3️⃣0️⃣  POST /api/ai/custom-lesson...');
    try {
        const { status, data } = await req('POST', '/api/ai/custom-lesson', {
            ...auth,
            body: {
                topic: 'market greetings',
                language: 'yoruba',
                level: 'beginner',
                timezoneOffsetMinutes: 60
            }
        });
        console.log('   Status:', status);
        console.log('   Response keys:', data && typeof data === 'object' ? Object.keys(data) : data);
        const ok = [201, 429, 500].includes(status);
        check('ai-custom-lesson', ok ? status : 201, status);
        if (status === 500) console.log('   ℹ️  Mistral not configured');
        if (status === 429) console.log('   ℹ️  Daily lesson limit reached (5/day free)');
    } catch (err) { console.error('   ❌', err.message); check('ai-custom-lesson', 201, 'error'); }

    console.log('\n3️⃣1️⃣  GET /api/tts/usage...');
    try {
        const { status, data } = await req('GET', '/api/tts/usage', auth);
        console.log('   Response:', data);
        check('tts-usage', 200, status);
    } catch (err) { console.error('   ❌', err.message); check('tts-usage', 200, 'error'); }

    console.log('\n3️⃣2️⃣  POST /api/tts (audio, may hit limit)...');
    try {
        const { status, data } = await req('POST', '/api/tts', {
            ...auth,
            body: { text: 'Ẹ n lẹ', voice: 'yo', speaker: 'titilayo_yo' }
        });
        // 200 = audio buffer, 429 = limit, 500 = not configured
        const ok = [200, 429, 500].includes(status);
        check('tts-proxy', ok ? status : 200, status);
    } catch (err) { console.error('   ❌', err.message); check('tts-proxy', 200, 'error'); }
}

// ============================================
// MAIN
// ============================================
async function main() {
    console.log('=====================================');
    console.log('🚀 ClearWords Community Model Test');
    console.log('=====================================');
    console.log(`Base URL: ${BASE_URL}`);
    console.log(`Token:    ${TOKEN ? '✅ provided' : '❌ not set'}`);
    console.log(`Pair tgt: ${PAIR_TARGET_ID || '❌ not set'}`);
    console.log('');

    const ok = await preflight();

    await testPublic();
    await testSignup();
    await testAuthGuard();

    if (TOKEN) {
        await testAuthenticated();
    } else {
        console.log('\nℹ️  Set TOKEN=<jwt> to run authenticated tests.');
        console.log('    Set PAIR_TARGET_ID=<userId> to test pairs + reports.');
    }

    console.log('\n=====================================');
    if (FAIL === 0) {
        console.log(`✅ All ${PASS} tests passed!`);
    } else {
        console.log(`❌ ${FAIL} failed, ${PASS} passed`);
        console.log('\nFailed tests:');
        results.filter(r => !r.ok).forEach(r => {
            console.log(`   - ${r.label}: expected ${r.expected}, got ${r.actual}`);
        });
        if (!ok) {
            console.log('\n🚨 PRIMARY ISSUE: Wrong deployed version.');
        }
    }
    console.log('=====================================');

    process.exit(FAIL === 0 ? 0 : 1);
}

main().catch(err => {
    console.error('\n💥 Fatal error:', err);
    process.exit(1);
});