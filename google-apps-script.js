/**
 * Google Apps Script for RSVP Form
 * Handles both reading RSVPs by email (doGet) and creating/updating RSVPs (doPost).
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

// ─── GET: look up RSVPs by email ──────────────────────────────────────────────

function doGet(e) {
    try {
        const action = e.parameter.action;

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
