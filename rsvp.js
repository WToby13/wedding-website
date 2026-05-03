// Google Apps Script web app URL
const SCRIPT_URL = 'https://script.google.com/macros/s/AKfycbweH5XO1QOkghNKIYKALESUgnlpseC4JkLuIPtRCtNvlZDytACz2wqlFeL_uWTWNshfUw/exec';

// App state
const state = {
    email: '',
    guests: [],
    editingIndex: -1, // -1 = new guest, >= 0 = editing guest at that index
};

// ─── URL Routing ─────────────────────────────────────────────────────────────

function getEmailFromPath() {
    const match = window.location.pathname.match(/^\/rsvp\/(.+)$/);
    return match ? decodeURIComponent(match[1]) : null;
}

function showView(id) {
    document.querySelectorAll('.rsvp-view').forEach(v => v.classList.add('hidden'));
    document.getElementById(id).classList.remove('hidden');
    window.scrollTo({ top: 0, behavior: 'smooth' });
}

// On load: if there's an email in the URL, skip straight to the dashboard
document.addEventListener('DOMContentLoaded', async () => {
    const pathEmail = getEmailFromPath();
    if (pathEmail) {
        state.email = pathEmail;
        showView('view-dashboard');
        await loadGuests();
    } else {
        showView('view-email');
    }
});

// ─── Email View ───────────────────────────────────────────────────────────────

const emailInput = document.getElementById('email-input');
const emailContinueBtn = document.getElementById('email-continue-btn');
const emailError = document.getElementById('email-error');

emailContinueBtn.addEventListener('click', handleEmailContinue);
emailInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') handleEmailContinue();
});

function handleEmailContinue() {
    const email = emailInput.value.trim().toLowerCase();
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        emailError.classList.remove('hidden');
        emailInput.focus();
        return;
    }
    // Navigate to the email URL — the page reload handles showing the dashboard
    window.location.href = `/rsvp/${encodeURIComponent(email)}`;
}

// ─── Guests Fetch ─────────────────────────────────────────────────────────────

async function loadGuests() {
    try {
        const res = await fetch(`${SCRIPT_URL}?action=getByEmail&email=${encodeURIComponent(state.email)}`);
        const data = await res.json();
        state.guests = data.guests || [];
    } catch (_err) {
        state.guests = [];
    }
    renderDashboard();
}

// ─── Dashboard View ───────────────────────────────────────────────────────────

document.getElementById('dashboard-back-btn').addEventListener('click', () => {
    window.location.href = '/rsvp';
});

function renderDashboard() {
    document.getElementById('dashboard-email-label').textContent = state.email;
    const container = document.getElementById('guests-container');
    const isEmpty = state.guests.length === 0;
    container.classList.toggle('guests-grid--empty', isEmpty);

    const guestCards = state.guests.map((g, i) => {
        const attending = g.joining === 'Yes';
        return `
            <div class="guest-card">
                <div class="guest-card-top">
                    <h3 class="guest-card-name">${escapeHtml(g.guestName)}</h3>
                    <span class="attendance-badge ${attending ? 'badge-attending' : 'badge-not-attending'}">
                        ${attending ? 'Attending' : 'Not attending'}
                    </span>
                </div>
                ${attending ? `
                    <div class="guest-card-details">
                        ${g.dinner ? `<div class="card-detail-row">
                            <span class="card-detail-label">Dinner</span>
                            <span class="card-detail-value">${escapeHtml(g.dinner)}</span>
                        </div>` : ''}
                        ${g.tennis ? `<div class="card-detail-row">
                            <span class="card-detail-label">Tennis</span>
                            <span class="card-detail-value">${escapeHtml(g.tennis)}</span>
                        </div>` : ''}
                        ${g.sunbeds ? `<div class="card-detail-row">
                            <span class="card-detail-label">Sunday beach</span>
                            <span class="card-detail-value">${g.sunbeds === 'Yes' ? 'Joining' : 'Not joining'}</span>
                        </div>` : ''}
                        ${g.dietary ? `<div class="card-detail-row card-detail-dietary">
                            <span class="card-detail-label">Dietary</span>
                            <span class="card-detail-value">${escapeHtml(g.dietary)}</span>
                        </div>` : ''}
                    </div>
                ` : ''}
                ${attending && !g.dinner ? `<div class="card-dinner-nudge">Select dinner</div>` : ''}
                <button class="card-edit-btn" onclick="openEditForm(${i})">Edit</button>
            </div>
        `;
    });

    const placeholderCard = `
        <button class="guest-card guest-card-placeholder" onclick="openAddForm()" aria-label="Add guest">
            <span class="placeholder-plus">+</span>
            <span class="placeholder-label">${isEmpty ? 'Add your first guest' : 'Add guest'}</span>
        </button>
    `;

    container.innerHTML = [...guestCards, placeholderCard].join('');
}

function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str || '';
    return div.innerHTML;
}

// ─── Form View ────────────────────────────────────────────────────────────────

document.getElementById('form-back-btn').addEventListener('click', () => {
    showView('view-dashboard');
    renderDashboard();
});

function openAddForm() {
    state.editingIndex = -1;
    document.getElementById('form-title').textContent = 'Add Guest';
    resetForm();
    showView('view-form');
}

function openEditForm(index) {
    state.editingIndex = index;
    document.getElementById('form-title').textContent = 'Edit Guest';
    fillForm(state.guests[index]);
    showView('view-form');
}

function resetForm() {
    document.getElementById('rsvp-form').reset();
    document.querySelectorAll('#view-form .toggle-btn').forEach(btn => btn.classList.remove('active'));
    document.querySelectorAll('#view-form input[type="hidden"]').forEach(inp => { inp.value = ''; });
    updateAttendingFields();
}

function fillForm(guest) {
    document.getElementById('guest-name').value = guest.guestName || '';
    document.getElementById('dietary').value = guest.dietary || '';
    setToggleValue('joining', guest.joining);
    setToggleValue('dinner', guest.dinner);
    setToggleValue('tennis', guest.tennis);
    setToggleValue('sunbeds', guest.sunbeds);
    updateAttendingFields();
}

function setToggleValue(fieldId, value) {
    const input = document.getElementById(fieldId);
    if (!input) return;
    input.value = value || '';
    const group = input.closest('.form-group');
    if (!group) return;
    group.querySelectorAll('.toggle-btn').forEach(btn => {
        btn.classList.toggle('active', btn.getAttribute('data-value') === value);
    });
}

// Show or hide the attending-only fields based on the "joining" toggle
function updateAttendingFields() {
    const joining = document.getElementById('joining').value;
    document.querySelectorAll('#view-form .attending-only').forEach(field => {
        field.classList.toggle('hidden', joining !== 'Yes');
    });
}

// ─── Toggle Buttons ───────────────────────────────────────────────────────────

document.querySelectorAll('#view-form .toggle-btn').forEach(btn => {
    btn.addEventListener('click', function () {
        const group = this.closest('.toggle-group');
        const hiddenInput = this.closest('.form-group').querySelector('input[type="hidden"]');

        group.querySelectorAll('.toggle-btn').forEach(b => b.classList.remove('active'));
        this.classList.add('active');

        if (hiddenInput) {
            hiddenInput.value = this.getAttribute('data-value');
            if (hiddenInput.id === 'joining') {
                updateAttendingFields();
            }
        }
    });
});

// ─── Form Submission ──────────────────────────────────────────────────────────

document.getElementById('rsvp-form').addEventListener('submit', async function (e) {
    e.preventDefault();

    const joining = document.getElementById('joining').value;

    const formData = {
        action: state.editingIndex === -1 ? 'create' : 'update',
        rowIndex: state.editingIndex >= 0 ? state.guests[state.editingIndex].rowIndex : null,
        guestName: document.getElementById('guest-name').value.trim(),
        joining,
        dinner: joining === 'Yes' ? (document.getElementById('dinner').value || '') : '',
        dietary: document.getElementById('dietary').value.trim(),
        tennis: joining === 'Yes' ? (document.getElementById('tennis').value || '') : '',
        sunbeds: joining === 'Yes' ? (document.getElementById('sunbeds').value || '') : '',
        email: state.email,
    };

    if (!formData.guestName) {
        alert('Please enter the guest\'s name.');
        return;
    }
    if (!formData.joining) {
        alert('Please indicate whether this guest will be joining.');
        return;
    }

    const submitBtn = document.querySelector('#view-form .rsvp-submit-btn');
    const origText = submitBtn.textContent;
    submitBtn.textContent = 'Saving...';
    submitBtn.disabled = true;

    try {
        await fetch(SCRIPT_URL, {
            method: 'POST',
            mode: 'no-cors',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(formData),
        });

        // Optimistically update local state (no-cors means we can't read the response)
        const guestObj = {
            rowIndex: state.editingIndex >= 0 ? state.guests[state.editingIndex].rowIndex : null,
            guestName: formData.guestName,
            joining: formData.joining,
            dinner: formData.dinner,
            dietary: formData.dietary,
            tennis: formData.tennis,
            sunbeds: formData.sunbeds,
        };

        if (state.editingIndex === -1) {
            state.guests.push(guestObj);
        } else {
            state.guests[state.editingIndex] = guestObj;
        }

        showView('view-dashboard');
        renderDashboard();

    } catch (_err) {
        alert('There was an error saving your RSVP. Please try again or contact us at olsenandrea96@gmail.com');
    } finally {
        submitBtn.textContent = origText;
        submitBtn.disabled = false;
    }
});
