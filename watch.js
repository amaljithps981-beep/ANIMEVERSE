import { syncStorageToDb, fetchDbToStorage, trackUserActivity } from './db.js';

const player = document.getElementById("animePlayer");
const episodeButtons = document.getElementById("episodeButtons");
const episodeSectionTitle = document.querySelector(".episode-section-title");

/* GET ID */
const urlParams = new URLSearchParams(window.location.search);
const animeId = urlParams.get("id");
let currentEpisode = parseInt(urlParams.get("ep")) || 1;

const selectedItem = JSON.parse(localStorage.getItem("selectedItem") || "null");

/* DETERMINE EPISODE COUNT & VISIBILITY */
const type = selectedItem && selectedItem.type ? selectedItem.type.toLowerCase() : '';
const isMovie = type === 'movie' || type === 'feature';
const episodesCount = selectedItem && Number(selectedItem.episodes) > 0 ? Number(selectedItem.episodes) : (isMovie ? 1 : 12);

if (isMovie || episodesCount <= 1) {
    if (episodeSectionTitle) episodeSectionTitle.style.display = 'none';
    if (episodeButtons) episodeButtons.style.display = 'none';
} else {
    if (episodeSectionTitle) episodeSectionTitle.style.display = 'block';
    if (episodeButtons) {
        episodeButtons.style.display = 'grid';
        episodeButtons.innerHTML = ""; // Clear existing
        for (let i = 1; i <= episodesCount; i++) {
            const btn = document.createElement("button");
            btn.innerText = `Episode ${i}`;
            btn.classList.add("episode-btn");
            if (i === currentEpisode) {
                btn.classList.add("active");
            }
            btn.addEventListener("click", () => {
                currentEpisode = i;
                // Update URL parameter without reload
                const url = new URL(window.location.href);
                url.searchParams.set("ep", i);
                window.history.pushState({}, '', url);

                // Highlight active button
                document.querySelectorAll(".episode-btn").forEach(b => b.classList.remove("active"));
                btn.classList.add("active");

                loadEpisode(i);
            });
            episodeButtons.appendChild(btn);
        }
    }
}

/* LOAD PLAYER */
function loadEpisode(episode) {
    if (!selectedItem) {
        player.src = `https://vidsrc.xyz/embed/anime/${animeId}/${episode}`;
        return;
    }
    
    const typeLower = (selectedItem.mediaType || selectedItem.type || '').toString().toLowerCase();
    const isAnime = selectedItem.mal_id || typeLower === 'anime';
    const isMovie = typeLower === 'movie' || typeLower === 'feature';
    
    if (isAnime) {
        player.src = `https://vidsrc.xyz/embed/anime/${animeId}/${episode}`;
    } else if (isMovie) {
        player.src = `https://vidsrc.xyz/embed/movie/${animeId}`;
    } else {
        const season = localStorage.getItem("currentSeason") || "1";
        player.src = `https://vidsrc.xyz/embed/tv/${animeId}/${season}-${episode}`;
    }
    
    trackUserActivity(selectedItem, 'watch');
}

/* PROGRESS TRACKING LOGIC */
let playbackTime = 0;
let duration = 2700; // default 45 mins

// Set up duration based on media type
const typeLower = selectedItem && (selectedItem.mediaType || selectedItem.type || '').toString().toLowerCase();
const isAnime = selectedItem && (selectedItem.mal_id || typeLower === 'anime');

if (isAnime) {
    duration = 1200; // 20 mins for Anime
} else if (isMovie) {
    duration = 7200; // 2 hours for Movies
}

// Load previous progress
(async () => {
    let continueWatching = await fetchDbToStorage("continueWatching");
    if (continueWatching === null) {
        continueWatching = JSON.parse(localStorage.getItem("continueWatching")) || [];
    }
    
    if (selectedItem) {
        const record = continueWatching.find(item => item && (item.title || '').toLowerCase().trim() === (selectedItem.title || '').toLowerCase().trim());
        if (record && Number(record.episode) === Number(currentEpisode)) {
            playbackTime = Number(record.lastWatched) || 0;
            console.log(`[Watch Progress] Resuming from saved progress: ${playbackTime}s`);
        }
    }
    
    // Start interval
    startProgressInterval();
})();

let progressInterval = null;
function startProgressInterval() {
    if (progressInterval) clearInterval(progressInterval);
    progressInterval = setInterval(async () => {
        playbackTime += 10;
        if (playbackTime > duration) {
            playbackTime = duration;
        }
        const progressPercent = Math.round((playbackTime / duration) * 100);
        console.log(`[Watch Progress] Progress: ${playbackTime}s / ${duration}s (${progressPercent}%)`);
        
        await updateContinueWatchingProgress(playbackTime, progressPercent);
        
        if (progressPercent >= 90) {
            clearInterval(progressInterval);
            console.log(`[Watch Progress] 90%+ progress reached. Completing episode.`);
            await markEpisodeCompleted();
            await saveNextEpisodeSuggestion();
        }
    }, 10000);
}

async function updateContinueWatchingProgress(lastWatched, progress) {
    if (!selectedItem) return;
    
    let continueWatching = await fetchDbToStorage("continueWatching");
    if (continueWatching === null) {
        continueWatching = JSON.parse(localStorage.getItem("continueWatching")) || [];
    }
    
    const deducedType = isAnime ? 'Anime' : (isMovie ? 'Movie' : 'TV');
    const seasonVal = localStorage.getItem("currentSeason") || "1";
    
    const record = {
        id: selectedItem.id || selectedItem.mal_id || animeId,
        title: selectedItem.title,
        poster: selectedItem.image || selectedItem.poster_path || '',
        media_type: deducedType,
        season: seasonVal,
        episode: currentEpisode,
        lastWatched: lastWatched,
        progress: progress
    };
    
    continueWatching = continueWatching.filter(item => item && (item.title || '').toLowerCase().trim() !== (selectedItem.title || '').toLowerCase().trim());
    continueWatching.unshift(record);
    continueWatching = continueWatching.slice(0, 10);
    
    await syncStorageToDb("continueWatching", continueWatching);
}

async function markEpisodeCompleted() {
    if (!selectedItem) return;
    try {
        let watched = JSON.parse(localStorage.getItem("watched")) || [];
        const alreadyWatched = watched.some(i => i && (i.title || '').toLowerCase().trim() === (selectedItem.title || '').toLowerCase().trim());
        if (!alreadyWatched) {
            watched.unshift(selectedItem);
            await trackUserActivity(selectedItem, 'watched');
            await syncStorageToDb("watched", watched);
            console.log(`[Watch Progress] Automatically marked ${selectedItem.title} as completed.`);
        }
    } catch (e) {
        console.warn("Failed to mark completed:", e);
    }
}

async function saveNextEpisodeSuggestion() {
    if (!selectedItem) return;
    const nextEpisode = currentEpisode + 1;
    
    let continueWatching = await fetchDbToStorage("continueWatching");
    if (continueWatching === null) {
        continueWatching = JSON.parse(localStorage.getItem("continueWatching")) || [];
    }

    if (nextEpisode <= episodesCount) {
        console.log(`[Watch Progress] Suggesting next episode: ${nextEpisode}`);
        const deducedType = isAnime ? 'Anime' : (isMovie ? 'Movie' : 'TV');
        const seasonVal = localStorage.getItem("currentSeason") || "1";
        
        const record = {
            id: selectedItem.id || selectedItem.mal_id || animeId,
            title: selectedItem.title,
            poster: selectedItem.image || selectedItem.poster_path || '',
            media_type: deducedType,
            season: seasonVal,
            episode: nextEpisode,
            lastWatched: 0,
            progress: 0
        };

        continueWatching = continueWatching.filter(item => item && (item.title || '').toLowerCase().trim() !== (selectedItem.title || '').toLowerCase().trim());
        continueWatching.unshift(record);
        continueWatching = continueWatching.slice(0, 10);

        await syncStorageToDb("continueWatching", continueWatching);
    } else {
        console.log(`[Watch Progress] Final episode completed. Removing from Continue Watching.`);
        continueWatching = continueWatching.filter(item => item && (item.title || '').toLowerCase().trim() !== (selectedItem.title || '').toLowerCase().trim());
        await syncStorageToDb("continueWatching", continueWatching);
    }
}

/* START */
loadEpisode(currentEpisode);