// recipes/apple-notes-import/extract-notes.js
// Extracts all notes from Apple Notes.app using JXA (JavaScript for Automation).
//
// Usage:
//   osascript -l JavaScript extract-notes.js > notes-export.json
//
// macOS will prompt for automation permissions the first time you run this.
// Notes.app must be installed (built-in on all Macs).
// Both "On My Mac" and iCloud accounts are exported.

ObjC.import('Foundation');

const notesApp = Application('Notes');
const results = [];
const skipped = [];

for (const account of notesApp.accounts()) {
  const accountName = account.name();

  for (const folder of account.folders()) {
    const folderName = folder.name();

    for (const note of folder.notes()) {
      try {
        results.push({
          id: note.id(),
          title: note.name(),
          body: note.body(),
          folder: folderName,
          account: accountName,
          created: note.creationDate().toISOString(),
          modified: note.modificationDate().toISOString(),
        });
      } catch (e) {
        // Password-protected notes throw on .body() — skip silently
        skipped.push({ title: note.name(), folder: folderName, reason: 'protected' });
      }
    }
  }
}

// Append skipped-count metadata as the final element.
// The importer strips any element containing _skipped before processing.
results.push({ _skipped: skipped.length, _skipped_titles: skipped.map(s => s.title) });

JSON.stringify(results);
