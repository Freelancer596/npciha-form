// NPCIH-A: receives one registration row from the website and appends it to this spreadsheet.
// Paste in Extensions > Apps Script, set SECRET, then Deploy > Web app (Execute as: Me, Access: Anyone).
var SECRET = 'PUT-YOUR-OWN-LONG-RANDOM-SECRET-HERE';
var TAB = 'Applications';

function out(o) {
  return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON);
}

function doPost(e) {
  var lock = LockService.getScriptLock();
  try {
    lock.waitLock(20000);
    var d = JSON.parse(e.postData.contents);
    if (!SECRET || d.secret !== SECRET) return out({ ok: false, error: 'bad_secret' });
    if (!d.row || !d.row.length) return out({ ok: false, error: 'no_row' });
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var sh = ss.getSheetByName(TAB) || ss.insertSheet(TAB);
    if (sh.getLastRow() === 0 && d.headers) sh.appendRow(d.headers);
    // avoid duplicates if the same reference number is sent twice
    var ref = String(d.row[0]);
    var last = sh.getLastRow();
    if (ref && last > 1) {
      var refs = sh.getRange(2, 1, last - 1, 1).getValues();
      for (var i = 0; i < refs.length; i++) if (String(refs[i][0]) === ref) return out({ ok: true, duplicate: true });
    }
    // keep CNIC / phone as text so leading zeros are preserved
    sh.getRange(last + 1, 1, 1, d.row.length).setNumberFormat('@');
    sh.getRange(last + 1, 1, 1, d.row.length).setValues([d.row]);
    return out({ ok: true });
  } catch (err) {
    return out({ ok: false, error: String(err).slice(0, 80) });
  } finally {
    try { lock.releaseLock(); } catch (x) {}
  }
}
