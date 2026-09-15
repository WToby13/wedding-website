# Photos Page Setup

The `/photos` page lets guests upload photos and short videos (up to 90 seconds)
to the **Wedding weekend photos** Google Drive folder and browse them in a grid
or a swipeable full-screen viewer. It uses the same Google Apps Script backend
as the RSVP and tennis pages.

- Passcode: the bride's first name (`Andrea`, not case sensitive)
- Drive folder: https://drive.google.com/drive/folders/180We-RSYneDPXHaiHjNnCHgn5lHmcjL0

## One-time setup

### 1. Share the Drive folder by link

Thumbnails and the video player load straight from Google Drive, so the folder
must be viewable by link.

1. Open the folder in Google Drive → **Share**
2. Under **General access**, choose **Anyone with the link** → **Viewer**

The page itself stays behind the passcode; file links are long random IDs.

### 2. Update the Apps Script

1. Open the existing project at https://script.google.com/
2. Replace all the code with the contents of `google-apps-script.js` and save
3. In the function dropdown pick **authorizePhotos** → **Run**, then approve the
   Google Drive permission prompt (same "unverified app" steps as the RSVP setup).
   The log should print `Photos folder: Wedding weekend photos`.
4. **Deploy → Manage deployments** → edit (pencil) the existing web app →
   **Version: New version** → **Deploy**

Editing the existing deployment keeps the same web app URL, so nothing in the
site needs to change. (If you create a brand-new deployment instead, update
`SCRIPT_URL` in `photos.js`, `rsvp.js`, `tennis.js` and `tennis-admin.js`.)

Until this is done, the page shows "Photo sharing is almost ready".

## How it works

- **Upload:** the page asks the script to open a Drive "resumable upload" session,
  then sends the file straight to Drive. If a browser can't do that, it falls back
  to sending the file through the script in 4 MB pieces (slower, same result).
- **Ordering:** the capture time is read from each photo's EXIF data (or the
  video's metadata) in the browser before upload. Files without one fall back to
  Drive's own photo metadata, and otherwise appear at the end of "Additional"
  in upload order.
- **Sections** (Paris time):
  | Section | Time |
  |---|---|
  | Arriving in Côte d'Azur | before Fri 18:00 |
  | Welcome to La Napoule | Fri 18:00 – Sat 08:30 |
  | Olsen-Keating Open at Barbossi | Sat 08:30 – 13:00 |
  | Wedding Celebration | Sat 13:00 – Sun 06:00 |
  | Sunday Funday | Sun 06:00 – Mon 06:00 |
  | Additional | after Mon 06:00, plus undated |
- **Duplicates** of a file already in the folder are skipped.
- **Deleting:** guests can delete their own uploads from the same device (this
  moves the file to your Drive trash). You can remove anything directly in Drive;
  the page picks up changes within about a minute.
- Uploaded files are renamed with their capture time
  (e.g. `2026-09-12 17.31.02 - IMG_1234.HEIC`) so the Drive folder sorts
  chronologically too, and the description says who shared it.
- Files you add to the folder directly in Drive also show up on the page.

## Limits

- Videos up to 90 seconds; photos up to 100 MB, videos up to 2 GB.
- Uploads count against the Drive storage of the account that owns the script.
