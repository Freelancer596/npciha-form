// NPCIH-A: receives the member list from the website and keeps this spreadsheet in sync.
// The website sends mode:'replace' (header + ALL members, with full district/province names) on every new
// registration and every approve / reject / edit / delete: the whole tab is rewritten each time.
// Paste in Extensions > Apps Script, set SECRET, then Deploy > Web app (Execute as: Me, Access: Anyone).
var SECRET = 'PUT-YOUR-OWN-LONG-RANDOM-SECRET-HERE';
var TAB = 'Applications';

function out(o) {
  return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON);
}

// Open the Web app URL in a browser: you should see {"ok":true,"status":"alive"} (no login page).
function doGet() {
  return out({ ok: true, status: 'alive' });
}

function doPost(e) {
  var lock = LockService.getScriptLock();
  try {
    lock.waitLock(25000);
    var d = JSON.parse(e.postData.contents);
    if (!SECRET || d.secret !== SECRET) return out({ ok: false, error: 'bad_secret' });
    var rows = d.rows && d.rows.length ? d.rows : (d.row && d.row.length ? [d.row] : []);
    var ss0 = SpreadsheetApp.getActiveSpreadsheet();
    if (d.mode === 'replace') {                       // full refresh of the member rows
      var sh0 = ss0.getSheetByName(TAB) || ss0.insertSheet(TAB);
      var width0 = d.headers.length, data = d.rows || [];
      // the tab may have its own banner / totals above the table: find the header row ("Reference No") and
      // rewrite only the rows below it, leaving everything above (title, totals, header text, colours) alone
      var colA = sh0.getRange(1, 1, Math.min(30, sh0.getMaxRows()), 1).getValues(), headerRow = 0, anyText = false;
      for (var k = 0; k < colA.length; k++) {
        var cellText = String(colA[k][0]).replace(/[\u200e\u200f\s]+/g, ' ').trim().toLowerCase();
        if (cellText) anyText = true;
        if (cellText === 'reference no') { headerRow = k + 1; break; }
      }
      if (!headerRow) {
        if (anyText) return out({ ok: false, error: 'header_row_not_found' });   // never overwrite unknown content
        sh0.getRange(1, 1, 1, width0).setValues([d.headers]).setFontWeight('bold');
        headerRow = 1;
      }
      var start = headerRow + 1;
      if (data.length) {
        var rng0 = sh0.getRange(start, 1, data.length, width0);
        rng0.setNumberFormat('@');                    // keep CNIC / phone / dates exactly as sent (text)
        rng0.setValues(data);
      }
      var lastRow = sh0.getLastRow(), after = start + data.length;
      if (lastRow >= after) sh0.getRange(after, 1, lastRow - after + 1, width0).clearContent();
      return out({ ok: true, mode: 'replace', written: data.length });
    }
    if (!rows.length) return out({ ok: false, error: 'no_row' });
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var sh = ss.getSheetByName(TAB) || ss.insertSheet(TAB);
    if (sh.getLastRow() === 0 && d.headers) sh.appendRow(d.headers);
    var last = sh.getLastRow();
    var seen = {};
    if (last > 1) {
      var refs = sh.getRange(2, 1, last - 1, 1).getValues();
      for (var i = 0; i < refs.length; i++) seen[String(refs[i][0])] = true;
    }
    var fresh = [];
    for (var j = 0; j < rows.length; j++) {
      var ref = String(rows[j][0]);
      if (ref && seen[ref]) continue;      // already in the sheet: never duplicate
      seen[ref] = true;
      fresh.push(rows[j]);
    }
    if (fresh.length) {
      var width = fresh[0].length;
      var rng = sh.getRange(last + 1, 1, fresh.length, width);
      rng.setNumberFormat('@');            // keep CNIC / phone as text (leading zeros)
      rng.setValues(fresh);
    }
    return out({ ok: true, added: fresh.length, skipped: rows.length - fresh.length });
  } catch (err) {
    return out({ ok: false, error: String(err).slice(0, 80) });
  } finally {
    try { lock.releaseLock(); } catch (x) {}
  }
}
