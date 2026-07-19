// Google Apps Script web app URL (shared with the RSVP backend)
const SCRIPT_URL = 'https://script.google.com/macros/s/AKfycbxFFDWWzp2ryFCGL6D6TyKVXIRTkHUqZkLiEGaSgGtbkq0RHIvnEGAN5ziOM0wuZOmO6g/exec';

const state = {
    teams: [],
    matches: [],
};

// ─── Data ───────────────────────────────────────────────────────────────────

async function loadTennis() {
    try {
        const res = await fetch(`${SCRIPT_URL}?action=getTennis`);
        const data = await res.json();
        state.teams = data.teams || [];
        state.matches = data.matches || [];
        renderTeamOptions();
        renderMatches();
        setUpdatedLabel(new Date());
    } catch (_err) {
        document.getElementById('admin-matches').innerHTML =
            `<p class="tennis-empty">Couldn't load data. Check your connection and press Reload.</p>`;
    }
}

// Fire-and-forget write (no-cors means we can't read the response, so the
// client owns the matchId and updates local state optimistically).
function postMatch(payload) {
    return fetch(SCRIPT_URL, {
        method: 'POST',
        mode: 'no-cors',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
    });
}

function newMatchId() {
    return 'm_' + Math.random().toString(36).slice(2, 8) + Date.now().toString(36).slice(-3);
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = (str === null || str === undefined) ? '' : str;
    return div.innerHTML;
}

function teamOptionsHtml(selected) {
    const blank = `<option value="">—</option>`;
    const opts = state.teams.map(t => {
        const players = [t.player1, t.player2].filter(Boolean).join(' & ');
        const label = `${t.team}${players ? ' — ' + players : ''}`;
        const sel = String(selected) === String(t.team) ? ' selected' : '';
        return `<option value="${escapeHtml(t.team)}"${sel}>${escapeHtml(label)}</option>`;
    }).join('');
    return blank + opts;
}

function teamName(number) {
    if (!String(number || '').trim()) return 'TBD';
    const t = state.teams.find(x => String(x.team) === String(number));
    if (!t) return `Team ${escapeHtml(number)}`;
    const players = [t.player1, t.player2].filter(Boolean).join(' & ');
    return players ? escapeHtml(players) : `Team ${escapeHtml(number)}`;
}

function setUpdatedLabel(date) {
    const el = document.getElementById('tennis-updated');
    if (!el) return;
    el.textContent = `Loaded ${date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
}

function getMatch(matchId) {
    return state.matches.find(m => m.matchId === matchId);
}

// ─── Rendering ────────────────────────────────────────────────────────────────

function renderTeamOptions() {
    document.getElementById('add-teamA').innerHTML = teamOptionsHtml('');
    document.getElementById('add-teamB').innerHTML = teamOptionsHtml('');
}

function renderMatches() {
    const container = document.getElementById('admin-matches');
    if (!state.matches.length) {
        container.innerHTML = `<p class="tennis-empty">No matches yet. Add the schedule in the Google Sheet, or use “Add or adjust the schedule” below.</p>`;
        return;
    }

    // Group by round.
    const groups = {};
    state.matches.forEach(m => {
        const key = (m.round === '' || m.round === null || m.round === undefined) ? 'Unscheduled' : String(m.round);
        (groups[key] = groups[key] || []).push(m);
    });
    const roundKeys = Object.keys(groups).sort((a, b) => {
        const na = parseFloat(a), nb = parseFloat(b);
        if (isNaN(na) && isNaN(nb)) return a.localeCompare(b);
        if (isNaN(na)) return 1;
        if (isNaN(nb)) return -1;
        return na - nb;
    });

    container.innerHTML = roundKeys.map(key => {
        const list = groups[key].slice().sort((a, b) => {
            const ca = parseFloat(a.court), cb = parseFloat(b.court);
            if (isNaN(ca) || isNaN(cb)) return 0;
            return ca - cb;
        });
        const cards = list.map(m => matchCardHtml(m)).join('');
        const title = key === 'Unscheduled' ? 'Unscheduled' : `Round ${escapeHtml(key)}`;
        return `<div class="admin-round"><h3 class="admin-round-title">${title}</h3>${cards}</div>`;
    }).join('');
}

function matchCardHtml(m) {
    const played = m.scoreA !== '' && m.scoreA !== null && m.scoreA !== undefined &&
                   m.scoreB !== '' && m.scoreB !== null && m.scoreB !== undefined;
    const sa = Number(m.scoreA), sb = Number(m.scoreB);
    const aWin = played && sa > sb;
    const bWin = played && sb > sa;

    const meta = [
        m.court ? `Court ${escapeHtml(m.court)}` : '',
        m.time ? escapeHtml(m.time) : '',
    ].filter(Boolean).join(' · ');

    return `
        <div class="admin-match-card ${played ? 'admin-match-done' : ''}" data-match-id="${escapeHtml(m.matchId)}">
            <div class="admin-match-meta">
                <span>${meta || '&nbsp;'}</span>
                ${m.note ? `<span class="amm-note">${escapeHtml(m.note)}</span>` : ''}
            </div>

            <div class="admin-score-row">
                <span class="asr-team asr-team-a ${aWin ? 'asr-winner' : ''}">${teamName(m.teamA)}</span>
                <input type="number" class="fld-scoreA asr-score" inputmode="numeric" value="${escapeHtml(m.scoreA)}" aria-label="Score for ${teamName(m.teamA)}">
                <span class="asr-dash">–</span>
                <input type="number" class="fld-scoreB asr-score" inputmode="numeric" value="${escapeHtml(m.scoreB)}" aria-label="Score for ${teamName(m.teamB)}">
                <span class="asr-team asr-team-b ${bWin ? 'asr-winner' : ''}">${teamName(m.teamB)}</span>
            </div>

            <div class="admin-match-actions">
                <button type="button" class="admin-save-btn" onclick="saveScore('${escapeHtml(m.matchId)}')">Save score</button>
                <button type="button" class="admin-detail-toggle" onclick="toggleDetails('${escapeHtml(m.matchId)}')">Edit details</button>
            </div>

            <div class="admin-match-details hidden">
                <div class="admin-match-line">
                    <div class="admin-field admin-field-sm">
                        <label>Round</label>
                        <input type="text" class="fld-round" value="${escapeHtml(m.round)}">
                    </div>
                    <div class="admin-field">
                        <label>Time</label>
                        <input type="text" class="fld-time" value="${escapeHtml(m.time)}">
                    </div>
                    <div class="admin-field admin-field-sm">
                        <label>Court</label>
                        <input type="text" class="fld-court" value="${escapeHtml(m.court)}">
                    </div>
                    <div class="admin-field">
                        <label>Note</label>
                        <input type="text" class="fld-note" value="${escapeHtml(m.note)}" placeholder="e.g. Final">
                    </div>
                </div>
                <div class="admin-match-line">
                    <div class="admin-field admin-field-grow">
                        <label>Team A</label>
                        <select class="fld-teamA">${teamOptionsHtml(m.teamA)}</select>
                    </div>
                    <div class="admin-field admin-field-grow">
                        <label>Team B</label>
                        <select class="fld-teamB">${teamOptionsHtml(m.teamB)}</select>
                    </div>
                </div>
                <div class="admin-details-actions">
                    <button type="button" class="admin-save-btn admin-save-sm" onclick="saveDetails('${escapeHtml(m.matchId)}')">Save changes</button>
                    <button type="button" class="admin-delete-btn" onclick="removeMatch('${escapeHtml(m.matchId)}')">Delete match</button>
                </div>
            </div>
        </div>
    `;
}

// ─── Actions ──────────────────────────────────────────────────────────────────

function toggleDetails(matchId) {
    const card = document.querySelector(`.admin-match-card[data-match-id="${matchId}"]`);
    if (!card) return;
    card.querySelector('.admin-match-details').classList.toggle('hidden');
}

// Save just the scores (primary day-of action), keeping the rest of the match intact.
function saveScore(matchId) {
    const card = document.querySelector(`.admin-match-card[data-match-id="${matchId}"]`);
    const existing = getMatch(matchId);
    if (!card || !existing) return;

    const scoreA = card.querySelector('.fld-scoreA').value.trim();
    const scoreB = card.querySelector('.fld-scoreB').value.trim();
    const btn = card.querySelector('.admin-save-btn');

    const updated = { ...existing, scoreA, scoreB };
    postMatch({ action: 'saveMatch', ...updated });
    Object.assign(existing, updated);

    flashButton(btn, 'Saved ✓');
    renderMatches();
}

// Save all editable fields (schedule adjustments).
function saveDetails(matchId) {
    const card = document.querySelector(`.admin-match-card[data-match-id="${matchId}"]`);
    const existing = getMatch(matchId);
    if (!card || !existing) return;

    const updated = {
        ...existing,
        round: card.querySelector('.fld-round').value.trim(),
        time: card.querySelector('.fld-time').value.trim(),
        court: card.querySelector('.fld-court').value.trim(),
        note: card.querySelector('.fld-note').value.trim(),
        teamA: card.querySelector('.fld-teamA').value,
        teamB: card.querySelector('.fld-teamB').value,
    };
    postMatch({ action: 'saveMatch', ...updated });
    Object.assign(existing, updated);
    renderMatches();
}

function removeMatch(matchId) {
    if (!confirm('Delete this match?')) return;
    postMatch({ action: 'deleteMatch', matchId });
    state.matches = state.matches.filter(m => m.matchId !== matchId);
    renderMatches();
}

function addMatch(e) {
    e.preventDefault();
    const teamA = document.getElementById('add-teamA').value;
    const teamB = document.getElementById('add-teamB').value;
    if (!teamA || !teamB) {
        alert('Please pick both teams.');
        return;
    }
    if (teamA === teamB) {
        alert('A team can\'t play itself — pick two different teams.');
        return;
    }

    const match = {
        matchId: newMatchId(),
        round: document.getElementById('add-round').value.trim(),
        time: document.getElementById('add-time').value.trim(),
        court: document.getElementById('add-court').value.trim(),
        teamA, teamB,
        scoreA: '',
        scoreB: '',
        note: document.getElementById('add-note').value.trim(),
    };

    postMatch({ action: 'saveMatch', ...match });
    state.matches.push(match);
    renderMatches();

    // Reset the quick-add fields (keep round/time/court for fast entry of the next match).
    document.getElementById('add-teamA').value = '';
    document.getElementById('add-teamB').value = '';
    document.getElementById('add-note').value = '';
}

function flashButton(btn, text) {
    if (!btn) return;
    const original = btn.textContent;
    btn.textContent = text;
    setTimeout(() => { btn.textContent = original; }, 1200);
}

// ─── Init ─────────────────────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', () => {
    document.getElementById('admin-matches').innerHTML =
        `<p class="tennis-empty">Loading…</p>`;
    loadTennis();
    document.getElementById('add-match-form').addEventListener('submit', addMatch);
    document.getElementById('tennis-refresh').addEventListener('click', loadTennis);
});
