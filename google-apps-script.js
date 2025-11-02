/**
 * Google Apps Script for RSVP Form
 * 
 * INSTRUCTIONS:
 * 1. Go to https://script.google.com/
 * 2. Click "New Project"
 * 3. Delete the default code and paste this entire script
 * 4. Replace 'YOUR_SPREADSHEET_ID' with your actual spreadsheet ID
 *    (The ID is in your spreadsheet URL: /d/[THIS_IS_THE_ID]/edit)
 * 5. Replace 'YOUR_SHEET_NAME' with "RSVP Responses" (or the name of your sheet tab)
 * 6. Click "Deploy" > "New deployment"
 * 7. Click the gear icon ⚙️ and select "Web app"
 * 8. Set "Execute as" to "Me"
 * 9. Set "Who has access" to "Anyone"
 * 10. Click "Deploy"
 * 11. Copy the Web app URL and paste it into rsvp.js replacing 'YOUR_GOOGLE_APPS_SCRIPT_URL'
 */

function doPost(e) {
  try {
    // Parse the JSON data
    const data = JSON.parse(e.postData.contents);
    
    // Get your spreadsheet ID from the URL
    // https://docs.google.com/spreadsheets/d/[SPREADSHEET_ID]/edit
    const SPREADSHEET_ID = '1FGu1xPLQZQy4zc4Yr-SKBhyTmTc3RBynhZR7dOVT-iE';
    const SHEET_NAME = 'RSVP Responses';
    
    // Open the spreadsheet
    const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
    let sheet = ss.getSheetByName(SHEET_NAME);
    
    // If sheet doesn't exist, create it
    if (!sheet) {
      sheet = ss.insertSheet(SHEET_NAME);
      // Add headers
      sheet.appendRow(['Guest Name', 'Joining', 'Dietary considerations', 'Tennis Tournament', 'Sunday Sunbeds', 'Notes', 'Timestamp']);
    }
    
    // Prepare the row data matching your spreadsheet columns
    const rowData = [
      data.guestName || '',
      data.joining || '',
      data.dietary || '',
      data.tennis || '',
      data.sunbeds || '',
      data.message || '',
      new Date().toLocaleString()
    ];
    
    // Append the row
    sheet.appendRow(rowData);
    
    // Return success response (even though no-cors mode won't show it)
    return ContentService.createTextOutput(JSON.stringify({
      success: true,
      message: 'RSVP submitted successfully'
    })).setMimeType(ContentService.MimeType.JSON);
    
  } catch (error) {
    // Log error
    console.error('Error:', error);
    
    // Return error response
    return ContentService.createTextOutput(JSON.stringify({
      success: false,
      error: error.toString()
    })).setMimeType(ContentService.MimeType.JSON);
  }
}

// Test function (optional - for testing)
function testDoPost() {
  const mockData = {
    guestName: 'Test Guest',
    joining: 'Yes',
    dietary: 'Vegetarian',
    tennis: 'Yes (as a player)',
    sunbeds: 'Yes',
    message: 'Test message'
  };
  
  const mockEvent = {
    postData: {
      contents: JSON.stringify(mockData)
    }
  };
  
  doPost(mockEvent);
}

