function getCsrfToken() {
  const meta = document.querySelector('meta[name="csrf-token"]');
  return meta ? meta.getAttribute('content') || '' : '';
}

function getCsrfHeaders() {
  const token = getCsrfToken();
  return token ? { 'X-CSRF-Token': token } : {};
}

async function callApi(eventId, data = {}, method = 'POST') {
  try {
    const response = await fetch('/api', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...getCsrfHeaders()
      },
      body: JSON.stringify({
        e: eventId,
        d: data,
        m: method
      })
    });
    return response.json();
  } catch (error) {
    return {
      success: false,
      message: error.message
    };
  }
}

window.getCsrfToken = getCsrfToken;
window.getCsrfHeaders = getCsrfHeaders;
window.callApi = callApi;
