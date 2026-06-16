const fs = require('fs');
const path = require('path');

const seoTags = `
    <!-- SEO & Open Graph Tags -->
    <meta name="description" content="AnimeVerse - The Ultimate Anime Streaming & Tracking Platform. Track, discover, and watch your favorite Anime, Movies, and TV Series.">
    <meta name="keywords" content="Anime, Streaming, Tracking, Manga, Movies, TV Series, AnimeVerse">
    <meta property="og:title" content="AnimeVerse">
    <meta property="og:description" content="The Ultimate Anime Tracking Platform.">
    <meta property="og:image" content="https://animeverse-4c635.web.app/icon-512.png">
    <meta property="og:url" content="https://animeverse-4c635.web.app">
    <meta name="twitter:card" content="summary_large_image">
`;

function injectSeo(dir) {
    const files = fs.readdirSync(dir);
    for (const file of files) {
        if (file.endsWith('.html')) {
            const filePath = path.join(dir, file);
            let content = fs.readFileSync(filePath, 'utf8');
            if (!content.includes('og:title')) {
                content = content.replace('</head>', seoTags + '\n</head>');
                fs.writeFileSync(filePath, content);
                console.log('Injected SEO into ' + file);
            }
        }
    }
}

injectSeo(__dirname);
