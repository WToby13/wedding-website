/**
 * Google Apps Script for the wedding website.
 * Handles the RSVP form AND the tennis tournament pages.
 *
 * RSVP:   doGet(action=getByEmail), doPost(action=create|update)
 * Tennis: doGet(action=getTennis), doPost(action=saveMatch|deleteMatch)
 *         (see the "Tennis tournament" section below for the two tabs used)
 * Photos: doGet(action=photosList), doPost(action=photosStart|photosChunk|
 *         photosDone|photosDelete) — see the "Photos" section below.
 *         After pasting, run authorizePhotos() once in the editor so the
 *         script gets Google Drive access.
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
 *      Current URL: https://script.google.com/macros/s/AKfycbxFFDWWzp2ryFCGL6D6TyKVXIRTkHUqZkLiEGaSgGtbkq0RHIvnEGAN5ziOM0wuZOmO6g/exec
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

        if (action === 'photosList') {
            return jsonResponse(photosList(e.parameter));
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

        // Photo actions must be routed before the RSVP fallthrough below,
        // which treats any unknown action as a new RSVP row.
        if (PHOTO_ACTIONS[data.action]) {
            return jsonResponse(PHOTO_ACTIONS[data.action](data));
        }

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

// ─── Photos ───────────────────────────────────────────────────────────────────
//
// Powers /photos. Files live in a Google Drive folder. Uploads use a Drive
// resumable-upload session started here (photosStart): the browser PUTs the
// bytes straight to Drive, and if it can't reach Drive directly it relays
// base64 chunks through this script instead (photosChunk).
//
// Per-file details are stored as Drive appProperties:
//   takenAt   ISO capture time read from the photo/video metadata in the browser
//   uploader  optional guest name (also written to the file description)
//   duration  video length in ms
//   owner     hash of the uploading device's key — lets that device delete it
//   fp        content fingerprint, used to skip duplicate uploads
// Files added to the folder by hand work too; they fall back to Drive's own
// photo metadata for the capture time. Deleting moves a file to the Drive trash.

const PHOTOS_FOLDER_ID = '180We-RSYneDPXHaiHjNnCHgn5lHmcjL0';
const PHOTOS_PASSCODE = 'andrea'; // compared case-insensitively
const PHOTOS_MAX_IMAGE_BYTES = 100 * 1024 * 1024;
const PHOTOS_MAX_VIDEO_BYTES = 2 * 1024 * 1024 * 1024;
const PHOTOS_MAX_VIDEO_MS = 91000; // "up to 90 seconds", with a little slack
const PHOTOS_CACHE_KEY = 'photos';
const PHOTOS_CACHE_SECONDS = 60;
const PHOTOS_TZ = 'Europe/Paris';
const PHOTOS_TZ_OFFSET = '+02:00'; // France in September; used for timestamps with no zone
const DRIVE_FILES_API = 'https://www.googleapis.com/drive/v3/files';
const DRIVE_UPLOAD_API = 'https://www.googleapis.com/upload/drive/v3/files';
const PHOTO_FIELDS = 'id,name,mimeType,createdTime,appProperties,imageMediaMetadata(time),videoMediaMetadata(durationMillis)';
// Pages allowed to upload straight to Drive (others fall back to relaying).
const PHOTOS_ORIGIN_RE = /^(https:\/\/([a-z0-9-]+\.)*(olsenkeating\.com|vercel\.app)|http:\/\/(localhost|127\.0\.0\.1)(:\d+)?)$/;

const PHOTO_ACTIONS = {
    photosStart: photosStart,
    photosChunk: photosChunk,
    photosDone: photosDone,
    photosDelete: photosDelete,
};

// Run once from the Apps Script editor (select it → Run) to grant Drive access.
function authorizePhotos() {
    Logger.log('Photos folder: ' + DriveApp.getFolderById(PHOTOS_FOLDER_ID).getName());
}

function photosList(params) {
    if (!photosAuthorized(params.code)) return { error: 'bad_code' };
    const deviceHash = String(params.device || '');
    const photos = listPhotoFiles().map(item => publicPhoto(item, deviceHash));
    return { photos: photos, updated: new Date().toISOString() };
}

// Validate the upload, skip duplicates, and open a Drive resumable session.
function photosStart(data) {
    if (!photosAuthorized(data.code)) return { error: 'bad_code' };

    const mime = String(data.mimeType || '').toLowerCase();
    const size = Number(data.size);
    const isVideo = mime.indexOf('video/') === 0;
    if (!isVideo && mime.indexOf('image/') !== 0) return { error: 'unsupported_type' };
    if (!(size > 0) || size > (isVideo ? PHOTOS_MAX_VIDEO_BYTES : PHOTOS_MAX_IMAGE_BYTES)) {
        return { error: 'too_large' };
    }
    const duration = Number(data.duration) || 0;
    if (isVideo && duration > PHOTOS_MAX_VIDEO_MS) return { error: 'too_long' };

    const owner = hashDeviceKey(data.deviceKey);
    const fp = String(data.fingerprint || '').replace(/[^a-f0-9]/g, '').slice(0, 32);
    if (fp) {
        const existing = findPhotoByFingerprint(fp);
        if (existing) return { duplicate: true, photo: publicPhoto(existing, owner) };
    }

    const takenMs = parsePhotoTime(data.takenAt);
    const uploader = truncateBytes(String(data.uploader || '').trim(), 100);
    const appProperties = { src: 'site' };
    if (owner) appProperties.owner = owner;
    if (takenMs) appProperties.takenAt = new Date(takenMs).toISOString();
    if (uploader) appProperties.uploader = uploader;
    if (fp) appProperties.fp = fp;
    if (isVideo && duration > 0) appProperties.duration = String(Math.round(duration));

    const metadata = {
        name: photoFileName(data.name, takenMs),
        parents: [PHOTOS_FOLDER_ID],
        appProperties: appProperties,
    };
    if (uploader) metadata.description = 'Shared by ' + uploader;

    const headers = { 'X-Upload-Content-Type': mime, 'X-Upload-Content-Length': String(size) };
    // Drive only returns CORS headers on the session if it was opened with the page's Origin.
    const origin = String(data.origin || '');
    if (PHOTOS_ORIGIN_RE.test(origin)) headers.Origin = origin;

    const url = DRIVE_UPLOAD_API + '?uploadType=resumable&fields=' + encodeURIComponent(PHOTO_FIELDS);
    const options = {
        method: 'post',
        contentType: 'application/json; charset=UTF-8',
        payload: JSON.stringify(metadata),
        headers: headers,
    };
    let res;
    try {
        res = driveRequest(url, options);
    } catch (err) {
        if (!headers.Origin) throw err;
        delete headers.Origin; // the browser will relay chunks instead
        res = driveRequest(url, options);
    }

    const uploadUrl = headerValue(res, 'Location');
    if (res.getResponseCode() !== 200 || !uploadUrl) {
        throw new Error('Could not start upload (' + res.getResponseCode() + '): ' + res.getContentText().slice(0, 300));
    }
    return { uploadUrl: uploadUrl, direct: !!headers.Origin };
}

// Relay one chunk (or, with no data, ask how much Drive has received so far).
function photosChunk(data) {
    if (!photosAuthorized(data.code)) return { error: 'bad_code' };
    const uploadUrl = String(data.uploadUrl || '');
    if (uploadUrl.indexOf(DRIVE_UPLOAD_API + '?') !== 0) return { error: 'bad_upload_url' };

    const total = Number(data.total);
    const start = Number(data.start) || 0;
    const bytes = data.b64 ? Utilities.base64Decode(data.b64) : [];
    const options = {
        method: 'put',
        headers: {
            'Content-Range': bytes.length
                ? 'bytes ' + start + '-' + (start + bytes.length - 1) + '/' + total
                : 'bytes */' + total,
        },
        payload: bytes.length ? bytes : '',
        contentType: 'application/octet-stream',
        muteHttpExceptions: true,
        followRedirects: false,
    };
    const res = UrlFetchApp.fetch(uploadUrl, options);
    const code = res.getResponseCode();

    if (code === 200 || code === 201) {
        return { done: true, fileId: JSON.parse(res.getContentText()).id };
    }
    if (code === 308) {
        const m = headerValue(res, 'Range').match(/bytes=0-(\d+)/);
        return { done: false, next: m ? Number(m[1]) + 1 : 0 };
    }
    return { error: 'upload_failed', status: code, detail: res.getContentText().slice(0, 300) };
}

// Called after an upload finishes: refresh the cached list and return the new item.
function photosDone(data) {
    if (!photosAuthorized(data.code)) return { error: 'bad_code' };
    CacheService.getScriptCache().remove(PHOTOS_CACHE_KEY);
    const fileId = cleanFileId(data.fileId);
    if (!fileId) return { error: 'not_found' };
    const file = driveJson(DRIVE_FILES_API + '/' + fileId + '?fields=' + encodeURIComponent(PHOTO_FIELDS + ',parents'));
    if ((file.parents || []).indexOf(PHOTOS_FOLDER_ID) === -1) return { error: 'not_found' };
    return { photo: publicPhoto(toPhotoItem(file), hashDeviceKey(data.deviceKey)) };
}

// Guests can delete what they uploaded from the same device (moved to Drive trash).
function photosDelete(data) {
    if (!photosAuthorized(data.code)) return { error: 'bad_code' };
    const fileId = cleanFileId(data.fileId);
    const owner = hashDeviceKey(data.deviceKey);
    if (!fileId || !owner) return { error: 'not_allowed' };

    const file = driveJson(DRIVE_FILES_API + '/' + fileId + '?fields=parents,appProperties');
    const isOwner = (file.appProperties || {}).owner === owner;
    if ((file.parents || []).indexOf(PHOTOS_FOLDER_ID) === -1 || !isOwner) return { error: 'not_allowed' };

    driveJson(DRIVE_FILES_API + '/' + fileId, {
        method: 'patch',
        contentType: 'application/json',
        payload: JSON.stringify({ trashed: true }),
    });
    CacheService.getScriptCache().remove(PHOTOS_CACHE_KEY);
    return { success: true };
}

// ─── Photo helpers ─────────────────────────────────────────────────────────────

function photosAuthorized(code) {
    return String(code || '').trim().toLowerCase() === PHOTOS_PASSCODE;
}

function listPhotoFiles() {
    const cache = CacheService.getScriptCache();
    const cached = cacheGetJson(cache, PHOTOS_CACHE_KEY);
    if (cached) return cached;

    const q = "'" + PHOTOS_FOLDER_ID + "' in parents and trashed = false and " +
              "(mimeType contains 'image/' or mimeType contains 'video/')";
    const items = [];
    let pageToken = '';
    do {
        const url = DRIVE_FILES_API + '?pageSize=1000&q=' + encodeURIComponent(q) +
            '&fields=' + encodeURIComponent('nextPageToken,files(' + PHOTO_FIELDS + ')') +
            (pageToken ? '&pageToken=' + encodeURIComponent(pageToken) : '');
        const data = driveJson(url);
        (data.files || []).forEach(f => items.push(toPhotoItem(f)));
        pageToken = data.nextPageToken || '';
    } while (pageToken);

    cachePutJson(cache, PHOTOS_CACHE_KEY, items, PHOTOS_CACHE_SECONDS);
    return items;
}

function findPhotoByFingerprint(fp) {
    const q = "'" + PHOTOS_FOLDER_ID + "' in parents and trashed = false and " +
              "appProperties has { key='fp' and value='" + fp + "' }";
    const data = driveJson(DRIVE_FILES_API + '?pageSize=1&q=' + encodeURIComponent(q) +
        '&fields=' + encodeURIComponent('files(' + PHOTO_FIELDS + ')'));
    return (data.files && data.files.length) ? toPhotoItem(data.files[0]) : null;
}

function toPhotoItem(file) {
    const props = file.appProperties || {};
    const video = file.videoMediaMetadata || {};
    const duration = Number(video.durationMillis) || Number(props.duration) || null;
    return {
        id: file.id,
        name: file.name,
        type: String(file.mimeType).indexOf('video/') === 0 ? 'video' : 'image',
        takenAt: parsePhotoTime(props.takenAt) || parsePhotoTime((file.imageMediaMetadata || {}).time),
        uploadedAt: Date.parse(file.createdTime) || null,
        uploader: props.uploader || '',
        duration: duration,
        owner: props.owner || '',
    };
}

// Strip the owner hash and flag whether the requesting device uploaded it.
function publicPhoto(item, deviceHash) {
    const out = Object.assign({}, item, { mine: !!deviceHash && item.owner === deviceHash });
    delete out.owner;
    return out;
}

// EXIF "2026:09:12 17:31:02" or ISO 8601 → epoch ms (null if missing/invalid).
function parsePhotoTime(raw) {
    let s = String(raw || '').trim();
    if (!s) return null;
    const exif = s.match(/^(\d{4}):(\d{2}):(\d{2})[ T](\d{2}):(\d{2}):(\d{2})/);
    if (exif) s = exif[1] + '-' + exif[2] + '-' + exif[3] + 'T' + exif[4] + ':' + exif[5] + ':' + exif[6];
    s = s.replace(/([+-]\d{2})(\d{2})$/, '$1:$2');
    if (!/(Z|[+-]\d{2}:\d{2})$/.test(s)) s += PHOTOS_TZ_OFFSET;
    const t = Date.parse(s);
    if (isNaN(t) || new Date(t).getUTCFullYear() < 2000) return null;
    return t;
}

// Prefix the capture time so the Drive folder sorts chronologically too.
function photoFileName(name, takenMs) {
    const base = String(name || 'photo').replace(/[\\/ -]/g, '_').slice(0, 120) || 'photo';
    return takenMs
        ? Utilities.formatDate(new Date(takenMs), PHOTOS_TZ, 'yyyy-MM-dd HH.mm.ss') + ' - ' + base
        : base;
}

function hashDeviceKey(key) {
    const k = String(key || '');
    if (k.length < 16) return '';
    return Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, k, Utilities.Charset.UTF_8)
        .map(b => ((b + 256) % 256).toString(16).padStart(2, '0'))
        .join('')
        .slice(0, 32);
}

function cleanFileId(id) {
    return String(id || '').replace(/[^\w-]/g, '');
}

// appProperties are limited to 124 bytes per key + value.
function truncateBytes(str, maxBytes) {
    const chars = Array.from(str.slice(0, maxBytes));
    while (chars.length && Utilities.newBlob(chars.join('')).getBytes().length > maxBytes) chars.pop();
    return chars.join('');
}

function driveRequest(url, options) {
    const opts = Object.assign({ muteHttpExceptions: true }, options || {});
    opts.headers = Object.assign({ Authorization: 'Bearer ' + ScriptApp.getOAuthToken() }, opts.headers || {});
    return UrlFetchApp.fetch(url, opts);
}

function driveJson(url, options) {
    const res = driveRequest(url, options);
    const code = res.getResponseCode();
    if (code < 200 || code >= 300) {
        throw new Error('Drive ' + code + ': ' + res.getContentText().slice(0, 300));
    }
    const text = res.getContentText();
    return text ? JSON.parse(text) : {};
}

function headerValue(res, name) {
    const headers = res.getAllHeaders();
    const key = Object.keys(headers).find(k => k.toLowerCase() === name.toLowerCase());
    if (!key) return '';
    const value = headers[key];
    return Array.isArray(value) ? String(value[0]) : String(value);
}

// CacheService values max out at 100KB, so large lists are stored in parts.
function cachePutJson(cache, key, value, seconds) {
    const json = JSON.stringify(value);
    const partSize = 40000;
    const parts = {};
    let count = 0;
    for (let i = 0; i < json.length; i += partSize) {
        parts[key + ':' + count++] = json.slice(i, i + partSize);
    }
    parts[key] = String(count);
    try {
        cache.putAll(parts, seconds);
    } catch (_err) {
        // Too big to cache — the list is simply served uncached.
    }
}

function cacheGetJson(cache, key) {
    const count = Number(cache.get(key));
    if (!count) return null;
    const keys = [];
    for (let i = 0; i < count; i++) keys.push(key + ':' + i);
    const parts = cache.getAll(keys);
    if (keys.some(k => parts[k] == null)) return null;
    try {
        return JSON.parse(keys.map(k => parts[k]).join(''));
    } catch (_err) {
        return null;
    }
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

function testPhotosList() {
    const mockEvent = { parameter: { action: 'photosList', code: 'Andrea' } };
    Logger.log(doGet(mockEvent).getContent());
}
