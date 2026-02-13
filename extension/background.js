/**
 * background.js — Extension service worker
 *
 * Handles: Google Form URL normalization, entry ID parsing (prefilled URL or form HTML),
 * form submission (POST with GET fallback), and message routing for MyPlan/DawgPath tabs.
 * Storage: dawgpathFormUrl, dawgpathFormEntryIds, dawgpathAddedCourses, dawgpathPendingTabs.
 */

// --- Google Form URL helpers ---

/** Convert edit URL to viewform; leave viewform/prefilled URLs unchanged. */
function normalizeFormUrl(url) {
  const s = (url || '').trim();
  if (!s) return null;
  if (/\/edit\/?(\?.*)?$/i.test(s)) {
    return s.replace(/\/edit\/?(\?.*)?$/i, '/viewform');
  }
  return s;
}

/** Derive the formResponse submit URL from a viewform (or edit) URL. */
function formViewToSubmitUrl(viewUrl) {
  const normalized = normalizeFormUrl(viewUrl);
  if (!normalized) return null;
  const formResponse = normalized.replace(/\/viewform.*$/i, '/formResponse');
  return formResponse !== normalized && formResponse.includes('/formResponse') ? formResponse : null;
}

/** Parse entry.XXX from a prefilled form URL query string; return first 4 in order. */
function parseEntryIdsFromPrefilledUrl(url) {
  try {
    const u = new URL(url);
    const ids = [];
    u.searchParams.forEach((_, key) => {
      const m = /^entry\.(\d+)$/i.exec(key);
      if (m) ids.push(m[1]);
    });
    return ids.length >= 4 ? ids.slice(0, 4) : [];
  } catch (e) {
    return [];
  }
}

/** Fallback: scrape entry IDs from form page HTML (name="entry.N" or entry.N in script/data). */
function parseEntryIdsFromFormHtml(html) {
  let ids = [];
  const nameRe = /name="entry\.(\d+)"/g;
  let m;
  while ((m = nameRe.exec(html)) !== null) ids.push(m[1]);
  if (ids.length >= 4) return ids;
  ids = [];
  const anyRe = /entry\.(\d+)/g;
  const seen = new Set();
  while ((m = anyRe.exec(html)) !== null) {
    if (!seen.has(m[1])) { seen.add(m[1]); ids.push(m[1]); }
    if (ids.length >= 4) break;
  }
  return ids;
}

async function getFormEntryIds(formViewUrl) {
  const normalizedUrl = normalizeFormUrl(formViewUrl) || formViewUrl;
  const baseUrl = normalizedUrl.split('?')[0];
  const cached = await chrome.storage.local.get(['dawgpathFormEntryIds', 'dawgpathFormUrl']);
  if (cached.dawgpathFormUrl === baseUrl && Array.isArray(cached.dawgpathFormEntryIds) && cached.dawgpathFormEntryIds.length >= 4) {
    return cached.dawgpathFormEntryIds.slice(0, 4);
  }
  const fromPrefilled = parseEntryIdsFromPrefilledUrl(formViewUrl);
  if (fromPrefilled.length >= 4) {
    await chrome.storage.local.set({ dawgpathFormUrl: baseUrl, dawgpathFormEntryIds: fromPrefilled.slice(0, 4) });
    return fromPrefilled.slice(0, 4);
  }
  try {
    const res = await fetch(baseUrl, { method: 'GET', credentials: 'omit' });
    const html = await res.text();
    const ids = parseEntryIdsFromFormHtml(html);
    if (ids.length >= 4) {
      await chrome.storage.local.set({ dawgpathFormUrl: baseUrl, dawgpathFormEntryIds: ids.slice(0, 4) });
      return ids.slice(0, 4);
    }
  } catch (e) {}
  return null;
}

/** Submit one row to the Google Form (POST, then GET if POST fails). */
async function submitRowToForm(formViewUrl, row) {
  const submitUrl = formViewToSubmitUrl(formViewUrl);
  if (!submitUrl) return { ok: false, error: 'Use the form’s link (Send → link icon), not the edit address.' };
  const entryIds = await getFormEntryIds(formViewUrl);
  if (!entryIds || entryIds.length < 4) return { ok: false, error: 'Use a pre-filled link: form ⋮ → Get pre-filled link → fill each field → Get link → paste here.' };
  const [eCourse, eGpaThresh, eGpaPct, eCoi] = entryIds;
  const params = new URLSearchParams({
    ['entry.' + eCourse]: String(row.courseCode ?? ''),
    ['entry.' + eGpaThresh]: String(row.gpaThreshold ?? ''),
    ['entry.' + eGpaPct]: String(row.gpaPlusPct ?? ''),
    ['entry.' + eCoi]: String(row.coi ?? '')
  });
  const body = params.toString();
  const getUrl = submitUrl + (submitUrl.includes('?') ? '&' : '?') + body;
  try {
    const res = await fetch(submitUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body
    });
    if (res.ok) return { ok: true };
  } catch (e) {}
  try {
    const resGet = await fetch(getUrl, { method: 'GET', credentials: 'omit' });
    return { ok: resGet.ok };
  } catch (e) {
    return { ok: false, error: (e && e.message) || 'Form submit failed' };
  }
}

// --- Message handlers ---

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  /** Check if this course was already successfully added (for duplicate warning). */
  if (msg.type === 'wasCourseAdded') {
    const key = String(msg.courseCode || '').trim();
    chrome.storage.local.get(['dawgpathAddedCourses'], (data) => {
      const list = Array.isArray(data.dawgpathAddedCourses) ? data.dawgpathAddedCourses : [];
      const added = list.some((c) => String(c).trim() === key);
      sendResponse({ added });
    });
    return true;
  }
  /** Open DawgPath tab and record it so we can close it and notify MyPlan when done. */
  if (msg.type === 'openDawgPath') {
    chrome.tabs.create({ url: msg.url, active: false }, (tab) => {
      if (tab?.id != null && sender.tab?.id != null) {
        chrome.storage.local.get(['dawgpathPendingTabs'], (data) => {
          const map = data.dawgpathPendingTabs && typeof data.dawgpathPendingTabs === 'object' ? data.dawgpathPendingTabs : {};
          map[tab.id] = { notifyTabId: sender.tab.id, courseCode: msg.courseCode };
          chrome.storage.local.set({ dawgpathPendingTabs: map });
        });
      }
      sendResponse({ ok: true });
    });
    return true;
  }
  /** Submit scraped row to user's Google Form; track course in dawgpathAddedCourses on success. */
  if (msg.type === 'sheetAddRow') {
    const row = {
      courseCode: msg.courseCode,
      gpaThreshold: msg.gpaThreshold,
      gpaPlusPct: msg.gpaPlusPct,
      coi: msg.coi
    };
    chrome.storage.local.get(['dawgpathFormUrl'], async (data) => {
      const formUrl = (data.dawgpathFormUrl || '').trim();
      let formResult = null;
      if (formUrl) {
        formResult = await submitRowToForm(formUrl, row);
      } else {
        formResult = { ok: false, error: 'Set form link in extension popup first.' };
      }
      if (formResult && formResult.ok) {
        chrome.storage.local.get(['dawgpathAddedCourses'], (d) => {
          const list = Array.isArray(d.dawgpathAddedCourses) ? d.dawgpathAddedCourses : [];
          const key = String(msg.courseCode || '').trim();
          if (key && !list.some((c) => String(c).trim() === key)) {
            chrome.storage.local.set({ dawgpathAddedCourses: [...list, key] });
          }
        });
      }
      sendResponse({
        ok: true,
        formOk: formResult ? formResult.ok : null,
        formError: formResult && !formResult.ok ? formResult.error : null
      });
    });
    return true;
  }
  /** Popup "Test form link": validate URL and that we can read 4 entry IDs. */
  if (msg.type === 'testFormLink') {
    const formUrl = (msg.formUrl || '').trim();
    if (!formUrl) {
      sendResponse({ ok: false, error: 'Paste a form URL first.' });
      return true;
    }
    (async () => {
      const submitUrl = formViewToSubmitUrl(formUrl);
      if (!submitUrl) {
        sendResponse({ ok: false, error: 'Use the form’s Send link (click Send → copy link), not the edit address.' });
        return;
      }
      const entryIds = await getFormEntryIds(formUrl);
      if (!entryIds || entryIds.length < 4) {
        sendResponse({ ok: false, error: 'Use a pre-filled link: in the form click ⋮ → Get pre-filled link → enter any value in each of the 4 fields → Get link → paste that URL here.' });
        return;
      }
      sendResponse({ ok: true, message: 'Form link OK. ' + entryIds.length + ' fields found.' });
    })();
    return true;
  }
  /** DawgPath tab finished: close it and tell MyPlan tab to show "Added X to Sheet". */
  if (msg.type === 'closeDawgPathTab' && sender.tab?.id) {
    const tabIdToClose = sender.tab.id;
    chrome.storage.local.get(['dawgpathPendingTabs'], (data) => {
      const map = data.dawgpathPendingTabs && typeof data.dawgpathPendingTabs === 'object' ? data.dawgpathPendingTabs : {};
      const entry = map[tabIdToClose];
      delete map[tabIdToClose];
      chrome.storage.local.set({ dawgpathPendingTabs: map });
      if (entry?.notifyTabId != null) {
        chrome.tabs.sendMessage(entry.notifyTabId, { type: 'dawgPathAdded', courseCode: msg.courseCode }).catch(() => {});
      }
      chrome.tabs.remove(tabIdToClose).catch(() => {});
    });
    sendResponse({ ok: true });
    return true;
  }
});
