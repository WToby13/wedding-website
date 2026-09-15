// Photos page: guests unlock with a passcode, upload photos/videos to the shared
// Google Drive folder, and browse them in a grid or a swipeable theater view.

// Google Apps Script web app URL (shared with the RSVP + tennis backend)
const SCRIPT_URL = 'https://script.google.com/macros/s/AKfycbxFFDWWzp2ryFCGL6D6TyKVXIRTkHUqZkLiEGaSgGtbkq0RHIvnEGAN5ziOM0wuZOmO6g/exec';
const DRIVE_THUMBNAIL_URL = 'https://drive.google.com/thumbnail';
const DRIVE_FILE_URL = 'https://drive.google.com/file/d/';
const DRIVE_DOWNLOAD_URL = 'https://drive.google.com/uc?export=download&id=';

const CODE_KEY = 'photosCode';
const NAME_KEY = 'photosName';
const DEVICE_KEY = 'photosDevice';

const POLL_INTERVAL_MS = 60000;
const MAX_VIDEO_SECONDS = 180;
const MAX_VIDEO_LABEL = '3 minutes';
const MAX_IMAGE_BYTES = 100 * 1024 * 1024;
const MAX_VIDEO_BYTES = 2 * 1024 * 1024 * 1024;
const PARALLEL_UPLOADS = 3;
const RELAY_CHUNK_BYTES = 4 * 1024 * 1024; // Drive requires multiples of 256 KiB
const RECENT_MS = 3 * 60 * 1000; // local adds/deletes win over a stale cached list
const TIME_ZONE = 'Europe/Paris';
const DEFAULT_OFFSET = '+02:00'; // France in September
const PREVIEWABLE_IMAGE = /^image\/(jpeg|png|gif|webp|avif)$/;

// The weekend, in order. A photo belongs to the last section whose start it is
// at or after; photos without a capture time go at the end of the last section.
const SECTIONS = [
    { id: 'arriving', title: "Arriving in Côte d'Azur", note: 'Before Friday evening', start: null },
    { id: 'welcome', title: 'Welcome to La Napoule', note: 'Friday evening · Hotel La Calanque', start: '2026-09-11T18:00:00+02:00' },
    { id: 'tennis', title: 'Olsen-Keating Open at Barbossi', note: 'Saturday morning · Country Club de Barbossi', start: '2026-09-12T08:30:00+02:00' },
    { id: 'wedding', title: 'Wedding Celebration', note: 'Saturday · Restaurant Le Repère', start: '2026-09-12T13:00:00+02:00' },
    { id: 'sunday', title: 'Sunday Funday', note: 'Sunday · CASAROSE La Plage', start: '2026-09-13T06:00:00+02:00' },
    { id: 'additional', title: 'Additional', note: 'After the weekend', start: '2026-09-14T06:00:00+02:00' },
].map(s => ({ ...s, startMs: s.start ? Date.parse(s.start) : -Infinity }));

const MIME_BY_EXTENSION = {
    jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', gif: 'image/gif', webp: 'image/webp',
    heic: 'image/heic', heif: 'image/heif', avif: 'image/avif', dng: 'image/x-adobe-dng',
    mov: 'video/quicktime', mp4: 'video/mp4', m4v: 'video/x-m4v', '3gp': 'video/3gpp', webm: 'video/webm',
};

const PLAY_ICON = '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M8 5.5v13l11-6.5z"/></svg>';

const state = {
    code: '',
    device: null,
    photos: new Map(),
    ordered: [],
    recentlyAdded: new Map(),   // id → when it was added on this device
    recentlyDeleted: new Map(), // id → when it was deleted on this device
    localPreviews: new Map(),   // id → object URL of an image uploaded from this device
    tiles: new Map(),
    sectionEls: new Map(),
    queue: [],
    activeUploads: 0,
    relay: false, // flips on if this browser can't upload to Drive directly
    wakeLock: null,
    theaterId: null,
    pollTimer: null,
};

const $ = id => document.getElementById(id);

// ─── Small helpers ───────────────────────────────────────────────────────────

function storageGet(key) {
    try { return localStorage.getItem(key); } catch (_e) { return null; }
}

function storageSet(key, value) {
    try { localStorage.setItem(key, value); } catch (_e) { /* storage unavailable */ }
}

function storageRemove(key) {
    try { localStorage.removeItem(key); } catch (_e) { /* storage unavailable */ }
}

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

function toHex(bytes) {
    return Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
}

function randomHex(byteCount) {
    const bytes = new Uint8Array(byteCount);
    crypto.getRandomValues(bytes);
    return toHex(bytes);
}

async function sha256Hex(data) {
    return toHex(new Uint8Array(await crypto.subtle.digest('SHA-256', data)));
}

// A random key identifies this device so guests can delete their own uploads.
// Only its hash is ever sent in a URL.
async function getDevice() {
    if (state.device) return state.device;
    let key = storageGet(DEVICE_KEY);
    if (!/^[a-f0-9]{32}$/.test(key || '')) {
        key = randomHex(16);
        storageSet(DEVICE_KEY, key);
    }
    const hash = (await sha256Hex(new TextEncoder().encode(key))).slice(0, 32);
    state.device = { key, hash };
    return state.device;
}

function formatWhen(ms) {
    return new Intl.DateTimeFormat('en-GB', {
        timeZone: TIME_ZONE, weekday: 'long', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit',
    }).format(new Date(ms));
}

function formatDuration(ms) {
    const total = Math.round(ms / 1000);
    return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
}

function photoLabel(photo) {
    return [
        photo.type === 'video' ? 'Video' : 'Photo',
        photo.takenAt != null ? formatWhen(photo.takenAt) : '',
        photo.uploader ? `shared by ${photo.uploader}` : '',
    ].filter(Boolean).join(', ');
}

function thumbUrl(id, width, attempt) {
    return `${DRIVE_THUMBNAIL_URL}?id=${encodeURIComponent(id)}&sz=w${width}${attempt ? `&v=${attempt}` : ''}`;
}

// Large enough for a sharp full-screen image, bucketed so neighbours share cache.
function theaterWidth() {
    const px = Math.max(window.innerWidth, window.innerHeight) * Math.min(window.devicePixelRatio || 1, 2);
    return Math.min(2400, Math.max(800, Math.ceil(px / 400) * 400));
}

// ─── API ─────────────────────────────────────────────────────────────────────

class ApiError extends Error {
    constructor(code) {
        super(code);
        this.code = code;
    }
}

// Apps Script sometimes fails to hand back a response (a "page not found" on
// its redirect), so retry a few times. Every action is safe to repeat.
async function fetchJson(url, options) {
    for (let attempt = 1; ; attempt++) {
        try {
            const res = await fetch(url, options);
            if (res.ok) return await res.json();
            throw new Error(`http_${res.status}`);
        } catch (err) {
            if (attempt >= 4) throw err;
            await sleep(1000 * 2 ** (attempt - 1));
        }
    }
}

async function apiList() {
    const device = await getDevice();
    const params = new URLSearchParams({ action: 'photosList', code: state.code, device: device.hash });
    return fetchJson(`${SCRIPT_URL}?${params}`);
}

// Sent as text/plain so the browser skips the CORS preflight Apps Script can't answer.
async function apiPost(action, payload) {
    const data = await fetchJson(SCRIPT_URL, {
        method: 'POST',
        body: JSON.stringify({ action, code: state.code, ...payload }),
    });
    if (data.error === 'bad_code') {
        showGate('Please enter the passcode again.');
        throw new ApiError('bad_code');
    }
    if (data.error || data.success === false) throw new ApiError(data.error || 'request_failed');
    return data;
}

// ─── Passcode gate ───────────────────────────────────────────────────────────

function showGate(message) {
    state.code = '';
    storageRemove(CODE_KEY);
    stopPolling();
    closeTheater();
    $('photos-app').classList.add('hidden');
    $('photos-gate').classList.remove('hidden');
    setGateError(message);
}

function setGateError(message) {
    const el = $('gate-error');
    el.textContent = message || '';
    el.classList.toggle('hidden', !message);
}

function showApp() {
    $('photos-gate').classList.add('hidden');
    $('photos-app').classList.remove('hidden');
}

async function unlock(code, fromStorage) {
    const button = $('gate-submit');
    state.code = code.trim();
    button.disabled = true;
    button.textContent = 'Opening…';
    try {
        const data = await apiList();
        if (data.error === 'bad_code') {
            showGate(fromStorage ? '' : "That's not quite right – please try again.");
            return;
        }
        if (!Array.isArray(data.photos)) {
            showGate('Photo sharing is almost ready – please check back soon.');
            return;
        }
        storageSet(CODE_KEY, state.code);
        showApp();
        applyList(data.photos);
        startPolling();
        openFromHash();
    } catch (_err) {
        if (fromStorage) {
            renderStatus("Couldn't load the photos. Please check your connection and press Refresh.");
        } else {
            setGateError("Couldn't connect. Please check your connection and try again.");
        }
    } finally {
        button.disabled = false;
        button.textContent = 'View photos';
    }
}

// ─── Gallery data ────────────────────────────────────────────────────────────

async function refresh() {
    if (!state.code) return;
    const button = $('photos-refresh');
    button.disabled = true;
    try {
        const data = await apiList();
        if (data.error === 'bad_code') {
            showGate('Please enter the passcode again.');
            return;
        }
        if (Array.isArray(data.photos)) applyList(data.photos);
    } catch (_err) {
        if (!state.photos.size) renderStatus("Couldn't load the photos. Please check your connection and press Refresh.");
    } finally {
        button.disabled = false;
    }
}

function startPolling() {
    stopPolling();
    state.pollTimer = setInterval(() => {
        if (document.visibilityState === 'visible') refresh();
    }, POLL_INTERVAL_MS);
}

function stopPolling() {
    clearInterval(state.pollTimer);
    state.pollTimer = null;
}

function applyList(list) {
    const now = Date.now();
    [state.recentlyAdded, state.recentlyDeleted].forEach(map => {
        map.forEach((time, id) => { if (now - time > RECENT_MS) map.delete(id); });
    });

    const next = new Map();
    list.forEach(photo => {
        if (!state.recentlyDeleted.has(photo.id)) next.set(photo.id, photo);
    });
    // The server caches the list briefly, so keep what this device just added.
    state.recentlyAdded.forEach((_time, id) => {
        if (!next.has(id) && state.photos.has(id)) next.set(id, state.photos.get(id));
    });

    state.photos = next;
    renderGallery();
    $('photos-updated').textContent =
        `Updated ${new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
}

function addPhoto(photo) {
    state.photos.set(photo.id, photo);
    state.recentlyAdded.set(photo.id, Date.now());
    renderGallery();
}

function removePhoto(id) {
    state.photos.delete(id);
    state.recentlyDeleted.set(id, Date.now());
    renderGallery();
}

function comparePhotos(a, b) {
    const ta = a.takenAt;
    const tb = b.takenAt;
    if (ta != null && tb != null && ta !== tb) return ta - tb;
    if ((ta == null) !== (tb == null)) return ta == null ? 1 : -1;
    return (a.uploadedAt || 0) - (b.uploadedAt || 0) || a.id.localeCompare(b.id);
}

function sectionIndexFor(photo) {
    if (photo.takenAt == null) return SECTIONS.length - 1;
    for (let i = SECTIONS.length - 1; i >= 0; i--) {
        if (photo.takenAt >= SECTIONS[i].startMs) return i;
    }
    return 0;
}

// ─── Gallery rendering ───────────────────────────────────────────────────────

function renderStatus(message) {
    const el = $('gallery-status');
    el.textContent = message || '';
    el.classList.toggle('hidden', !message);
}

function renderSkeleton() {
    const grid = document.createElement('div');
    grid.className = 'photo-grid gallery-skeleton';
    for (let i = 0; i < 12; i++) {
        const tile = document.createElement('div');
        tile.className = 'photo-tile is-loading';
        grid.appendChild(tile);
    }
    $('gallery').replaceChildren(grid);
}

function renderGallery() {
    const gallery = $('gallery');
    gallery.querySelector('.gallery-skeleton')?.remove();

    state.ordered = [...state.photos.values()].sort(comparePhotos);
    const groups = SECTIONS.map(() => []);
    state.ordered.forEach(photo => groups[sectionIndexFor(photo)].push(photo));

    state.tiles.forEach((tile, id) => {
        if (!state.photos.has(id)) {
            tile.remove();
            state.tiles.delete(id);
        }
    });

    SECTIONS.forEach((section, i) => {
        const el = sectionElement(section);
        const items = groups[i];
        el.root.classList.toggle('hidden', !items.length);
        el.count.textContent = countLabel(items);
        // Only re-order the DOM when this section's contents actually changed.
        const signature = items.map(p => p.id).join(',');
        if (signature !== el.signature) {
            el.grid.replaceChildren(...items.map(tileFor));
            el.signature = signature;
        }
    });

    renderSectionNav(groups);
    renderStatus(state.ordered.length ? '' : 'No photos yet – be the first to share one!');
    updateTheater();
}

function countLabel(items) {
    const videos = items.filter(p => p.type === 'video').length;
    const photos = items.length - videos;
    return [
        photos ? `${photos} ${photos === 1 ? 'photo' : 'photos'}` : '',
        videos ? `${videos} ${videos === 1 ? 'video' : 'videos'}` : '',
    ].filter(Boolean).join(' · ');
}

function sectionElement(section) {
    let el = state.sectionEls.get(section.id);
    if (el) return el;
    const root = document.createElement('section');
    root.className = 'tennis-section photo-section hidden';
    root.id = `section-${section.id}`;
    root.innerHTML = `
        <h2 class="tennis-section-title"></h2>
        <p class="photo-section-note"><span class="photo-section-where"></span> · <span class="photo-section-count"></span></p>
        <div class="photo-grid"></div>
    `;
    root.querySelector('.tennis-section-title').textContent = section.title;
    root.querySelector('.photo-section-where').textContent = section.note;
    el = {
        root,
        grid: root.querySelector('.photo-grid'),
        count: root.querySelector('.photo-section-count'),
        signature: null,
    };
    $('gallery').appendChild(root);
    state.sectionEls.set(section.id, el);
    return el;
}

function renderSectionNav(groups) {
    const nav = $('section-nav');
    const filled = SECTIONS.map((section, i) => ({ section, count: groups[i].length })).filter(g => g.count);
    nav.classList.toggle('hidden', filled.length < 2);
    nav.replaceChildren(...filled.map(({ section, count }) => {
        const chip = document.createElement('button');
        chip.type = 'button';
        chip.className = 'section-chip';
        chip.innerHTML = `<span></span><span class="section-chip-count">${count}</span>`;
        chip.firstChild.textContent = section.title;
        chip.addEventListener('click', () => {
            $(`section-${section.id}`).scrollIntoView({ behavior: 'smooth', block: 'start' });
        });
        return chip;
    }));
}

function tileFor(photo) {
    let tile = state.tiles.get(photo.id);
    if (tile) return tile;

    tile = document.createElement('button');
    tile.type = 'button';
    tile.className = 'photo-tile is-loading';
    tile.setAttribute('aria-label', photoLabel(photo));

    const img = document.createElement('img');
    img.alt = '';
    img.loading = 'lazy';
    img.decoding = 'async';
    img.draggable = false;
    tile.appendChild(img);

    if (photo.type === 'video') {
        const badge = document.createElement('span');
        badge.className = 'photo-tile-badge';
        badge.innerHTML = PLAY_ICON + (photo.duration ? `<span>${formatDuration(photo.duration)}</span>` : '');
        tile.appendChild(badge);
    }

    loadThumb(img, photo, tile);
    tile.addEventListener('click', () => openTheater(photo.id));
    state.tiles.set(photo.id, tile);
    return tile;
}

// Drive needs a little while to generate thumbnails for new uploads, so retry
// with backoff and show "Processing" meanwhile.
function loadThumb(img, photo, tile) {
    let attempt = 0;
    img.onload = () => tile.classList.remove('is-loading', 'is-processing');
    img.onerror = () => {
        attempt++;
        tile.classList.remove('is-loading');
        tile.classList.add('is-processing');
        if (attempt > 8 || !state.tiles.has(photo.id)) return;
        setTimeout(() => { img.src = thumbUrl(photo.id, 480, attempt); }, Math.min(30000, 1500 * 2 ** attempt));
    };
    img.src = state.localPreviews.get(photo.id) || thumbUrl(photo.id, 480);
}

// ─── Theater view ────────────────────────────────────────────────────────────

const theater = $('theater');
const stage = $('theater-stage');
const track = $('theater-track');
let animating = false;
let drag = null;

function theaterOpen() {
    return theater.classList.contains('is-open');
}

function slides() {
    return Array.from(track.children);
}

function currentIndex() {
    return state.ordered.findIndex(p => p.id === state.theaterId);
}

function hashPhotoId() {
    const match = location.hash.match(/^#photo=(.+)$/);
    return match ? decodeURIComponent(match[1]) : null;
}

function openFromHash() {
    const id = hashPhotoId();
    if (!id) return;
    history.replaceState(null, '', location.pathname + location.search);
    if (state.photos.has(id)) openTheater(id);
}

function openTheater(id, { push = true } = {}) {
    if (!state.photos.has(id)) return;
    const wasOpen = theaterOpen();
    state.theaterId = id;
    theater.classList.add('is-open');
    theater.classList.remove('chrome-hidden');
    document.body.classList.add('theater-open');
    slides().forEach(clearSlide);
    setTrack(0, false);
    updateTheater();
    if (!wasOpen) {
        if (push) history.pushState({ photo: id }, '', `#photo=${encodeURIComponent(id)}`);
        $('theater-close').focus({ preventScroll: true });
    }
}

function closeTheater({ fromHistory = false } = {}) {
    if (!theaterOpen()) return;
    const lastId = state.theaterId;
    theater.classList.remove('is-open', 'is-playing');
    document.body.classList.remove('theater-open');
    slides().forEach(clearSlide);
    state.theaterId = null;
    if (!fromHistory && history.state && history.state.photo) history.back();
    const tile = state.tiles.get(lastId);
    if (tile) {
        tile.scrollIntoView({ block: 'nearest' });
        tile.focus({ preventScroll: true });
    }
}

function updateTheater() {
    if (!theaterOpen()) return;
    const index = currentIndex();
    if (index === -1) {
        closeTheater();
        return;
    }
    const list = state.ordered;
    const photo = list[index];
    const [prevSlide, currentSlide, nextSlide] = slides();

    // Stop any video that has moved off-screen.
    [prevSlide, nextSlide].forEach(slide => {
        if (slide.classList.contains('is-playing')) clearSlide(slide);
    });
    fillSlide(prevSlide, list[index - 1]);
    fillSlide(currentSlide, photo);
    fillSlide(nextSlide, list[index + 1]);
    theater.classList.toggle('is-playing', currentSlide.classList.contains('is-playing'));

    $('theater-count').textContent = `${index + 1} / ${list.length}`;
    $('theater-section').textContent = SECTIONS[sectionIndexFor(photo)].title;
    $('theater-meta').textContent = [
        photo.takenAt != null ? formatWhen(photo.takenAt) : '',
        photo.uploader ? `Shared by ${photo.uploader}` : '',
    ].filter(Boolean).join(' · ');
    $('theater-download').href = DRIVE_DOWNLOAD_URL + encodeURIComponent(photo.id);
    $('theater-delete').classList.toggle('hidden', !photo.mine);
    $('theater-prev').disabled = index === 0;
    $('theater-next').disabled = index === list.length - 1;
}

function clearSlide(slide) {
    slide.replaceChildren();
    slide.dataset.id = '';
    slide.classList.remove('is-loading', 'is-processing', 'is-playing');
}

function fillSlide(slide, photo) {
    const id = photo ? photo.id : '';
    if (slide.dataset.id === id) return;
    clearSlide(slide);
    slide.dataset.id = id;
    if (!photo) return;

    const img = document.createElement('img');
    img.className = 'theater-img';
    img.alt = photoLabel(photo);
    img.draggable = false;
    slide.classList.add('is-loading');
    img.onload = () => slide.classList.remove('is-loading', 'is-processing');
    img.onerror = () => {
        slide.classList.remove('is-loading');
        slide.classList.add('is-processing');
    };

    // Show the (usually cached) grid thumbnail straight away, then swap in the sharp one.
    const local = state.localPreviews.get(photo.id);
    img.src = local || thumbUrl(photo.id, 480);
    if (!local) {
        const full = new Image();
        full.onload = () => {
            if (slide.dataset.id === id && !slide.classList.contains('is-playing')) img.src = full.src;
        };
        full.src = thumbUrl(photo.id, theaterWidth());
    }
    slide.appendChild(img);

    const processing = document.createElement('p');
    processing.className = 'theater-processing';
    processing.textContent = 'Still processing – check back in a minute';
    slide.appendChild(processing);

    if (photo.type === 'video') {
        const play = document.createElement('button');
        play.type = 'button';
        play.className = 'theater-play';
        play.setAttribute('aria-label', 'Play video');
        play.innerHTML = PLAY_ICON;
        play.addEventListener('click', () => playVideo(slide, photo));
        slide.appendChild(play);
    }
}

function playVideo(slide, photo) {
    const frame = document.createElement('iframe');
    frame.className = 'theater-video';
    frame.src = `${DRIVE_FILE_URL}${encodeURIComponent(photo.id)}/preview`;
    frame.allow = 'autoplay; fullscreen';
    frame.setAttribute('allowfullscreen', '');
    frame.title = photoLabel(photo);
    slide.replaceChildren(frame);
    slide.classList.remove('is-loading', 'is-processing');
    slide.classList.add('is-playing');
    theater.classList.add('is-playing');
}

function setTrack(offsetX, animate, offsetY = 0) {
    track.style.transition = animate ? 'transform 0.3s cubic-bezier(0.2, 0.8, 0.2, 1)' : 'none';
    track.style.transform = `translate3d(calc(-100% + ${offsetX}px), ${offsetY}px, 0)`;
}

function go(dir) {
    if (animating || !theaterOpen()) return;
    const target = state.ordered[currentIndex() + dir];
    if (!target) {
        setTrack(0, true);
        return;
    }
    animating = true;
    setTrack(-dir * stage.clientWidth, true);

    let finished = false;
    const finish = () => {
        if (finished) return;
        finished = true;
        track.removeEventListener('transitionend', onEnd);
        // Rotate the slides so the one now in view becomes the middle slide.
        const [first, , last] = slides();
        if (dir > 0) track.appendChild(first);
        else track.insertBefore(last, first);
        setTrack(0, false);
        state.theaterId = target.id;
        history.replaceState({ photo: target.id }, '', `#photo=${encodeURIComponent(target.id)}`);
        updateTheater();
        animating = false;
    };
    const onEnd = e => { if (e.target === track) finish(); };
    track.addEventListener('transitionend', onEnd);
    setTimeout(finish, 450);
}

stage.addEventListener('pointerdown', e => {
    if (animating || e.target.closest('button, a, iframe')) return;
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    drag = { id: e.pointerId, x: e.clientX, y: e.clientY, dx: 0, dy: 0, axis: null, t: performance.now() };
    stage.setPointerCapture(e.pointerId);
});

stage.addEventListener('pointermove', e => {
    if (!drag || e.pointerId !== drag.id) return;
    drag.dx = e.clientX - drag.x;
    drag.dy = e.clientY - drag.y;
    if (!drag.axis && Math.hypot(drag.dx, drag.dy) > 10) {
        drag.axis = Math.abs(drag.dx) > Math.abs(drag.dy) ? 'x' : 'y';
    }
    if (drag.axis === 'x') {
        const index = currentIndex();
        const atEdge = (drag.dx > 0 && index === 0) || (drag.dx < 0 && index === state.ordered.length - 1);
        setTrack(atEdge ? drag.dx * 0.25 : drag.dx, false);
    } else if (drag.axis === 'y' && drag.dy > 0) {
        // Swipe down to close.
        setTrack(0, false, drag.dy);
        theater.style.setProperty('--theater-fade', String(Math.max(0.3, 1 - drag.dy / 400)));
    }
});

function endDrag(e) {
    if (!drag || e.pointerId !== drag.id) return;
    const { dx, dy, axis, t } = drag;
    drag = null;
    theater.style.removeProperty('--theater-fade');
    const velocity = Math.abs(dx) / Math.max(1, performance.now() - t);

    if (axis === 'x') {
        if (Math.abs(dx) > stage.clientWidth * 0.18 || (velocity > 0.5 && Math.abs(dx) > 30)) go(dx < 0 ? 1 : -1);
        else setTrack(0, true);
    } else if (axis === 'y') {
        if (dy > 110) closeTheater();
        else setTrack(0, true);
    } else if (e.type === 'pointerup' && e.pointerType !== 'mouse') {
        // A tap hides/shows the captions and buttons.
        theater.classList.toggle('chrome-hidden');
    }
}

stage.addEventListener('pointerup', endDrag);
stage.addEventListener('pointercancel', endDrag);

$('theater-prev').addEventListener('click', () => go(-1));
$('theater-next').addEventListener('click', () => go(1));
$('theater-close').addEventListener('click', () => closeTheater());
$('theater-delete').addEventListener('click', deleteCurrent);

document.addEventListener('keydown', e => {
    if (!theaterOpen()) return;
    if (e.key === 'ArrowRight') go(1);
    else if (e.key === 'ArrowLeft') go(-1);
    else if (e.key === 'Escape') closeTheater();
});

window.addEventListener('popstate', () => {
    const id = hashPhotoId();
    if (id && state.photos.has(id)) openTheater(id, { push: false });
    else closeTheater({ fromHistory: true });
});

async function deleteCurrent() {
    const photo = state.photos.get(state.theaterId);
    if (!photo || !photo.mine) return;
    if (!confirm(`Delete this ${photo.type === 'video' ? 'video' : 'photo'} for everyone?`)) return;

    const button = $('theater-delete');
    button.disabled = true;
    button.textContent = 'Deleting…';
    try {
        const device = await getDevice();
        await apiPost('photosDelete', { fileId: photo.id, deviceKey: device.key });
        const index = currentIndex();
        const neighbour = state.ordered[index + 1] || state.ordered[index - 1];
        if (neighbour) {
            state.theaterId = neighbour.id;
            history.replaceState({ photo: neighbour.id }, '', `#photo=${encodeURIComponent(neighbour.id)}`);
        }
        removePhoto(photo.id); // re-renders, and closes the viewer if nothing is left
    } catch (err) {
        if (err.code !== 'bad_code') alert("Couldn't delete it – please try again.");
    } finally {
        button.disabled = false;
        button.textContent = 'Delete';
    }
}

// ─── Reading capture time + duration ─────────────────────────────────────────

function fileMime(file) {
    if (file.type) return file.type.toLowerCase();
    const ext = (file.name.split('.').pop() || '').toLowerCase();
    return MIME_BY_EXTENSION[ext] || '';
}

function fileKind(mime) {
    if (mime.startsWith('image/')) return 'image';
    if (mime.startsWith('video/')) return 'video';
    return null;
}

async function readMediaInfo(file, kind) {
    try {
        if (kind === 'image') return { takenAt: await imageTakenAt(file), duration: null };
        return await videoInfo(file);
    } catch (_err) {
        return { takenAt: null, duration: null };
    }
}

async function imageTakenAt(file) {
    if (!window.exifr) return null;
    const tags = await window.exifr.parse(file, {
        pick: ['DateTimeOriginal', 'CreateDate', 'OffsetTimeOriginal', 'OffsetTime'],
        reviveValues: false,
    });
    const raw = tags && (tags.DateTimeOriginal || tags.CreateDate);
    const match = String(raw || '').match(/^(\d{4}):(\d{2}):(\d{2})[ T](\d{2}):(\d{2}):(\d{2})/);
    if (!match || match[1] === '0000') return null;
    const offset = String((tags.OffsetTimeOriginal || tags.OffsetTime) || '').trim();
    const zone = /^[+-]\d{2}:\d{2}$/.test(offset) ? offset : DEFAULT_OFFSET;
    return `${match[1]}-${match[2]}-${match[3]}T${match[4]}:${match[5]}:${match[6]}${zone}`;
}

// MP4/MOV: read the capture time and length from the 'moov' box.
async function videoInfo(file) {
    let takenAt = null;
    let duration = null;
    const moov = await findMoov(file);
    if (moov) {
        // iPhones store the local capture time, with its zone, as text.
        const text = new TextDecoder('latin1').decode(moov);
        const apple = text.match(/(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})([+-]\d{2}):?(\d{2})/);
        if (apple) takenAt = `${apple[1]}${apple[2]}:${apple[3]}`;

        const at = text.indexOf('mvhd');
        if (at >= 4 && at + 32 <= moov.length) {
            const view = new DataView(moov.buffer, moov.byteOffset, moov.byteLength);
            const version = view.getUint8(at + 4);
            const created = version === 1 ? Number(view.getBigUint64(at + 8)) : view.getUint32(at + 8);
            const timescale = view.getUint32(at + (version === 1 ? 24 : 16));
            const length = version === 1 ? Number(view.getBigUint64(at + 28)) : view.getUint32(at + 20);
            if (timescale) duration = Math.round((length / timescale) * 1000);
            const MAC_EPOCH_OFFSET = 2082844800; // seconds from 1904 to 1970
            if (!takenAt && created > MAC_EPOCH_OFFSET) {
                const date = new Date((created - MAC_EPOCH_OFFSET) * 1000);
                if (date.getUTCFullYear() >= 2000) takenAt = date.toISOString();
            }
        }
    }
    if (!duration) duration = await videoElementDuration(file);
    return { takenAt, duration };
}

async function findMoov(file) {
    let offset = 0;
    for (let n = 0; n < 64 && offset + 8 <= file.size; n++) {
        const head = new DataView(await file.slice(offset, offset + 16).arrayBuffer());
        let size = head.getUint32(0);
        const type = String.fromCharCode(head.getUint8(4), head.getUint8(5), head.getUint8(6), head.getUint8(7));
        let headerLength = 8;
        if (size === 1) {
            if (head.byteLength < 16) return null;
            size = Number(head.getBigUint64(8));
            headerLength = 16;
        } else if (size === 0) {
            size = file.size - offset;
        }
        if (size < headerLength) return null;
        if (type === 'moov') {
            if (size > 64 * 1024 * 1024) return null;
            return new Uint8Array(await file.slice(offset, offset + size).arrayBuffer());
        }
        offset += size;
    }
    return null;
}

function videoElementDuration(file) {
    return new Promise(resolve => {
        const video = document.createElement('video');
        const url = URL.createObjectURL(file);
        const done = value => {
            clearTimeout(timer);
            URL.revokeObjectURL(url);
            resolve(value);
        };
        const timer = setTimeout(() => done(null), 5000);
        video.preload = 'metadata';
        video.onloadedmetadata = () => done(isFinite(video.duration) ? Math.round(video.duration * 1000) : null);
        video.onerror = () => done(null);
        video.src = url;
    });
}

// Cheap fingerprint (start + end + size) so the same file isn't shared twice.
async function fingerprintFile(file) {
    const MB = 1024 * 1024;
    const parts = [file.slice(0, MB)];
    if (file.size > 2 * MB) parts.push(file.slice(file.size - MB));
    parts.push(String(file.size));
    return (await sha256Hex(await new Blob(parts).arrayBuffer())).slice(0, 32);
}

// ─── Uploading ───────────────────────────────────────────────────────────────

class UploadError extends Error {}

const STATUS_TEXT = {
    queued: 'Waiting…',
    preparing: 'Preparing…',
    saving: 'Finishing…',
    done: 'Shared ✓',
    duplicate: 'Already shared ✓',
};

const ERROR_TEXT = {
    too_large: 'This file is too large',
    too_long: `Videos can be up to ${MAX_VIDEO_LABEL}`,
    unsupported_type: 'Only photos and videos can be shared',
    bad_code: 'Please enter the passcode again',
};

function isPending(item) {
    return ['queued', 'preparing', 'uploading', 'saving'].includes(item.status);
}

function addFiles(fileList) {
    const files = Array.from(fileList || []);
    if (!files.length) return;
    files.forEach(file => {
        const mimeType = fileMime(file);
        const kind = fileKind(mimeType);
        const item = { file, mimeType, kind, status: 'queued', progress: 0, message: '', retryable: true, el: null };
        if (!kind) {
            Object.assign(item, { status: 'error', message: ERROR_TEXT.unsupported_type, retryable: false });
        } else if (file.size > (kind === 'video' ? MAX_VIDEO_BYTES : MAX_IMAGE_BYTES)) {
            Object.assign(item, { status: 'error', message: ERROR_TEXT.too_large, retryable: false });
        }
        state.queue.push(item);
        renderQueueItem(item);
    });
    $('upload-queue').classList.remove('hidden');
    pumpQueue();
    updateQueueSummary();
}

function pumpQueue() {
    const limit = state.relay ? 2 : PARALLEL_UPLOADS;
    while (state.activeUploads < limit) {
        const next = state.queue.find(item => item.status === 'queued');
        if (!next) break;
        state.activeUploads++;
        uploadItem(next).finally(() => {
            state.activeUploads--;
            pumpQueue();
            updateQueueSummary();
        });
    }
}

async function uploadItem(item) {
    const { file } = item;
    try {
        setStatus(item, 'preparing');
        const info = await readMediaInfo(file, item.kind);
        if (item.kind === 'video' && info.duration > (MAX_VIDEO_SECONDS + 1) * 1000) {
            item.retryable = false;
            throw new UploadError(`Videos can be up to ${MAX_VIDEO_LABEL} (this one is ${formatDuration(info.duration)})`);
        }
        const [fingerprint, device] = await Promise.all([fingerprintFile(file), getDevice()]);

        const start = await apiPost('photosStart', {
            name: file.name,
            mimeType: item.mimeType,
            size: file.size,
            takenAt: info.takenAt,
            duration: info.duration,
            uploader: $('photos-name').value.trim().slice(0, 60),
            fingerprint,
            deviceKey: device.key,
            origin: location.origin,
        });
        if (start.duplicate) {
            addPhoto(start.photo);
            setStatus(item, 'duplicate');
            return;
        }

        setStatus(item, 'uploading');
        const onProgress = fraction => setProgress(item, fraction);
        let fileId = null;
        let resume = false;
        if (start.direct && !state.relay) {
            try {
                fileId = await putDirect(start.uploadUrl, file, item.mimeType, onProgress);
            } catch (err) {
                if (!err.network) throw err;
                state.relay = true; // relay this and all later uploads through the script
                resume = true;
            }
        }
        if (!fileId) fileId = await putRelay(start.uploadUrl, file, onProgress, resume);

        setStatus(item, 'saving');
        if (item.kind === 'image' && PREVIEWABLE_IMAGE.test(item.mimeType)) {
            state.localPreviews.set(fileId, URL.createObjectURL(file));
        }
        try {
            const done = await apiPost('photosDone', { fileId, deviceKey: device.key });
            if (done.photo) addPhoto(done.photo);
        } catch (_err) {
            setTimeout(refresh, 5000); // the upload itself succeeded; the list will catch up
        }
        setStatus(item, 'done');
    } catch (err) {
        if (['too_large', 'too_long', 'unsupported_type'].includes(err.code)) item.retryable = false;
        console.error('Upload failed:', file.name, err);
        let message = err instanceof UploadError ? err.message : ERROR_TEXT[err.code];
        if (!message) {
            // An ApiError means the script answered with an error, so it isn't the guest's connection.
            message = err instanceof ApiError
                ? "Couldn't save this one right now – please retry in a moment"
                : 'Upload failed – check your connection and retry';
        }
        setStatus(item, 'error', message);
    }
}

// Straight to Drive, with real progress. Fails with err.network if the browser
// can't reach the upload URL (e.g. CORS), in which case we fall back to relaying.
function putDirect(url, file, mimeType, onProgress) {
    return new Promise((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhr.open('PUT', url);
        xhr.setRequestHeader('Content-Type', mimeType);
        xhr.upload.onprogress = e => { if (e.lengthComputable) onProgress(e.loaded / e.total); };
        xhr.onload = () => {
            if (xhr.status === 200 || xhr.status === 201) {
                try {
                    resolve(JSON.parse(xhr.responseText).id);
                } catch (_err) {
                    reject(Object.assign(new Error('bad_response'), { network: true }));
                }
            } else {
                reject(new Error(`upload_failed_${xhr.status}`));
            }
        };
        xhr.onerror = () => reject(Object.assign(new Error('network'), { network: true }));
        xhr.send(file);
    });
}

// Through the Apps Script in 4MB chunks. `resume` first asks Drive how much it has.
async function putRelay(uploadUrl, file, onProgress, resume) {
    const total = file.size;
    const status = () => apiPost('photosChunk', { uploadUrl, total });
    let start = 0;
    let failures = 0;

    if (resume) {
        const result = await withRetry(status);
        if (result.done) return result.fileId;
        start = result.next;
    }

    for (;;) {
        const end = Math.min(start + RELAY_CHUNK_BYTES, total);
        let result;
        try {
            const b64 = await blobToBase64(file.slice(start, end));
            result = await apiPost('photosChunk', { uploadUrl, total, start, b64 });
            failures = 0;
        } catch (err) {
            if (err.code === 'bad_code' || err.code === 'bad_upload_url' || ++failures > 5) throw err;
            await sleep(1000 * 2 ** failures);
            result = await withRetry(status); // find out what actually arrived
        }
        if (result.done) {
            onProgress(1);
            return result.fileId;
        }
        start = result.next;
        onProgress(start / total);
    }
}

async function withRetry(fn, attempts = 4) {
    for (let i = 1; ; i++) {
        try {
            return await fn();
        } catch (err) {
            if (i >= attempts || err.code === 'bad_code') throw err;
            await sleep(1000 * 2 ** i);
        }
    }
}

function blobToBase64(blob) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result).split(',')[1] || '');
        reader.onerror = () => reject(reader.error);
        reader.readAsDataURL(blob);
    });
}

// ─── Upload queue UI ─────────────────────────────────────────────────────────

function setStatus(item, status, message = '') {
    item.status = status;
    item.message = message;
    if (status === 'uploading') item.progress = 0;
    renderQueueItem(item);
    updateQueueSummary();
}

function setProgress(item, fraction) {
    item.progress = Math.max(0, Math.min(1, fraction));
    renderQueueItem(item);
}

function renderQueueItem(item) {
    if (!item.el) {
        const li = document.createElement('li');
        li.className = 'upload-item';
        li.innerHTML = `
            <span class="upload-item-thumb"></span>
            <span class="upload-item-body">
                <span class="upload-item-name"></span>
                <span class="upload-item-status"></span>
                <span class="upload-item-bar"><span></span></span>
            </span>
            <button type="button" class="tennis-refresh-btn upload-item-retry hidden">Retry</button>
        `;
        li.querySelector('.upload-item-name').textContent = item.file.name;
        const thumb = li.querySelector('.upload-item-thumb');
        if (item.kind === 'image' && PREVIEWABLE_IMAGE.test(item.mimeType)) {
            item.previewUrl = URL.createObjectURL(item.file);
            thumb.innerHTML = '<img alt="">';
            thumb.firstChild.src = item.previewUrl;
        } else if (item.kind === 'video') {
            thumb.innerHTML = PLAY_ICON;
            thumb.classList.add('is-video');
        }
        li.querySelector('.upload-item-retry').addEventListener('click', () => {
            setStatus(item, 'queued');
            pumpQueue();
        });
        $('upload-list').appendChild(li);
        item.el = li;
    }

    const li = item.el;
    li.className = `upload-item is-${item.status}`;
    li.querySelector('.upload-item-status').textContent = item.status === 'uploading'
        ? `Uploading ${Math.round(item.progress * 100)}%`
        : (item.message || STATUS_TEXT[item.status] || '');
    li.querySelector('.upload-item-bar span').style.width = `${Math.round(item.progress * 100)}%`;
    li.querySelector('.upload-item-retry').classList.toggle('hidden', !(item.status === 'error' && item.retryable));
}

function updateQueueSummary() {
    const total = state.queue.length;
    const pending = state.queue.filter(isPending).length;
    const shared = state.queue.filter(item => item.status === 'done' || item.status === 'duplicate').length;
    const failed = state.queue.filter(item => item.status === 'error').length;

    let text;
    if (pending) text = `Sharing ${total - pending + 1} of ${total}… please keep this page open`;
    else if (failed) text = `${shared} shared · ${failed} couldn't be uploaded`;
    else text = `${shared} shared – thank you!`;
    $('upload-summary').textContent = total ? text : '';
    $('upload-clear').classList.toggle('hidden', !total || pending > 0);
    syncWakeLock(pending > 0);
}

function clearFinished() {
    state.queue = state.queue.filter(item => {
        if (isPending(item)) return true;
        if (item.previewUrl) URL.revokeObjectURL(item.previewUrl);
        item.el.remove();
        return false;
    });
    $('upload-queue').classList.toggle('hidden', !state.queue.length);
    updateQueueSummary();
}

// Keep phones from sleeping (and pausing uploads) while files are sending.
async function syncWakeLock(active) {
    if (!('wakeLock' in navigator)) return;
    try {
        if (active && !state.wakeLock && document.visibilityState === 'visible') {
            state.wakeLock = await navigator.wakeLock.request('screen');
            state.wakeLock.addEventListener('release', () => { state.wakeLock = null; });
        } else if (!active && state.wakeLock) {
            await state.wakeLock.release();
            state.wakeLock = null;
        }
    } catch (_err) {
        // Not allowed right now (e.g. low battery); uploads continue regardless.
    }
}

// ─── Drag & drop ─────────────────────────────────────────────────────────────

let dragDepth = 0;

function draggingFiles(e) {
    return Array.from((e.dataTransfer && e.dataTransfer.types) || []).includes('Files');
}

function appVisible() {
    return !$('photos-app').classList.contains('hidden') && !theaterOpen();
}

function setDropOverlay(visible) {
    $('drop-overlay').classList.toggle('is-visible', visible);
    $('dropzone').classList.toggle('is-dragover', visible);
}

window.addEventListener('dragenter', e => {
    if (!draggingFiles(e)) return;
    e.preventDefault();
    dragDepth++;
    if (appVisible()) setDropOverlay(true);
});

window.addEventListener('dragover', e => {
    if (!draggingFiles(e)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = appVisible() ? 'copy' : 'none';
});

window.addEventListener('dragleave', e => {
    if (!draggingFiles(e)) return;
    dragDepth = Math.max(0, dragDepth - 1);
    if (!dragDepth) setDropOverlay(false);
});

window.addEventListener('drop', e => {
    if (!draggingFiles(e)) return;
    e.preventDefault();
    dragDepth = 0;
    setDropOverlay(false);
    if (appVisible()) addFiles(e.dataTransfer.files);
});

// ─── Init ────────────────────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', () => {
    $('gate-form').addEventListener('submit', e => {
        e.preventDefault();
        const code = $('gate-input').value;
        if (!code.trim()) {
            setGateError('Please enter the passcode.');
            return;
        }
        setGateError('');
        unlock(code, false);
    });

    const nameInput = $('photos-name');
    nameInput.value = storageGet(NAME_KEY) || '';
    nameInput.addEventListener('input', () => storageSet(NAME_KEY, nameInput.value.trim()));

    $('photo-input').addEventListener('change', e => {
        addFiles(e.target.files);
        e.target.value = '';
    });
    $('dropzone').addEventListener('click', e => {
        if (!e.target.closest('label, input')) $('photo-input').click();
    });
    $('upload-clear').addEventListener('click', clearFinished);
    $('photos-refresh').addEventListener('click', refresh);

    window.addEventListener('beforeunload', e => {
        if (state.queue.some(isPending)) {
            e.preventDefault();
            e.returnValue = '';
        }
    });
    document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') syncWakeLock(state.queue.some(isPending));
    });

    const saved = storageGet(CODE_KEY);
    if (saved) {
        showApp();
        renderSkeleton();
        unlock(saved, true);
    } else {
        showGate('');
    }
});
