// Popup-side bridge to the background Calendar gateway.
// Raw OAuth tokens and event data never enter popup code.

function sendRuntimeMessage(message) {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(message, (response) => {
      const runtimeError = chrome.runtime.lastError;
      if (runtimeError) {
        reject(new Error(runtimeError.message));
        return;
      }
      if (response?.error) {
        const error = new Error(response.error);
        error.code = response.code;
        error.userMessage = response.error;
        reject(error);
        return;
      }
      resolve(response);
    });
  });
}

export async function fetchCalendarGroups() {
  const response = await sendRuntimeMessage({ type: 'LIST_CALENDARS' });
  return response?.accounts || [];
}

export async function fetchAllAccountsBusy(windows, timeZone) {
  const response = await sendRuntimeMessage({
    type: 'GET_BUSY',
    windows,
    timeZone,
  });
  return {
    busy: response?.busy || [],
    checkedCount: response?.checkedCount || 0,
  };
}

