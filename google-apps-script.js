/**
 * Google Apps Script for the wedding website.
 * Handles the RSVP form AND the tennis tournament pages.
 *
 * RSVP:   doGet(action=getByEmail), doPost(action=create|update)
 * Tennis: doGet(action=getTennis), doPost(action=saveMatch|deleteMatch)
 *         (see the "Tennis tournament" section below for the two tabs used)
 *
 * Sheet columns (in order):
 *   1. Guest Name
 *   2. Joining
 *   3. Dinner Selection
 *   4. Dietary considerations
 *   5. Tennis Tournament
 *   6. Sunday Sunbeds
 *   7. Notes
 *   8. Timestamp
 *   9. Email
 *
 * DEPLOY INSTRUCTIONS:
 *   1. Paste this file into https://script.google.com/
 *   2. Click Deploy → New deployment → Web app
 *   3. Execute as: Me | Who has access: Anyone
 *   4. Copy the web app URL and update SCRIPT_URL in rsvp.js
 *      Current URL: https://script.google.com/macros/s/AKfycbzgc9KXhNbx8Hwm3aZwukMmgbJsGIdPVTb-l0Bc3mPnMNBTw-KdQqmJeUPmNxtasVvMOw/exec
 *   5. Every time you change this script, create a NEW deployment version.
 */

const SPREADSHEET_ID = '1FGu1xPLQZQy4zc4Yr-SKBhyTmTc3RBynhZR7dOVT-iE';
const SHEET_NAME = 'RSVP Responses';

// Column indices (0-based within the data array)
const COL = {
    GUEST_NAME: 0,
    JOINING: 1,
    DINNER: 2,
    DIETARY: 3,
    TENNIS: 4,
    SUNBEDS: 5,
    NOTES: 6,
    TIMESTAMP: 7,
    EMAIL: 8,
    LINK: 9,
};

// ─── Tennis tournament ────────────────────────────────────────────────────────
//
// Two tabs power the /tennis and /tennis/admin pages. Columns are matched by
// HEADER NAME (row 1), not position — so the column order can be anything and
// extra columns are ignored. Header matching is case-insensitive.
//
// TENNIS_SCHEDULE_SHEET ('Tennis Schedule') — one row per match. Build the whole
// schedule by hand in the sheet: fill the human columns, leave Score A/B and
// Match ID blank. Match ID is auto-assigned the first time the page loads.
//   Round | Time | Court | Team A | Team B | Score A | Score B | Note | Match ID
//   - Team A / Team B : team number (matches "Team" in the Teams tab)
//   - Note            : optional. Put the pod here ("Pod A" / "Pod B") to place
//                       both teams in that pod's standings; "Final" shows a badge.
//                       Pod-final rows can leave the teams blank, e.g.
//                       Note = "Pod A Final: Rank 1 vs Rank 2".
//
// TENNIS_TEAMS_SHEET ('Tennis Teams') — roster + auto-computed standings:
//   Team | Player 1 | Player 2 | [Pod] | Played | Won | Lost | Points For |
//         Points Against | Diff | Rank
//   - Team / Player 1 / Player 2 : filled by the organizer.
//   - Pod (OPTIONAL)  : "A"/"B" (or "Pod A"/"Pod B"). If present it wins; if
//                       absent, each team's pod is derived from its match notes.
//   - Played … Rank   : auto-written after each result (Rank is within the pod).
//
// Both tabs are auto-created with these headers if missing.

const TENNIS_SCHEDULE_SHEET = 'Tennis Schedule';
const TENNIS_TEAMS_SHEET = 'Tennis Teams';

const SCHEDULE_HEADERS = [
    'Round', 'Time', 'Court', 'Team A', 'Team B', 'Score A', 'Score B', 'Note', 'Match ID',
];
const TEAMS_HEADERS = [
    'Team', 'Player 1', 'Player 2', 'Pod', 'Played', 'Won', 'Lost',
    'Points For', 'Points Against', 'Diff', 'Rank',
];

// Header names used to compute + write standings (matched case-insensitively).
const STANDING_COLS = [
    { header: 'played', field: 'played' },
    { header: 'won', field: 'won' },
    { header: 'lost', field: 'lost' },
    { header: 'points for', field: 'pointsFor' },
    { header: 'points against', field: 'pointsAgainst' },
    { header: 'diff', field: 'diff' },
    { header: 'rank', field: 'rank' },
];

// ─── GET: look up RSVPs by email ──────────────────────────────────────────────

function doGet(e) {
    try {
        const action = e.parameter.action;

        if (action === 'getTennis') {
            return jsonResponse(getTennisData());
        }

        if (action === 'getByEmail') {
            const email = (e.parameter.email || '').trim().toLowerCase();
            if (!email) {
                return jsonResponse({ guests: [] });
            }

            const sheet = getSheet();
            if (!sheet) {
                return jsonResponse({ guests: [] });
            }

            const data = sheet.getDataRange().getValues();
            const guests = [];

            // Row 0 = header row; data starts at row 1
            for (let i = 1; i < data.length; i++) {
                const rowEmail = (data[i][COL.EMAIL] || '').toString().trim().toLowerCase();
                if (rowEmail === email) {
                    guests.push({
                        rowIndex: i + 1, // 1-based spreadsheet row number used for updates
                        guestName: data[i][COL.GUEST_NAME],
                        joining: data[i][COL.JOINING],
                        dinner: data[i][COL.DINNER],
                        dietary: data[i][COL.DIETARY],
                        tennis: data[i][COL.TENNIS],
                        sunbeds: data[i][COL.SUNBEDS],
                    });
                }
            }

            return jsonResponse({ guests });
        }

        return jsonResponse({ error: 'Unknown action' });

    } catch (err) {
        return jsonResponse({ error: err.toString() });
    }
}

// ─── POST: create a new RSVP or update an existing one ───────────────────────

function doPost(e) {
    try {
        const data = JSON.parse(e.postData.contents);

        if (data.action === 'saveMatch') {
            return jsonResponse(saveMatch(data));
        }
        if (data.action === 'deleteMatch') {
            return jsonResponse(deleteMatch(data));
        }

        const sheet = getOrCreateSheet();

        const email = data.email || '';
        const rowData = [
            data.guestName || '',
            data.joining || '',
            data.dinner || '',
            data.dietary || '',
            data.tennis || '',
            data.sunbeds || '',
            data.notes || '',
            new Date().toLocaleString(),
            email,
            email ? `https://olsenkeating.com/rsvp/${email}` : '',
        ];

        if (data.action === 'update' && data.rowIndex) {
            // Overwrite the existing row in place
            const rowIndex = parseInt(data.rowIndex, 10);
            sheet.getRange(rowIndex, 1, 1, rowData.length).setValues([rowData]);
        } else {
            // Append a new row
            sheet.appendRow(rowData);
        }

        return jsonResponse({ success: true });

    } catch (err) {
        return jsonResponse({ success: false, error: err.toString() });
    }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function getSheet() {
    const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
    return ss.getSheetByName(SHEET_NAME);
}

function getOrCreateSheet() {
    const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
    let sheet = ss.getSheetByName(SHEET_NAME);
    if (!sheet) {
        sheet = ss.insertSheet(SHEET_NAME);
        sheet.appendRow([
            'Guest Name', 'Joining', 'Dinner Selection', 'Dietary considerations',
            'Tennis Tournament', 'Sunday Sunbeds', 'Notes', 'Timestamp', 'Email', 'Link',
        ]);
    }
    return sheet;
}

function jsonResponse(obj) {
    return ContentService
        .createTextOutput(JSON.stringify(obj))
        .setMimeType(ContentService.MimeType.JSON);
}

// ─── Tennis helpers ────────────────────────────────────────────────────────────

function getOrCreateTennisSheet(name, headers) {
    const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
    let sheet = ss.getSheetByName(name);
    if (!sheet) {
        sheet = ss.insertSheet(name);
        sheet.appendRow(headers);
    }
    return sheet;
}

// Read a sheet's values and build a case-insensitive {headerName: columnIndex} map
// from row 1, so columns can be addressed by name regardless of their position.
function readSheetObjects(sheet) {
    const values = sheet.getDataRange().getValues();
    const headers = {};
    if (values.length) {
        values[0].forEach((h, i) => {
            const n = String(h == null ? '' : h).trim().toLowerCase();
            if (n && !(n in headers)) headers[n] = i;
        });
    }
    return { headers, values };
}

function cellVal(row, headers, name) {
    const i = headers[name];
    return (i === undefined) ? '' : row[i];
}

// Normalize a pod value to a short key: "Pod A" → "A", "A" → "A", "b" → "B".
// Only the leading token after an optional "Pod" prefix is used, so a final
// note like "Pod A Final: …" still resolves to "A".
function normalizePod(raw) {
    let s = String(raw == null ? '' : raw).trim();
    if (!s) return '';
    const m = s.match(/^pod\s*(.+)/i);
    if (m) s = m[1].trim();
    const token = s.split(/[\s:]+/)[0] || '';
    return token.toUpperCase();
}

// Assign a Match ID to any hand-entered row that has match content but no ID,
// so organizers can build the schedule directly in the sheet. Returns true if
// anything was written.
function ensureMatchIds(schedSheet) {
    const { headers, values } = readSheetObjects(schedSheet);
    const idIdx = headers['match id'];
    if (idIdx === undefined) return false;
    const contentCols = ['round', 'time', 'court', 'team a', 'team b', 'note']
        .map(n => headers[n]).filter(i => i !== undefined);
    let changed = false;
    for (let i = 1; i < values.length; i++) {
        const row = values[i];
        const hasContent = contentCols.some(c => String(row[c] == null ? '' : row[c]).trim() !== '');
        const hasId = String(row[idIdx] == null ? '' : row[idIdx]).trim() !== '';
        if (hasContent && !hasId) {
            schedSheet.getRange(i + 1, idIdx + 1)
                .setValue('m_' + Utilities.getUuid().replace(/-/g, '').slice(0, 10));
            changed = true;
        }
    }
    return changed;
}

// Read teams (roster + optional pod) and matches from the two tabs, by header name.
function readTennisSheets() {
    const teamsSheet = getOrCreateTennisSheet(TENNIS_TEAMS_SHEET, TEAMS_HEADERS);
    const schedSheet = getOrCreateTennisSheet(TENNIS_SCHEDULE_SHEET, SCHEDULE_HEADERS);

    // Backfill IDs for any manually-added rows before reading them.
    ensureMatchIds(schedSheet);

    const t = readSheetObjects(teamsSheet);
    const teams = [];
    for (let i = 1; i < t.values.length; i++) {
        const row = t.values[i];
        const number = String(cellVal(row, t.headers, 'team') || '').trim();
        if (!number) continue;
        teams.push({
            team: number,
            player1: cellVal(row, t.headers, 'player 1') || '',
            player2: cellVal(row, t.headers, 'player 2') || '',
            pod: String(cellVal(row, t.headers, 'pod') || '').trim(),
        });
    }

    const s = readSheetObjects(schedSheet);
    const matches = [];
    for (let i = 1; i < s.values.length; i++) {
        const row = s.values[i];
        const matchId = String(cellVal(row, s.headers, 'match id') || '').trim();
        if (!matchId) continue;
        matches.push({
            matchId: matchId,
            round: cellVal(row, s.headers, 'round'),
            time: cellVal(row, s.headers, 'time'),
            court: cellVal(row, s.headers, 'court'),
            teamA: String(cellVal(row, s.headers, 'team a') || '').trim(),
            teamB: String(cellVal(row, s.headers, 'team b') || '').trim(),
            scoreA: cellVal(row, s.headers, 'score a'),
            scoreB: cellVal(row, s.headers, 'score b'),
            note: cellVal(row, s.headers, 'note') || '',
        });
    }

    return { teams, matches, teamsSheet, schedSheet };
}

// Resolve each team's pod: the Teams-tab "Pod" column wins; otherwise it's
// derived from the "Pod A/Pod B" note on the matches the team plays.
function resolvePods(teams, matches) {
    const derived = {};
    matches.forEach(m => {
        const pod = normalizePod(m.note);
        if (!pod) return;
        if (m.teamA && !derived[m.teamA]) derived[m.teamA] = pod;
        if (m.teamB && !derived[m.teamB]) derived[m.teamB] = pod;
    });
    const pods = {};
    teams.forEach(t => {
        pods[t.team] = normalizePod(t.pod) || derived[t.team] || '';
    });
    return pods;
}

// Compute standings from matches. Win = 1, Loss = 0, no ties.
// Teams are grouped by pod and ranked within their pod
// (wins desc → diff desc → points-for desc).
function computeStandings(teams, matches) {
    const podOf = resolvePods(teams, matches);
    const stats = {};
    teams.forEach(t => {
        stats[t.team] = {
            team: t.team, player1: t.player1, player2: t.player2, pod: podOf[t.team] || '',
            played: 0, won: 0, lost: 0, pointsFor: 0, pointsAgainst: 0, diff: 0,
        };
    });

    matches.forEach(m => {
        const a = m.scoreA, b = m.scoreB;
        const hasScores = a !== '' && a !== null && a !== undefined &&
                          b !== '' && b !== null && b !== undefined;
        if (!hasScores) return;
        const sa = Number(a), sb = Number(b);
        if (isNaN(sa) || isNaN(sb)) return;
        const ta = stats[m.teamA], tb = stats[m.teamB];
        if (!ta || !tb) return; // skip matches referencing unknown teams

        ta.played++; tb.played++;
        ta.pointsFor += sa; ta.pointsAgainst += sb;
        tb.pointsFor += sb; tb.pointsAgainst += sa;
        if (sa > sb) { ta.won++; tb.lost++; }
        else if (sb > sa) { tb.won++; ta.lost++; }
        // equal scores award no win (no ties)
    });

    // Group by pod, then sort + rank within each pod.
    const groups = {};
    Object.keys(stats).forEach(k => {
        const st = stats[k];
        st.diff = st.pointsFor - st.pointsAgainst;
        (groups[st.pod] = groups[st.pod] || []).push(st);
    });

    const standings = [];
    Object.keys(groups).sort().forEach(podKey => {
        const arr = groups[podKey];
        arr.sort((x, y) => (y.won - x.won) || (y.diff - x.diff) || (y.pointsFor - x.pointsFor));
        arr.forEach((st, i) => { st.rank = i + 1; });
        standings.push.apply(standings, arr);
    });
    return standings;
}

// Write computed standings columns back into the Teams tab (matched by header
// name and team number). Rank is within the pod.
function writeStandings(teamsSheet, standings) {
    const { headers, values } = readSheetObjects(teamsSheet);
    const teamIdx = headers['team'];
    if (teamIdx === undefined) return;

    const present = STANDING_COLS.filter(c => headers[c.header] !== undefined);
    if (!present.length) return;
    const idxs = present.map(c => headers[c.header]);
    const minC = Math.min.apply(null, idxs);
    const maxC = Math.max.apply(null, idxs);

    const byTeam = {};
    standings.forEach(s => { byTeam[String(s.team)] = s; });

    for (let i = 1; i < values.length; i++) {
        const number = String(values[i][teamIdx] == null ? '' : values[i][teamIdx]).trim();
        const s = byTeam[number];
        if (!s) continue;
        // Preserve any non-standing cells that fall inside the written span.
        const span = values[i].slice(minC, maxC + 1);
        present.forEach(c => { span[headers[c.header] - minC] = s[c.field]; });
        teamsSheet.getRange(i + 1, minC + 1, 1, span.length).setValues([span]);
    }
}

function getTennisData() {
    const { teams, matches } = readTennisSheets();
    const standings = computeStandings(teams, matches);
    const pods = [];
    standings.forEach(s => { if (pods.indexOf(s.pod) === -1) pods.push(s.pod); });
    // Standings are computed live for the site on every read. We do NOT write
    // them back here — that happens on saveMatch/deleteMatch — to avoid heavy
    // write-amplification from many guests polling this endpoint.
    return { teams, matches, standings, pods: pods.sort(), updated: new Date().toISOString() };
}

// Upsert a match by Match ID, then recompute + persist standings. Values are
// placed into whatever columns the sheet actually has (by header name).
function saveMatch(data) {
    const schedSheet = getOrCreateTennisSheet(TENNIS_SCHEDULE_SHEET, SCHEDULE_HEADERS);
    ensureMatchIds(schedSheet);
    const matchId = (data.matchId || '').toString().trim();
    if (!matchId) return { success: false, error: 'Missing matchId' };

    const { headers, values } = readSheetObjects(schedSheet);
    const width = values.length ? values[0].length : SCHEDULE_HEADERS.length;
    const fieldByHeader = {
        'match id': matchId,
        'round': data.round || '',
        'time': data.time || '',
        'court': data.court || '',
        'team a': (data.teamA || '').toString(),
        'team b': (data.teamB || '').toString(),
        'score a': (data.scoreA === undefined || data.scoreA === null) ? '' : data.scoreA,
        'score b': (data.scoreB === undefined || data.scoreB === null) ? '' : data.scoreB,
        'note': data.note || '',
    };

    const idIdx = headers['match id'];
    let targetRow = -1;
    if (idIdx !== undefined) {
        for (let i = 1; i < values.length; i++) {
            if (String(values[i][idIdx] == null ? '' : values[i][idIdx]).trim() === matchId) {
                targetRow = i;
                break;
            }
        }
    }

    const base = targetRow > 0 ? values[targetRow].slice() : new Array(width).fill('');
    Object.keys(fieldByHeader).forEach(h => {
        const idx = headers[h];
        if (idx !== undefined) base[idx] = fieldByHeader[h];
    });

    if (targetRow > 0) {
        schedSheet.getRange(targetRow + 1, 1, 1, base.length).setValues([base]);
    } else {
        schedSheet.appendRow(base);
    }

    const { teams, matches, teamsSheet } = readTennisSheets();
    writeStandings(teamsSheet, computeStandings(teams, matches));
    return { success: true };
}

function deleteMatch(data) {
    const schedSheet = getOrCreateTennisSheet(TENNIS_SCHEDULE_SHEET, SCHEDULE_HEADERS);
    const matchId = (data.matchId || '').toString().trim();
    if (!matchId) return { success: false, error: 'Missing matchId' };

    const { headers, values } = readSheetObjects(schedSheet);
    const idIdx = headers['match id'];
    if (idIdx !== undefined) {
        for (let i = values.length - 1; i >= 1; i--) {
            if (String(values[i][idIdx] == null ? '' : values[i][idIdx]).trim() === matchId) {
                schedSheet.deleteRow(i + 1);
            }
        }
    }

    const { teams, matches, teamsSheet } = readTennisSheets();
    writeStandings(teamsSheet, computeStandings(teams, matches));
    return { success: true };
}

// ─── Local test helpers (run manually in the Apps Script editor) ──────────────

function testGetByEmail() {
    const mockEvent = { parameter: { action: 'getByEmail', email: 'wskeating@gmail.com' } };
    Logger.log(doGet(mockEvent).getContent());
}

function testCreate() {
    const mockEvent = {
        postData: {
            contents: JSON.stringify({
                action: 'create',
                guestName: 'Test Guest',
                joining: 'Yes',
                dinner: 'Fish',
                dietary: '',
                tennis: 'No',
                sunbeds: 'Yes',
                email: 'test@example.com',
            }),
        },
    };
    Logger.log(doPost(mockEvent).getContent());
}

function testUpdate() {
    const mockEvent = {
        postData: {
            contents: JSON.stringify({
                action: 'update',
                rowIndex: 2,
                guestName: 'Updated Guest',
                joining: 'Yes',
                dinner: 'Vegetarian',
                dietary: 'Gluten free',
                tennis: 'Yes (as a player)',
                sunbeds: 'No',
                email: 'test@example.com',
            }),
        },
    };
    Logger.log(doPost(mockEvent).getContent());
}

function testGetTennis() {
    const mockEvent = { parameter: { action: 'getTennis' } };
    Logger.log(doGet(mockEvent).getContent());
}

function testSaveMatch() {
    const mockEvent = {
        postData: {
            contents: JSON.stringify({
                action: 'saveMatch',
                matchId: 'm_test01',
                round: '1',
                time: '9:30-9:45',
                court: '1',
                teamA: '1',
                teamB: '2',
                scoreA: 6,
                scoreB: 4,
                note: '',
            }),
        },
    };
    Logger.log(doPost(mockEvent).getContent());
}

function testDeleteMatch() {
    const mockEvent = {
        postData: { contents: JSON.stringify({ action: 'deleteMatch', matchId: 'm_test01' }) },
    };
    Logger.log(doPost(mockEvent).getContent());
}
