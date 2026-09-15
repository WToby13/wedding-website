// GET /api/photos?code=… — the photo list, served from Vercel's edge cache.
//
// Asking the Apps Script directly can take 1–20s when it hasn't run for a while.
// This function asks it on the browser's behalf and lets Vercel cache the answer:
// guests get the cached list instantly while a fresh copy is fetched in the
// background (stale-while-revalidate). photos.js falls back to calling the
// Apps Script directly if this endpoint isn't available.

const SCRIPT_URL = 'https://script.google.com/macros/s/AKfycbxFFDWWzp2ryFCGL6D6TyKVXIRTkHUqZkLiEGaSgGtbkq0RHIvnEGAN5ziOM0wuZOmO6g/exec';
const PASSCODE = 'andrea'; // same as the Apps Script; compared case-insensitively
const ATTEMPTS = 3;
const ATTEMPT_TIMEOUT_MS = 15000;

async function fetchList() {
    let lastError;
    for (let attempt = 1; attempt <= ATTEMPTS; attempt++) {
        try {
            const res = await fetch(`${SCRIPT_URL}?action=photosList&code=${PASSCODE}`, {
                signal: AbortSignal.timeout(ATTEMPT_TIMEOUT_MS),
            });
            // Apps Script occasionally answers its redirect with an HTML error page.
            if (!res.ok) throw new Error(`http_${res.status}`);
            const data = await res.json();
            if (!Array.isArray(data.photos)) throw new Error(data.error || 'bad_response');
            return data;
        } catch (err) {
            lastError = err;
        }
    }
    throw lastError;
}

module.exports = async (req, res) => {
    if (String(req.query.code || '').trim().toLowerCase() !== PASSCODE) {
        res.setHeader('Cache-Control', 'no-store');
        return res.status(401).json({ error: 'bad_code' });
    }
    try {
        const data = await fetchList();
        // The list is the same for every guest ("mine" is worked out in the browser),
        // so one cached copy serves everyone.
        data.photos.forEach(photo => { delete photo.mine; });
        res.setHeader('Cache-Control', 's-maxage=15, stale-while-revalidate=604800');
        return res.status(200).json(data);
    } catch (err) {
        res.setHeader('Cache-Control', 'no-store');
        return res.status(502).json({ error: 'upstream_failed', detail: String(err && err.message) });
    }
};
