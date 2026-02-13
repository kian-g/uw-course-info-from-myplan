/**
 * myplan.js — Content script on https://myplan.uw.edu/*
 *
 * Injects "Add to DawgPath Sheet" when the URL is a course page (hash or path).
 * On click: checks if course already added (confirm), then asks background to open
 * DawgPath tab. Listens for dawgPathAdded to show success toast.
 */
(function () {
  /** Course code from URL: #/courses/CODE or /course(s)/CODE. */
  function getCourseFromUrl() {
    const hash = window.location.hash || '';
    let match = hash.match(/\/courses\/([^/?]+)/);
    if (match) return decodeURIComponent(match[1].replace(/\+/g, ' ')).trim();
    const path = window.location.pathname || '';
    match = path.match(/\/course[s]?\/([^/?]+)/i);
    if (match) return decodeURIComponent(match[1].replace(/\+/g, ' ')).trim();
    return null;
  }

  /** Build DawgPath course URL. id=MATH+126 (literal +); from=ext so dawgpath.js only runs when we opened the tab. */
  function buildDawgPathUrl(courseCode) {
    const id = encodeURIComponent(courseCode).replace(/%20/g, '+');
    return `https://dawgpath.uw.edu/course?id=${id}&from=ext`;
  }

  function showToast(message) {
    const toast = document.createElement('div');
    toast.className = 'dawgpath-toast';
    toast.textContent = message;
    document.body.appendChild(toast);
    setTimeout(() => toast.remove(), 5000);
  }

  /** Inject floating button if we're on a course page and button not already there. */
  function addButton() {
    if (document.getElementById('dawgpath-sheet-btn')) return;
    const course = getCourseFromUrl();
    if (!course) return;

    const btn = document.createElement('button');
    btn.id = 'dawgpath-sheet-btn';
    btn.textContent = 'Add to DawgPath Sheet';
    btn.title = 'Open DawgPath, scrape GPA and COI, add row to your Sheet';
    btn.addEventListener('click', async () => {
      const courseNow = getCourseFromUrl();
      if (!courseNow) {
        showToast('Could not detect course from URL. Refresh and try again.');
        return;
      }
      try {
        const alreadyAdded = await new Promise((resolve) => {
          chrome.runtime.sendMessage({ type: 'wasCourseAdded', courseCode: courseNow }, (r) => {
            resolve(r && r.added);
          });
        });
        if (alreadyAdded && !confirm(`${courseNow} is already in your Sheet. Adding again will make it show up twice. Add again anyway?`)) {
          return;
        }
      } catch (e) {
        if (e.message && e.message.includes('Extension context invalidated')) {
          showToast('Extension was reloaded. Refresh this page (F5) and try again.');
          return;
        }
      }
      btn.classList.add('adding');
      btn.textContent = 'Adding…';
      try {
        chrome.runtime.sendMessage({
          type: 'openDawgPath',
          courseCode: courseNow,
          url: buildDawgPathUrl(courseNow)
        });
      } catch (e) {
        if (e.message && e.message.includes('Extension context invalidated')) {
          showToast('Extension was reloaded. Refresh this page (F5) and try again.');
        } else {
          showToast('Something went wrong. Try refreshing the page.');
        }
      }
      btn.textContent = 'Add to DawgPath Sheet';
      btn.classList.remove('adding');
    });
    document.body.appendChild(btn);
  }

  function onHashChange() {
    addButton();
  }

  /** Initial run; retry addButton in case course appears in URL after SPA load. */
  function run() {
    addButton();
    if (!document.getElementById('dawgpath-sheet-btn')) {
      setTimeout(addButton, 500);
      setTimeout(addButton, 2000);
    }
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', run);
  } else {
    run();
  }
  window.addEventListener('hashchange', onHashChange);
  window.addEventListener('popstate', addButton);

  chrome.runtime.onMessage.addListener((msg) => {
    if (msg.type === 'dawgPathAdded' && msg.courseCode) {
      showToast(`Added ${msg.courseCode} to Sheet`);
    }
  });
})();
