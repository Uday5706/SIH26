const puppeteer = require('puppeteer');
const path = require('path');

(async () => {
  console.log('Launching headless browser...');
  const browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--enable-webgl', '--use-gl=swiftshader']
  });
  const page = await browser.newPage();
  
  // Expose console logs and errors
  page.on('console', msg => console.log('PAGE LOG:', msg.text()));
  page.on('pageerror', err => console.log('PAGE ERROR:', err.toString()));
  page.on('requestfailed', request => console.log('REQUEST FAILED:', request.url(), request.failure().errorText));
  
  const url = 'http://localhost:8000/tests/benchmark.html';
  console.log('Navigating to', url);
  await page.goto(url, { waitUntil: 'networkidle0' });

  console.log('Running ML Benchmark...');
  await page.click('#btn-benchmark-ml');
  
  // Wait for completion
  await page.waitForFunction(
    () => document.getElementById('logWindow').textContent.includes('🎉 ML Benchmarks Completed.'),
    { timeout: 60000 }
  );

  const logs = await page.evaluate(() => document.getElementById('logWindow').textContent);
  console.log('\\n=== BENCHMARK RESULTS ===\\n');
  console.log(logs);

  await browser.close();
})();
