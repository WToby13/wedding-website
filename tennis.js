// Google Apps Script web app URL (shared with the RSVP backend)
const SCRIPT_URL = 'https://script.google.com/macros/s/AKfycbxFFDWWzp2ryFCGL6D6TyKVXIRTkHUqZkLiEGaSgGtbkq0RHIvnEGAN5ziOM0wuZOmO6g/exec';

const POLL_INTERVAL_MS = 30000;
const STAR_KEY = 'tennisStarred';
const FOCUS_KEY = 'tennisFocus';

const state = {
    teams: [],
    matches: [],
    standings: [],
    starred: loadStarred(),
    focusOnly: localStorage.getItem(FOCUS_KEY) === '1',
};

// ─── Starring ─────────────────────────────────────────────────────────────────

function loadStarred() {
    try {
        return new Set(JSON.parse(localStorage.getItem(STAR_KEY) || '[]').map(String));
    } catch (_e) {
        return new Set();
    }
}

function saveStarred() {
    localStorage.setItem(STAR_KEY, JSON.stringify([...state.starred]));
}

function isStarred(num) {
    return state.starred.has(String(num));
}

function toggleStar(num) {
    num = String(num);
    if (state.starred.has(num)) state.starred.delete(num);
    else state.starred.add(num);
    saveStarred();
    // If nothing is starred anymore, drop out of focus mode.
    if (!state.starred.size && state.focusOnly) setFocus(false);
    else render();
}

function setFocus(on) {
    state.focusOnly = on;
    localStorage.setItem(FOCUS_KEY, on ? '1' : '0');
    render();
}

function clearStars() {
    state.starred.clear();
    saveStarred();
    setFocus(false);
}

// Focus is only active when it's on AND there's at least one starred team.
function focusActive() {
    return state.focusOnly && state.starred.size > 0;
}

// ─── Data ───────────────────────────────────────────────────────────────────

async function loadTennis() {
    try {
        const res = await fetch(`${SCRIPT_URL}?action=getTennis`);
        const data = await res.json();
        state.teams = data.teams || [];
        state.matches = data.matches || [];
        state.standings = data.standings || [];
        render();
        setUpdatedLabel(new Date());
    } catch (_err) {
        if (!state.standings.length && !state.matches.length) {
            renderError();
        }
    }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = (str === null || str === undefined) ? '' : str;
    return div.innerHTML;
}

function teamLabel(number) {
    if (!String(number || '').trim()) return 'TBD';
    const t = state.teams.find(x => String(x.team) === String(number));
    if (!t) return `Team ${escapeHtml(number)}`;
    const players = [t.player1, t.player2].filter(Boolean).join(' & ');
    return players ? escapeHtml(players) : `Team ${escapeHtml(number)}`;
}

function podLabel(key) {
    return key ? `Pod ${escapeHtml(key)}` : 'Standings';
}

function hasScore(m) {
    return m.scoreA !== '' && m.scoreA !== null && m.scoreA !== undefined &&
           m.scoreB !== '' && m.scoreB !== null && m.scoreB !== undefined;
}

function matchHasStar(m) {
    return isStarred(m.teamA) || isStarred(m.teamB);
}

function starButtonHtml(num) {
    const on = isStarred(num);
    return `<button class="star-btn ${on ? 'starred' : ''}" onclick="toggleStar('${escapeHtml(num)}')"
             aria-label="${on ? 'Unfollow' : 'Follow'} team ${escapeHtml(num)}" title="${on ? 'Following' : 'Follow this team'}">${on ? '★' : '☆'}</button>`;
}

function setUpdatedLabel(date) {
    const el = document.getElementById('tennis-updated');
    if (!el) return;
    const time = date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    el.textContent = `Last updated ${time}`;
}

// ─── Rendering ────────────────────────────────────────────────────────────────

function render() {
    renderFocusBar();
    renderStandings();
    renderSchedule();
    renderTeams();
}

function renderFocusBar() {
    const bar = document.getElementById('focus-bar');
    const count = state.starred.size;
    const active = focusActive();
    bar.innerHTML = `
        <div class="focus-toggle" role="group" aria-label="Focus filter">
            <button class="focus-opt ${!active ? 'focus-opt-active' : ''}" onclick="setFocus(false)">All teams</button>
            <button class="focus-opt ${active ? 'focus-opt-active' : ''} ${count ? '' : 'focus-opt-disabled'}"
                    ${count ? '' : 'disabled'} onclick="setFocus(true)">★ Starred${count ? ` (${count})` : ''}</button>
        </div>
        ${count
            ? `<button class="focus-clear" onclick="clearStars()">Clear stars</button>`
            : `<span class="focus-hint">Tap ☆ next to a team to follow it</span>`}
    `;
}

function standingsRowHtml(s) {
    const finalist = s.rank <= 2;
    const starred = isStarred(s.team);
    const players = [s.player1, s.player2].filter(Boolean).join(' & ');
    return `
        <tr class="${finalist ? 'standings-finalist' : ''} ${starred ? 'standings-starred' : ''}">
            <td class="col-star">${starButtonHtml(s.team)}</td>
            <td class="col-rank">${finalist ? `<span class="rank-badge">${s.rank}</span>` : s.rank}</td>
            <td class="col-team">
                <span class="standings-team-name">${escapeHtml(players || ('Team ' + s.team))}</span>
                <span class="standings-team-num">Team ${escapeHtml(s.team)}</span>
            </td>
            <td>${s.played}</td>
            <td>${s.won}</td>
            <td>${s.lost}</td>
            <td class="col-diff">${s.diff > 0 ? '+' + s.diff : s.diff}</td>
        </tr>
    `;
}

function standingsTableHtml(list) {
    return `
        <table class="standings-table">
            <thead>
                <tr>
                    <th class="col-star" aria-label="Follow"></th>
                    <th class="col-rank">#</th>
                    <th class="col-team">Team</th>
                    <th title="Played">P</th>
                    <th title="Won">W</th>
                    <th title="Lost">L</th>
                    <th class="col-diff" title="Point differential">Diff</th>
                </tr>
            </thead>
            <tbody>${list.map(standingsRowHtml).join('')}</tbody>
        </table>
    `;
}

function renderStandings() {
    const container = document.getElementById('standings-container');
    if (!state.standings.length) {
        container.innerHTML = `<p class="tennis-empty">Standings will appear here once the first results are in.</p>`;
        return;
    }

    // Group by pod, preserving a sorted pod order.
    const groups = {};
    const order = [];
    state.standings.forEach(s => {
        const key = s.pod || '';
        if (!(key in groups)) { groups[key] = []; order.push(key); }
        groups[key].push(s);
    });
    order.sort();

    const multiPod = order.length > 1 || (order.length === 1 && order[0] !== '');

    if (!multiPod) {
        container.innerHTML = `
            <div class="standings-card">
                ${standingsTableHtml(groups[order[0]])}
                <p class="standings-note">Top two teams (highlighted) meet in the final.</p>
            </div>`;
        return;
    }

    const cards = order.map(key => `
        <div class="standings-pod">
            <h3 class="standings-pod-title">${podLabel(key)}</h3>
            <div class="standings-card">${standingsTableHtml(groups[key])}</div>
        </div>
    `).join('');

    container.innerHTML = `
        <div class="standings-pods">${cards}</div>
        <p class="standings-note">Top two in each pod (highlighted) meet in that pod's final.</p>
    `;
}

function renderSchedule() {
    const container = document.getElementById('schedule-container');
    if (!state.matches.length) {
        container.innerHTML = `<p class="tennis-empty">The schedule will be published here soon.</p>`;
        return;
    }

    const focus = focusActive();
    const visible = focus ? state.matches.filter(matchHasStar) : state.matches;

    if (focus && !visible.length) {
        container.innerHTML = `<p class="tennis-empty">None of your starred teams have matches yet.</p>`;
        return;
    }

    // Group by round.
    const groups = {};
    visible.forEach(m => {
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
        const time = list.find(m => m.time)?.time;
        const isFinal = list.some(m => /final/i.test(m.note || ''));
        const roundTitle = key === 'Unscheduled' ? 'Unscheduled' : `Round ${escapeHtml(key)}`;

        const matchRows = list.map(m => {
            const noTeams = !String(m.teamA || '').trim() && !String(m.teamB || '').trim();
            if (noTeams) {
                return `
                    <div class="match-row match-note-row">
                        <span class="match-court">${m.court ? 'Court ' + escapeHtml(m.court) : ''}</span>
                        <span class="match-note-label">${escapeHtml(m.note || 'To be decided')}</span>
                    </div>
                `;
            }
            const played = hasScore(m);
            const sa = Number(m.scoreA), sb = Number(m.scoreB);
            const aWin = played && sa > sb;
            const bWin = played && sb > sa;
            const starA = isStarred(m.teamA), starB = isStarred(m.teamB);
            return `
                <div class="match-row ${played ? 'match-played' : 'match-upcoming'} ${matchHasStar(m) ? 'match-starred' : ''}">
                    <span class="match-court">${m.court ? 'Court ' + escapeHtml(m.court) : ''}</span>
                    <span class="match-team ${aWin ? 'match-winner' : ''}">${starA ? '<span class="match-star">★</span>' : ''}${teamLabel(m.teamA)}</span>
                    <span class="match-score">${played ? `${escapeHtml(m.scoreA)} – ${escapeHtml(m.scoreB)}` : 'vs'}</span>
                    <span class="match-team match-team-b ${bWin ? 'match-winner' : ''}">${teamLabel(m.teamB)}${starB ? '<span class="match-star">★</span>' : ''}</span>
                </div>
            `;
        }).join('');

        return `
            <div class="round-card ${isFinal ? 'round-final' : ''}">
                <div class="round-header">
                    <h3 class="round-title">${roundTitle}${isFinal ? ' <span class="final-badge">Final</span>' : ''}</h3>
                    ${time ? `<span class="round-time">${escapeHtml(time)}</span>` : ''}
                </div>
                <div class="round-matches">${matchRows}</div>
            </div>
        `;
    }).join('');
}

function renderTeams() {
    const container = document.getElementById('teams-container');
    if (!state.teams.length) {
        container.innerHTML = `<p class="tennis-empty">Teams will be listed here soon.</p>`;
        return;
    }

    const focus = focusActive();
    const visible = focus ? state.teams.filter(t => isStarred(t.team)) : state.teams;

    const cards = visible.map(t => {
        const players = [t.player1, t.player2].filter(Boolean).join(' & ');
        return `
            <div class="team-chip ${isStarred(t.team) ? 'team-chip-starred' : ''}">
                ${starButtonHtml(t.team)}
                <span class="team-chip-num">${escapeHtml(t.team)}</span>
                <span class="team-chip-players">${escapeHtml(players || '—')}</span>
            </div>
        `;
    }).join('');

    container.innerHTML = `<div class="teams-grid">${cards}</div>`;
}

function renderError() {
    document.getElementById('standings-container').innerHTML =
        `<p class="tennis-empty">Couldn't load the tournament data. Please try refreshing.</p>`;
    document.getElementById('schedule-container').innerHTML = '';
    document.getElementById('teams-container').innerHTML = '';
}

function renderSkeletons() {
    const skel = `
        <div class="standings-card">
            <div class="skeleton-line" style="height:22px;width:40%;margin-bottom:1rem;"></div>
            <div class="skeleton-line" style="height:16px;width:100%;margin-bottom:0.6rem;"></div>
            <div class="skeleton-line" style="height:16px;width:100%;margin-bottom:0.6rem;"></div>
            <div class="skeleton-line" style="height:16px;width:100%;"></div>
        </div>`;
    document.getElementById('standings-container').innerHTML = skel;
    document.getElementById('schedule-container').innerHTML = skel;
}

// ─── Init ─────────────────────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', () => {
    renderFocusBar();
    renderSkeletons();
    loadTennis();

    document.getElementById('tennis-refresh').addEventListener('click', () => {
        loadTennis();
    });

    setInterval(() => {
        if (document.visibilityState === 'visible') loadTennis();
    }, POLL_INTERVAL_MS);
});
