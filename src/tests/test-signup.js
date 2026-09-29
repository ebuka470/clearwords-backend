const BASE_URL = process.env.BASE_URL || 'https://clearwords-backend.onrender.com';
const EXPECTED_VERSION = '3.0.0';

// Test user credentials — email is timestamped so re-runs create fresh users.
const TIMESTAMP = Date.now();
const TEST_EMAIL = `test_${TIMESTAMP}@example.com`;
const TEST_PASSWORD = 'test-password-12345';

let TOKEN = process.env.TOKEN || '';
let PAIR_TARGET_ID = process.env.PAIR_TARGET_ID || '';

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

async function req(method, path, { auth = null, body = null, raw = false } = {}) {
    const headers = {};
    if (auth) headers['Authorization'] = `Bearer ${auth}`;
    if (body) headers['Content-Type'] = 'application/json';

    const res = await fetch(`${BASE_URL}${path}`, {
        method,
        headers,
        body: body ? JSON.stringify(body) : undefined
    });

    if (raw) return { status: res.status, res };

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

    console.log('\n2️⃣  Subscription plans...');
    try {
        const { status, data } = await req('GET', '/api/subscription/plans');
        console.log('   Response keys:', data ? Object.keys(data) : data);
        check('plans', 200, status);
    } catch (err) { console.error('   ❌', err.message); check('plans', 200, 'error'); }

    console.log('\n3️⃣  Curriculum yoruba...');
    try {
        const { status, data } = await req('GET', '/api/curriculum/yoruba');
        console.log('   Response keys:', data && typeof data === 'object' ? Object.keys(data).slice(0, 5) : data);
        check('curriculum', 200, status);
    } catch (err) { console.error('   ❌', err.message); check('curriculum', 200, 'error'); }

    console.log('\n4️⃣  404 handler...');
    try {
        const { status } = await req('GET', '/does-not-exist');
        check('404', 404, status);
    } catch (err) { console.error('   ❌', err.message); check('404', 404, 'error'); }
}

// ============================================
// SIGNUP / LOGIN
// ============================================
async function testSignupAndLogin() {
    console.log('\n👤 SIGNUP + LOGIN\n');
    console.log(`   Email:    ${TEST_EMAIL}`);
    console.log(`   Password: ${TEST_PASSWORD}\n`);

    console.log('5️⃣  Signup...');
    try {
        const { status, data } = await req('POST', '/api/auth/signup', {
            body: {
                email: TEST_EMAIL,
                password: TEST_PASSWORD,
                fullName: 'Community Test User',
                segment: 'young',
                language: 'yoruba',
                phone: '+2348012345678'
            }
        });
        console.log('   Response keys:', data ? Object.keys(data) : data);
        check('signup', 201, status);
        if (data?.token) {
            TOKEN = data.token;
            console.log(`   ✅ Got JWT (${data.token.length} chars)`);
        }
    } catch (err) { console.error('   ❌', err.message); check('signup', 201, 'error'); }

    console.log('\n6️⃣  Duplicate signup (expecting 409)...');
    try {
        const { status, data } = await req('POST', '/api/auth/signup', {
            body: {
                email: TEST_EMAIL,
                password: TEST_PASSWORD,
                fullName: 'Community Test User'
            }
        });
        console.log('   Response:', data?.error);
        check('duplicate-signup', 409, status);
    } catch (err) { console.error('   ❌', err.message); check('duplicate-signup', 409, 'error'); }

    console.log('\n7️⃣  Signup with short password (expecting 400)...');
    try {
        const { status } = await req('POST', '/api/auth/signup', {
            body: {
                email: `short_${Date.now()}@example.com`,
                password: 'abc'
            }
        });
        check('short-password', 400, status);
    } catch (err) { console.error('   ❌', err.message); check('short-password', 400, 'error'); }

    console.log('\n8️⃣  Login with correct password...');
    try {
        const { status, data } = await req('POST', '/api/auth/login', {
            body: { email: TEST_EMAIL, password: TEST_PASSWORD }
        });
        console.log('   Response keys:', data ? Object.keys(data) : data);
        check('login', 200, status);
        if (data?.token) {
            TOKEN = data.token;
            console.log(`   ✅ Fresh JWT (${data.token.length} chars)`);
        }
    } catch (err) { console.error('   ❌', err.message); check('login', 200, 'error'); }

    console.log('\n9️⃣  Login with wrong password (expecting 401)...');
    try {
        const { status } = await req('POST', '/api/auth/login', {
            body: { email: TEST_EMAIL, password: 'wrong-password' }
        });
        check('login-wrong-pw', 401, status);
    } catch (err) { console.error('   ❌', err.message); check('login-wrong-pw', 401, 'error'); }

    console.log('\n🔟  Login with non-existent email (expecting 401)...');
    try {
        const { status } = await req('POST', '/api/auth/login', {
            body: { email: `nobody_${Date.now()}@example.com`, password: 'anything12345' }
        });
        check('login-no-user', 401, status);
    } catch (err) { console.error('   ❌', err.message); check('login-no-user', 401, 'error'); }

    console.log('\n1️⃣1️⃣  Password hash never leaked in signup response...');
    try {
        const { data } = await req('POST', '/api/auth/signup', {
            body: {
                email: `leakcheck_${Date.now()}@example.com`,
                password: TEST_PASSWORD,
                fullName: 'Leak Check'
            }
        });
        const serialized = JSON.stringify(data);
        const leaked = serialized.includes('passwordHash') || serialized.includes('$2b$');
        if (leaked) {
            console.log('   🚨 SECURITY: password hash leaked in signup response!');
            check('no-hash-leak', false, true);
        } else {
            check('no-hash-leak', true, true);
        }
    } catch (err) { console.error('   ❌', err.message); check('no-hash-leak', true, 'error'); }
}

// ============================================
// AUTH GUARD
// ============================================
async function testAuthGuard() {
    console.log('\n🔒 AUTH GUARD\n');

    const protectedRoutes = [
        ['GET', '/api/pods'],
        ['GET', '/api/pairs'],
        ['GET', '/api/ai/usage'],
        ['POST', '/api/ai/chat'],
        ['POST', '/api/tts'],
        ['GET', '/api/tts/usage'],
        ['GET', '/api/auth/me']
    ];

    for (const [method, path] of protectedRoutes) {
        console.log(`1️⃣2️⃣  ${method} ${path} (no token, expecting 401)...`);
        try {
            const { status } = await req(method, path, {
                body: method === 'POST' ? {} : null
            });
            check(`auth-guard-${path}`, 401, status);
        } catch (err) { console.error('   ❌', err.message); check(`auth-guard-${path}`, 401, 'error'); }
    }

    console.log('\n1️⃣3️⃣  /api/auth/me with a malformed token (expecting 401)...');
    try {
        const { status } = await req('GET', '/api/auth/me', {
            auth: 'not.a.real.token'
        });
        check('me-malformed-token', 401, status);
    } catch (err) { console.error('   ❌', err.message); check('me-malformed-token', 401, 'error'); }
}

// ============================================
// AUTHENTICATED
// ============================================
async function testAuthenticated() {
    console.log('\n🔐 AUTHENTICATED ENDPOINTS\n');
    const auth = { auth: TOKEN };

    console.log('1️⃣4️⃣  GET /api/auth/me...');
    try {
        const { status, data } = await req('GET', '/api/auth/me', auth);
        console.log('   Response keys:', data ? Object.keys(data).slice(0, 8) : data);
        check('me', 200, status);
        if (data?.passwordHash) {
            console.log('   🚨 SECURITY: passwordHash in /me response!');
        }
    } catch (err) { console.error('   ❌', err.message); check('me', 200, 'error'); }

    console.log('\n1️⃣5️⃣  Update profile...');
    try {
        const { status, data } = await req('PUT', '/api/users/profile', {
            ...auth,
            body: {
                learningLanguages: ['yoruba', 'igbo'],
                teachingLanguages: ['english', 'pidgin'],
                bio: 'Learning Yoruba for my grandparents'
            }
        });
        console.log('   Response keys:', data ? Object.keys(data).slice(0, 6) : data);
        check('update-profile', 200, status);
    } catch (err) { console.error('   ❌', err.message); check('update-profile', 200, 'error'); }

    console.log('\n1️⃣6️⃣  GET /api/subscription...');
    try {
        const { status, data } = await req('GET', '/api/subscription', auth);
        console.log('   Response:', data);
        check('subscription', 200, status);
    } catch (err) { console.error('   ❌', err.message); check('subscription', 200, 'error'); }

    console.log('\n1️⃣7️⃣  GET /api/progress (yoruba)...');
    try {
        const { status, data } = await req('GET', '/api/progress?language=yoruba', auth);
        console.log('   Response keys:', data ? Object.keys(data).slice(0, 8) : data);
        check('progress', 200, status);
    } catch (err) { console.error('   ❌', err.message); check('progress', 200, 'error'); }
}

// ============================================
// MAIN
// ============================================
async function main() {
    console.log('=====================================');
    console.log('🚀 ClearWords Auth Test (Post-Auth0)');
    console.log('=====================================');
    console.log(`Base URL: ${BASE_URL}`);
    console.log('');

    const ok = await preflight();

    await testPublic();
    await testSignupAndLogin();
    await testAuthGuard();

    if (TOKEN) {
        await testAuthenticated();
    } else {
        console.log('\n⚠️  No token obtained — skipping authenticated tests.');
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
        if (!ok) console.log('\n🚨 PRIMARY ISSUE: Wrong deployed version.');
    }
    console.log('=====================================');

    process.exit(FAIL === 0 ? 0 : 1);
}

main().catch(err => {
    console.error('\n💥 Fatal error:', err);
    process.exit(1);
});