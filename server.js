const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = 3000;
const PUBLIC_DIR = __dirname; // Serves the current directory

const MIME_TYPES = {
    '.html': 'text/html',
    '.css': 'text/css',
    '.js': 'application/javascript',
    '.json': 'application/json',
    '.png': 'image/png',
    '.jpg': 'image/jpg',
    '.gif': 'image/gif',
    '.svg': 'image/svg+xml',
};

const server = http.createServer(async (req, res) => {
    console.log(`${req.method} ${req.url}`);

    if (req.url.startsWith('/api/check-youtube-embed')) {
        const urlParams = new URLSearchParams(req.url.split('?')[1]);
        const videoId = urlParams.get('id');
        if (!videoId) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Missing id parameter' }));
            return;
        }

        try {
            const checkUrl = `https://www.youtube.com/watch?v=${videoId}`;
            const checkRes = await fetch(checkUrl, {
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                    'Accept-Language': 'en-US,en;q=0.9'
                }
            });
            const html = await checkRes.text();
            const match = html.match(/ytInitialPlayerResponse\s*=\s*({.+?});/);

            let embeddable = false;
            let reason = 'Could not parse playabilityStatus';
            let status = 'UNKNOWN';

            if (match) {
                try {
                    const parsed = JSON.parse(match[1]);
                    const playabilityStatus = parsed.playabilityStatus || {};
                    status = playabilityStatus.status || 'UNKNOWN';
                    reason = playabilityStatus.reason || '';
                    embeddable = (status === 'OK') && (playabilityStatus.playableInEmbed !== false);
                } catch (err) {
                    reason = 'Failed to parse JSON';
                }
            } else {
                reason = 'No ytInitialPlayerResponse found';
            }

            res.writeHead(200, { 
                'Content-Type': 'application/json',
                'Access-Control-Allow-Origin': '*'
            });
            res.end(JSON.stringify({ videoId, status, reason, embeddable }));
        } catch (e) {
            res.writeHead(500, { 
                'Content-Type': 'application/json',
                'Access-Control-Allow-Origin': '*'
            });
            res.end(JSON.stringify({ error: e.message || e }));
        }
        return;
    }

    
    // Normalize URL path
    let filePath = path.join(PUBLIC_DIR, req.url === '/' ? 'index.html' : req.url.split('?')[0]);
    
    // Check if path is within PUBLIC_DIR to prevent directory traversal
    if (!filePath.startsWith(PUBLIC_DIR)) {
        res.statusCode = 403;
        res.end('Forbidden');
        return;
    }

    fs.stat(filePath, (err, stats) => {
        if (err || !stats.isFile()) {
            res.statusCode = 404;
            res.end('Not Found');
            return;
        }

        const ext = path.extname(filePath).toLowerCase();
        const contentType = MIME_TYPES[ext] || 'application/octet-stream';

        res.writeHead(200, { 'Content-Type': contentType });
        const stream = fs.createReadStream(filePath);
        stream.pipe(res);
    });
});

server.listen(PORT, () => {
    console.log(`Server running at http://localhost:${PORT}/`);
});
