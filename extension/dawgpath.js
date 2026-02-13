/**
 * dawgpath.js — Content script on https://dawgpath.uw.edu/course*
 *
 * Only runs when the tab was opened by the extension (?from=ext). Waits for COI and
 * GPA graph, scrapes values, sends sheetAddRow to background, then closeDawgPathTab.
 * Background submits to the user's Google Form and closes this tab.
 */
(function () {
  /** Course code from query param ?id=MATH+126. */
  function getCourseFromPageUrl() {
    const params = new URLSearchParams(window.location.search);
    const id = params.get('id');
    if (!id) return null;
    return id.replace(/\+/g, ' ').trim();
  }

  /** Only run automation when we opened this tab from MyPlan (avoids running on user-opened DawgPath). */
  function isExtensionOpenedTab() {
    return new URLSearchParams(window.location.search).get('from') === 'ext';
  }

  function parseScoreString(s) {
    if (!s || typeof s !== 'string') return NaN;
    const normalized = s.trim().replace(/\u2212/g, '-');
    return parseFloat(normalized, 10);
  }

  function scrapeCOI() {
    const el = document.querySelector('#score');
    if (!el) return null;
    if (el.title) {
      const m = el.title.match(/COI score of ([-\u2212]?\d+\.?\d*)/);
      if (m) {
        const n = parseScoreString(m[1]);
        if (Number.isFinite(n)) return n;
      }
    }
    const n = parseScoreString(el.textContent);
    return Number.isFinite(n) ? n : null;
  }

  function waitForCOI(ms = 6000) {
    return new Promise((resolve) => {
      const start = Date.now();
      const go = () => {
        const coi = scrapeCOI();
        if (coi !== null) {
          resolve();
          return;
        }
        if (Date.now() - start >= ms) {
          resolve();
          return;
        }
        setTimeout(go, 350);
      };
      go();
    });
  }

  /** Percentage of GPA distribution at or above threshold (from bar heights in #gcd-graph). */
  function scrapeGpaPlusPct(threshold) {
    const svg = document.querySelector('#gcd-graph svg');
    if (!svg) return null;
    const bars = Array.from(svg.querySelectorAll('rect.bar'));
    if (bars.length < 2) return null;
    const heights = bars.map((r) => {
      const h = parseFloat(r.getAttribute('height'), 10);
      return Number.isFinite(h) ? h : 0;
    });
    const total = heights.reduce((a, b) => a + b, 0);
    if (total <= 0) return null;
    const t = Number.isFinite(threshold) ? threshold : 3.8;
    const numBars = Math.max(1, Math.round((4.0 - t) / 0.1) + 1);
    const lastN = heights.slice(-numBars).reduce((a, b) => a + b, 0);
    return (lastN / total) * 100;
  }

  function showToast(message) {
    const toast = document.createElement('div');
    toast.className = 'dawgpath-toast';
    toast.textContent = message;
    document.body.appendChild(toast);
    setTimeout(() => toast.remove(), 3000);
  }

  function waitForElements(ms = 10000) {
    return new Promise((resolve) => {
      const check = () => {
        if (document.querySelector('#score') && document.querySelector('#gcd-graph svg')) {
          return true;
        }
        return false;
      };
      if (check()) {
        resolve();
        return;
      }
      const interval = setInterval(() => {
        if (check()) {
          clearInterval(interval);
          resolve();
        }
      }, 300);
      setTimeout(() => {
        clearInterval(interval);
        resolve();
      }, ms);
    });
  }

  /** Wait for DOM, scrape COI and GPA %, send row to background, then request tab close. */
  async function run() {
    if (!isExtensionOpenedTab()) return;
    const courseCode = getCourseFromPageUrl();
    if (!courseCode) return;

    const { dawgpathGpaThreshold } = await chrome.storage.local.get(['dawgpathGpaThreshold']);
    const threshold = Number.isFinite(dawgpathGpaThreshold) ? dawgpathGpaThreshold : 3.8;

    await waitForElements();
    await waitForCOI();

    const coi = scrapeCOI();
    const gpaPlusPct = scrapeGpaPlusPct(threshold);
    const gpaRounded = gpaPlusPct != null ? Math.round(gpaPlusPct * 100) / 100 : null;
    const coiVal = coi != null ? coi : null;

    chrome.runtime.sendMessage({
      type: 'sheetAddRow',
      courseCode,
      gpaThreshold: threshold,
      gpaPlusPct: gpaRounded,
      coi: coiVal
    }, (response) => {
      if (chrome.runtime.lastError) {
        showToast('Extension error. Try reloading the extension.');
        return;
      }
      if (response && response.ok) {
        if (response.formError) {
          showToast(response.formError);
        }
        chrome.runtime.sendMessage({ type: 'closeDawgPathTab', courseCode });
      } else {
        const msg = response?.error || 'Save failed.';
        showToast(msg);
      }
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', run);
  } else {
    run();
  }
})();
