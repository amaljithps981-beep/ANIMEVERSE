const puppeteer = require('puppeteer');

(async () => {
  const browser = await puppeteer.launch({ headless: 'new' });
  const page = await browser.newPage();
  
  // Set console listener to catch errors
  page.on('console', msg => console.log('PAGE LOG:', msg.text()));
  page.on('pageerror', error => console.log('PAGE ERROR:', error.message));

  try {
      await page.goto('http://localhost:3000/profile.html', { waitUntil: 'networkidle2', timeout: 15000 });
      await page.screenshot({ path: 'profile_test.png', fullPage: true });
      console.log('Screenshot taken successfully.');
  } catch (err) {
      console.error('Error during execution:', err);
  } finally {
      await browser.close();
  }
})();
