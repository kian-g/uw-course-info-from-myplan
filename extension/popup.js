/**
 * popup.js — Extension popup (click extension icon)
 *
 * Form URL input (saved to storage; clears cached entry IDs on change), Test form link,
 * and GPA threshold selector. Loads/saves dawgpathGpaThreshold and dawgpathFormUrl.
 */

const gpaOptions = [0];
for (let g = 0.7; g <= 4.0; g += 0.1) {
  gpaOptions.push(Math.round(g * 10) / 10);
}

const select = document.getElementById('gpaThreshold');
gpaOptions.forEach((val) => {
  const opt = document.createElement('option');
  opt.value = val;
  opt.textContent = val === 0 ? '0' : val.toFixed(1);
  select.appendChild(opt);
});

document.getElementById('save').addEventListener('click', () => {
  const threshold = parseFloat(document.getElementById('gpaThreshold').value, 10);
  chrome.storage.local.set({
    dawgpathGpaThreshold: Number.isFinite(threshold) ? threshold : 3.8
  }, () => {
    const el = document.getElementById('saved');
    el.classList.add('is-visible');
    setTimeout(() => el.classList.remove('is-visible'), 1500);
  });
});

chrome.storage.local.get(['dawgpathGpaThreshold', 'dawgpathFormUrl'], (data) => {
  const t = data.dawgpathGpaThreshold;
  const threshold = Number.isFinite(t) ? t : 3.8;
  const match = gpaOptions.find((v) => v === threshold);
  if (match !== undefined) select.value = match;
  else select.value = 3.8;
  const formUrlEl = document.getElementById('formUrl');
  if (formUrlEl && data.dawgpathFormUrl) formUrlEl.value = data.dawgpathFormUrl;
});

/** Persist form URL and clear cached entry IDs so next submit re-parses. */
function saveFormUrl() {
  const v = document.getElementById('formUrl').value.trim();
  chrome.storage.local.set({ dawgpathFormUrl: v || null });
  chrome.storage.local.remove('dawgpathFormEntryIds');
}
document.getElementById('formUrl').addEventListener('input', saveFormUrl);
document.getElementById('formUrl').addEventListener('change', saveFormUrl);

document.getElementById('testFormLink').addEventListener('click', () => {
  const url = document.getElementById('formUrl').value.trim();
  const resultEl = document.getElementById('formTestResult');
  resultEl.textContent = 'Checking…';
  resultEl.className = 'form-hint form-test-pending';
  chrome.runtime.sendMessage({ type: 'testFormLink', formUrl: url }, (r) => {
    if (chrome.runtime.lastError) {
      resultEl.textContent = 'Error: ' + chrome.runtime.lastError.message;
      resultEl.className = 'form-hint form-test-error';
      return;
    }
    if (r && r.ok) {
      resultEl.textContent = r.message || 'Form link OK.';
      resultEl.className = 'form-hint form-test-ok';
    } else {
      resultEl.textContent = r?.error || 'Form link failed.';
      resultEl.className = 'form-hint form-test-error';
    }
  });
});
