const http = require('http');

function get(path) {
  return new Promise((resolve, reject) => {
    const req = http.request({ hostname: 'localhost', port: 8080, path, method: 'GET' }, (res) => {
      let resData = '';
      res.on('data', c => resData += c);
      res.on('end', () => resolve({ status: res.statusCode, body: JSON.parse(resData) }));
    });
    req.on('error', reject);
    req.end();
  });
}

async function test() {
  const resFiltered = await get('/api/v1/cbt/proctor/live-sessions?class=XII%20IPA%201');
  console.log('Filtered by XII IPA 1:', resFiltered.body.data?.map(s => `${s.username} (${s.class_name})`));
}

test();
