const BASE_URL = process.env.BASE_URL || 'https://clearwords-backend.onrender.com';
const TOKEN = process.env.TOKEN || '';
const PAIR_TARGET_ID = process.env.PAIR_TARGET_ID || '';

// ============================================
// Tiny test harness
// ============================================
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
// Test sections
// ============================================
async function testPublic() {
    console.log('\n📡 PUBLIC ENDPOINTS\n');

    // 1. Health
    console.log('1️⃣  Health check...');
    try {
        const { status, data } = await req('GET', '/health');
        console.log('   Response:', data);
        check('health', 200, status);
    } catch (err) {
        console.error('   ❌', err.message);
        check('health', 200, 'error');
    }

    // 2. Subscription plans (public)
    console.log('\n2️⃣  Get subscription plans...');
    try {
        const { status, data } = await req('GET', '/api/subscription/plans');
        console.log('   Response:', data);
        check('plans', 200, status);
    } catch (err) {
        console.error('   ❌', err.message);
        check('plans', 200, 'error');
    }

    // 3. Curriculum
    console.log('\n3️⃣  Get yoruba curriculum...');
    try {
        const { status, data } = await req('GET', '/api/curriculum/yoruba');
        console.log('   Response keys:', data && typeof data === 'object' ? Object.keys(data).slice(0, 5) : data);
        check('curriculum', 200, status);
    } catch (err) {
        console.error('   ❌', err.message);
        check('curriculum', 200, 'error');
    }

    // 4. 404 handler
    console.log('\n4️⃣  404 handler...');
    try {
        const { status, data } = await req('GET', '/does-not-exist');
        console.log('   Response:', data);
        check('404', 404, status);
    } catch (err) {
        console.error('   ❌', err.message);
        check('404', 404, 'error');
    }
}

async function testSignup() {
    console.log('\n👤 SIGNUP\n');

    const timestamp = Date.now();
    const email = `test_${timestamp}@example.com`;
    const auth0Id = `auth0|test_${timestamp}`;

    console.log(`   Email:    ${email}`);
    console.log(`   Auth0 ID: ${auth0Id}\n`);

    const signupBody = {
        auth0Id,
        email,
        fullName: 'Community Test User',
        segment: 'young',
        language: 'yoruba',
        phone: '+2348012345678'
    };

    // 5. Signup
    console.log('5️⃣  Signup...');
    let userId = null;
    try {
        const { status, data } = await req('POST', '/api/auth/signup', { body: signupBody });
        console.log('   Response:', data);
        check('signup', 201, status);
        userId = data?.user?.id || data?.user?._id || null;
        if (userId) console.log(`   User ID: ${userId}`);
    } catch (err) {
        console.error('   ❌', err.message);
        check('signup', 201, 'error');
    }

    // 6. Duplicate signup
    console.log('\n6️⃣  Duplicate signup (expecting 409)...');
    try {
        const { status, data } = await req('POST', '/api/auth/signup', { body: signupBody });
        console.log('   Response:', data);
        check('duplicate-signup', 409, status);
    } catch (err) {
        console.error('   ❌', err.message);
        check('duplicate-signup', 409, 'error');
    }

    // 7. Invalid signup
    console.log('\n7️⃣  Invalid signup — missing auth0Id (expecting 400)...');
    try {
        const { status, data } = await req('POST', '/api/auth/signup', {
            body: { email: 'no-auth0-id@example.com' }
        });
        console.log('   Response:', data);
        check('invalid-signup', 400, status);
    } catch (err) {
        console.error('   ❌', err.message);
        check('invalid-signup', 400, 'error');
    }

    return userId;
}

async function testAuthGuard() {
    console.log('\n🔒 AUTH GUARD (no token)\n');

    console.log('8️⃣  Protected route without token (expecting 401)...');
    try {
        const { status, data } = await req('GET', '/api/pods');
        console.log('   Response:', data);
        check('auth-guard', 401, status);
    } catch (err) {
        console.error('   ❌', err.message);
        check('auth-guard', 401, 'error');
    }
}

async function testAuthenticated() {
    console.log('\n🔐 AUTHENTICATED ENDPOINTS\n');
    const auth = { auth: TOKEN };

    // 9. Get current user
    console.log('9️⃣  GET /api/auth/me...');
    try {
        const { status, data } = await req('GET', '/api/auth/me', auth);
        console.log('   Response:', data);
        check('me', 200, status);
    } catch (err) {
        console.error('   ❌', err.message);
        check('me', 200, 'error');
    }

    // 10. Update profile with language exchange fields
    console.log('\n🔟 Update profile (learningLanguages/teachingLanguages)...');
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
    } catch (err) {
        console.error('   ❌', err.message);
        check('update-profile', 200, 'error');
    }

    // 11. Subscription status
    console.log('\n1️⃣1️⃣  GET /api/subscription...');
    try {
        const { status, data } = await req('GET', '/api/subscription', auth);
        console.log('   Response:', data);
        check('subscription', 200, status);
    } catch (err) {
        console.error('   ❌', err.message);
        check('subscription', 200, 'error');
    }

    // 12. Create pod as free user (expect 403)
    console.log('\n1️⃣2️⃣  Create pod as free user (expecting 403)...');
    try {
        const { status, data } = await req('POST', '/api/pods', {
            ...auth,
            body: { name: 'Yoruba Beginners', language: 'yoruba', level: 'beginner' }
        });
        console.log('   Response:', data);
        check('pod-create-gate', 403, status);
    } catch (err) {
        console.error('   ❌', err.message);
        check('pod-create-gate', 403, 'error');
    }

    // 13. Auto-match into a pod (works on free)
    console.log('\n1️⃣3️⃣  Auto-match into a pod...');
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
    } catch (err) {
        console.error('   ❌', err.message);
        check('pod-match', 201, 'error');
    }

    // 14. List my pods
    console.log('\n1️⃣4️⃣  List my pods...');
    try {
        const { status, data } = await req('GET', '/api/pods', auth);
        console.log('   Response:', data);
        check('pods-list', 200, status);
    } catch (err) {
        console.error('   ❌', err.message);
        check('pods-list', 200, 'error');
    }

    // 15. Pod message
    if (podId) {
        console.log('\n1️⃣5️⃣  Send pod message...');
        try {
            const { status, data } = await req('POST', `/api/pods/${podId}/messages`, {
                ...auth,
                body: { text: 'Hello pod! Ready for week 1?' }
            });
            console.log('   Response:', data);
            check('pod-message', 201, status);
        } catch (err) {
            console.error('   ❌', err.message);
            check('pod-message', 201, 'error');
        }

        // 16. Pod check-in
        console.log('\n1️⃣6️⃣  Pod check-in...');
        try {
            const { status, data } = await req('POST', `/api/pods/${podId}/checkin`, {
                ...auth,
                body: { lessonsCompleted: 5 }
            });
            console.log('   Response:', data);
            check('pod-checkin', 201, status);
        } catch (err) {
            console.error('   ❌', err.message);
            check('pod-checkin', 201, 'error');
        }

        // 17. Duplicate check-in
        console.log('\n1️⃣7️⃣  Duplicate check-in (expecting 400)...');
        try {
            const { status, data } = await req('POST', `/api/pods/${podId}/checkin`, {
                ...auth,
                body: { lessonsCompleted: 3 }
            });
            console.log('   Response:', data);
            check('pod-checkin-dup', 400, status);
        } catch (err) {
            console.error('   ❌', err.message);
            check('pod-checkin-dup', 400, 'error');
        }

        // 18. Pod leaderboard
        console.log('\n1️⃣8️⃣  Pod leaderboard...');
        try {
            const { status, data } = await req('GET', `/api/pods/${podId}/leaderboard`, auth);
            console.log('   Response:', data);
            check('pod-leaderboard', 200, status);
        } catch (err) {
            console.error('   ❌', err.message);
            check('pod-leaderboard', 200, 'error');
        }
    } else {
        console.log('\n⏭️  Skipping pod-message/checkin/leaderboard (no podId)');
    }

    // 19. Pair request
    if (PAIR_TARGET_ID) {
        console.log('\n1️⃣9️⃣  Request a pair...');
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
            check('pair-request', 201, status);
        } catch (err) {
            console.error('   ❌', err.message);
            check('pair-request', 201, 'error');
        }
    } else {
        console.log('\n⏭️  Skipping pair-request (PAIR_TARGET_ID not set)');
    }

    // 20. List pairs
    console.log('\n2️⃣0️⃣  List my pairs...');
    try {
        const { status, data } = await req('GET', '/api/pairs', auth);
        console.log('   Response:', data);
        check('pairs-list', 200, status);
    } catch (err) {
        console.error('   ❌', err.message);
        check('pairs-list', 200, 'error');
    }

    // 21. Create progress card
    console.log('\n2️⃣1️⃣  Create progress card...');
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
        if (cardId) console.log(`   Card ID: ${cardId}`);
    } catch (err) {
        console.error('   ❌', err.message);
        check('card-create', 201, 'error');
    }

    // 22. List my cards
    console.log('\n2️⃣2️⃣  List my cards...');
    try {
        const { status, data } = await req('GET', '/api/cards/mine', auth);
        console.log('   Response:', data);
        check('cards-list', 200, status);
    } catch (err) {
        console.error('   ❌', err.message);
        check('cards-list', 200, 'error');
    }

    // 23. Share card externally
    if (cardId) {
        console.log('\n2️⃣3️⃣  Share card externally...');
        try {
            const { status, data } = await req('POST', `/api/cards/${cardId}/share/external`, auth);
            console.log('   Response:', data);
            check('card-share', 200, status);
        } catch (err) {
            console.error('   ❌', err.message);
            check('card-share', 200, 'error');
        }
    }

    // 24. Report a user
    if (PAIR_TARGET_ID) {
        console.log('\n2️⃣4️⃣  Report a user...');
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
        } catch (err) {
            console.error('   ❌', err.message);
            check('report', 201, 'error');
        }
    } else {
        console.log('\n⏭️  Skipping report (PAIR_TARGET_ID not set)');
    }

    // 25. Notifications
    console.log('\n2️⃣5️⃣  Get notifications...');
    try {
        const { status, data } = await req('GET', '/api/notifications', auth);
        console.log('   Response:', data);
        check('notifications', 200, status);
    } catch (err) {
        console.error('   ❌', err.message);
        check('notifications', 200, 'error');
    }

    // 26. Unread count
    console.log('\n2️⃣6️⃣  Unread count...');
    try {
        const { status, data } = await req('GET', '/api/notifications/unread', auth);
        console.log('   Response:', data);
        check('unread', 200, status);
    } catch (err) {
        console.error('   ❌', err.message);
        check('unread', 200, 'error');
    }
}

// ============================================
// Main
// ============================================
async function main() {
    console.log('=====================================');
    console.log('🚀 ClearWords Community Model Test');
    console.log('=====================================');
    console.log(`Base URL: ${BASE_URL}`);
    console.log(`Token:    ${TOKEN ? '✅ provided' : '❌ not set'}`);
    console.log(`Pair tgt: ${PAIR_TARGET_ID || '❌ not set'}`);
    console.log('');

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
    }
    console.log('=====================================');

    process.exit(FAIL === 0 ? 0 : 1);
}

main().catch(err => {
    console.error('\n💥 Fatal error:', err);
    process.exit(1);
});