# DawgPath

Chrome extension to add the current MyPlan course to a Google Sheet with GPA and COI data from [DawgPath](https://dawgpath.uw.edu).

## How it works

1. **MyPlan** – On a course page, a floating “Add to DawgPath Sheet” button appears. Click it.
2. **DawgPath** – A tab opens, scrapes the course’s GPA-at-threshold % and COI from the page.
3. **Google Form** – The extension submits that row to your form; responses go to your linked Sheet.

If the course was already added, the extension warns before adding again (to avoid duplicates).

## Setup

1. **Install** – Load the `extension` folder as an unpacked extension in Chrome (`chrome://extensions` → Developer mode → Load unpacked).
2. **Google Form** – Create a form with 4 short-answer questions in this order: **Course**, **GPA threshold**, **GPA+ %**, **COI**. Link the form to a Sheet (Responses → Link to Sheets).
3. **Pre-filled link** – In the form: ⋮ → **Get pre-filled link** → enter any value in each of the 4 fields → **Get link** → copy the URL.
4. **Extension popup** – Paste that URL into “Google Sheet via Form”, click **Test form link**, then set your GPA threshold and **Save**.

## Project structure

| File | Role |
|------|------|
| `manifest.json` | Extension manifest (permissions, content scripts, popup). |
| `background.js` | Service worker: form URL handling, Google Form submit, message routing. |
| `popup.html` / `popup.js` | Popup UI: form URL, test link, GPA threshold. |
| `myplan.js` | Content script on MyPlan: injects “Add to DawgPath Sheet” button, warns if already added. |
| `myplan.css` | Styles for the MyPlan button. |
| `dawgpath.js` | Content script on DawgPath: scrapes GPA/COI, sends row to background, then tab closes. |

## Storage (chrome.storage.local)

- `dawgpathFormUrl` – User’s Google Form (pre-filled) URL.
- `dawgpathFormEntryIds` – Cached form entry IDs so we don’t re-parse every submit.
- `dawgpathGpaThreshold` – GPA threshold (e.g. 3.8 for “% at or above 3.8”).
- `dawgpathAddedCourses` – List of course codes successfully added (for “already added” warning).
- `dawgpathPendingTabs` – Map of DawgPath tab id → { notifyTabId, courseCode } for closing and notifying MyPlan.

## Message types (background ↔ content)

- `wasCourseAdded` – Check if a course code is in `dawgpathAddedCourses`.
- `openDawgPath` – Open a DawgPath course tab and record it in `dawgpathPendingTabs`.
- `sheetAddRow` – Submit one row (courseCode, gpaThreshold, gpaPlusPct, coi) to the form; optionally update `dawgpathAddedCourses`.
- `testFormLink` – Validate form URL and return whether we can read 4 entry IDs.
- `closeDawgPathTab` – Close the DawgPath tab and send `dawgPathAdded` to the MyPlan tab.
- `dawgPathAdded` – Sent to MyPlan tab: show “Added X to Sheet” toast.

## License
MIT