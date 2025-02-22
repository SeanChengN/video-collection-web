// 通用API调用函数
async function callApi(eventId, data = {}, method = 'POST') {
  try {
    const response = await fetch('/api', {
      method: 'POST', // 这里统一用POST请求
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        e: eventId,
        d: data,
        m: method // 原始method作为参数传递
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

window.callApi = callApi;
