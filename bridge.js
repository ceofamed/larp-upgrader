// Мост между попапом (chrome.runtime) и main.js (MAIN-мир страницы) через DOM-события.
(function() {
  'use strict';

  chrome.runtime.onMessage.addListener(function(msg, sender, sendResponse) {
    if (!msg || !msg.type) return;

    if (msg.type === 'UC_SET_BALANCE') {
      document.dispatchEvent(new CustomEvent('uc-cmd', { detail: { type: 'set-bal', balance: msg.balance } }));
      sendResponse({ ok: true });
    } else if (msg.type === 'UC_GET_STATE') {
      var answered = false;
      var onState = function(e) {
        answered = true;
        document.removeEventListener('uc-state', onState);
        sendResponse(e.detail || { bal: 0, invCount: 0, histCount: 0 });
      };
      document.addEventListener('uc-state', onState);
      document.dispatchEvent(new CustomEvent('uc-cmd', { detail: { type: 'get-state' } }));
      setTimeout(function() {
        if (!answered) {
          document.removeEventListener('uc-state', onState);
          sendResponse({ bal: 0, invCount: 0, histCount: 0 });
        }
      }, 500);
      return true;
    }
  });
})();
