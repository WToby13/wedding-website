# RSVP Form Setup Instructions

## Overview
Your RSVP form is now ready! All buttons (RSVP, Tennis Tournament, Sunbeds) on your website now link to `/rsvp`. You just need to connect it to your Google Sheets.

## Step 1: Set Up Google Apps Script

1. **Open Google Apps Script**
   - Go to https://script.google.com/
   - Sign in with your Google account

2. **Create New Project**
   - Click "New Project"
   - Delete the default code

3. **Copy the Script**
   - Open `google-apps-script.js` from your project folder
   - Copy ALL the code
   - Paste it into the Google Apps Script editor

4. **The script is already configured** with your spreadsheet ID:
   - Spreadsheet ID: `1FGu1xPLQZQy4zc4Yr-SKBhyTmTc3RBynhZR7dOVT-iE`
   - Sheet Name: `RSVP Responses`

5. **Save the Project**
   - Click "Save" (💾 icon) or press Ctrl+S / Cmd+S
   - Give it a name like "Wedding RSVP Form"

## Step 2: Deploy as Web App

1. **Deploy**
   - Click "Deploy" > "New deployment"
   - Click the gear icon ⚙️ (settings)

2. **Configure Deployment**
   - **Type**: Select "Web app"
   - **Description**: "RSVP Form Handler"
   - **Execute as**: "Me" (your Google account)
   - **Who has access**: "Anyone" (important!)
   - Click "Deploy"

3. **Authorize Access** (first time only)
   - Click "Authorize access"
   - Choose your Google account
   - Click "Advanced" > "Go to [Project Name] (unsafe)"
   - Click "Allow"
   - You'll see "This app isn't verified" - that's okay for personal use

4. **Copy the Web App URL**
   - After deployment, you'll see a Web app URL
   - It looks like: `https://script.google.com/macros/s/AKfycby.../exec`
   - **COPY THIS URL** - you'll need it in the next step

## Step 3: Update the RSVP Form

1. **Open `rsvp.js`**
2. **Find this line** (around line 49):
   ```javascript
   const scriptURL = 'YOUR_GOOGLE_APPS_SCRIPT_URL';
   ```
3. **Replace it** with your actual URL:
   ```javascript
   const scriptURL = 'https://script.google.com/macros/s/YOUR_ACTUAL_URL/exec';
   ```
4. **Save the file**

## Step 4: Test the Form

1. **Deploy your changes** to your website (if using Git/Vercel)
2. **Visit** `olsenkeating.com/rsvp`
3. **Fill out the form** and submit
4. **Check your Google Sheet** - you should see a new row with the data!

## Data Format

Submissions will be added to your Google Sheet with these columns:
- **Guest Name**
- **Joining** (Yes/No)
- **Dietary considerations**
- **Tennis Tournament** (Yes (as a player) / Yes (as a spectator) / No)
- **Sunday Sunbeds** (Yes/No)
- **Notes** (Message to bride & groom)
- **Timestamp**

## Troubleshooting

**Form not submitting?**
- Check that the Google Apps Script URL is correct in `rsvp.js`
- Make sure the Web app is set to "Anyone" access
- Check the browser console for errors (F12)

**Data not appearing in Sheets?**
- Verify the sheet tab is named exactly "RSVP Responses"
- Check that the Apps Script has permission to access your spreadsheet
- Look at the Apps Script execution log (View > Executions)

**Need help?**
Contact: olsenandrea96@gmail.com

