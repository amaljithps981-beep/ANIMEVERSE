import { syncStorageToDb, fetchDbToStorage, trackUserActivity } from './db.js';
import { analytics } from './analytics.js';
const API_KEY = "c2772546356cffa3fb0504e91da76541";
const TMDB_API = "https://api.themoviedb.org/3";
const IMG = "https://image.tmdb.org/t/p/w500";

// ============================================================
// GUARD: Redirect if no selectedItem is present
// ============================================================
const item = JSON.parse(localStorage.getItem("selectedItem") || "null");

if (!item || !item.title) {
    console.warn("details.js: No selectedItem found — redirecting to homepage.");
    window.location.href = "index.html";
    throw new Error("No selectedItem");   // stop rest of script from running
}
item.media_type = item.media_type || item.mediaType || item.type || '';

// Track detail page view
analytics.trackDetailView(item.title);

// ============================================================
// POPULATE INFO SECTION
// ============================================================
function setIf(id, value, prop = 'innerText') {
    const el = document.getElementById(id);
    if (!el) return;
    if (prop === 'src') el.src = value || '';
    else el.innerText = value || '';
}

setIf('detailsPoster',      item.image,                          'src');
setIf('detailsTitle',       item.title);
setIf('detailsRating',      item.rating ? '⭐ ' + item.rating : 'N/A');
setIf('detailsDescription', item.description || 'No description available.');
setIf('detailsYear',        item.year || '');
setIf('detailsType',        item.type || '');

// ============================================================
// TRAILER (Netflix-style autoplay, muted)
// ============================================================
const trailerFrame     = document.getElementById("trailerFrame");
const playerContainer  = document.getElementById("playerContainer");

function extractYoutubeId(url) {
    if (!url) return null;
    const regExp = /^.*(youtu.be\/|v\/|u\/\w\/|embed\/|watch\?v=|\&v=)([^#\&\?]*).*/;
    const match = url.match(regExp);
    return (match && match[2].length === 11) ? match[2] : null;
}

function getAnimeYoutubeId(trailer) {
    if (!trailer) return null;
    if (trailer.youtube_id) return trailer.youtube_id;
    if (trailer.embed_url) {
        const id = extractYoutubeId(trailer.embed_url);
        if (id) return id;
    }
    if (trailer.url) {
        const id = extractYoutubeId(trailer.url);
        if (id) return id;
    }
    return null;
}

async function searchYoutubeProxy(query) {
    const instances = [
        "https://invidious.yewtu.be",
        "https://vid.puffyan.us",
        "https://invidious.flokinet.to",
        "https://inv.tux.im",
        "https://invidious.projectsegfau.lt"
    ];
    
    for (const instance of instances) {
        try {
            const res = await fetch(`${instance}/api/v1/search?q=${encodeURIComponent(query)}&type=video`, {
                signal: AbortSignal.timeout(2000)
            });
            if (res.ok) {
                const data = await res.json();
                if (data && Array.isArray(data) && data.length > 0 && data[0].videoId) {
                    console.log(`[YouTube Search] Success using instance ${instance}:`, data[0].videoId);
                    return data[0].videoId;
                }
            }
        } catch (e) {
            console.warn(`[YouTube Search] Failed for instance ${instance}:`, e);
        }
    }
    return null;
}

function findBestTrailer(results) {
    if (!results || !Array.isArray(results)) return null;
    const ytVideos = results.filter(v => v.site === "YouTube" && v.key);
    if (ytVideos.length === 0) return null;

    // 1. Official Trailer (type is Trailer and name contains official)
    let match = ytVideos.find(v => v.type === "Trailer" && (v.name || "").toLowerCase().includes("official"));
    if (match) return match.key;

    // 2. Any Trailer (type is Trailer)
    match = ytVideos.find(v => v.type === "Trailer");
    if (match) return match.key;

    // 3. Teaser (type is Teaser)
    match = ytVideos.find(v => v.type === "Teaser");
    if (match) return match.key;

    // 4. Clip (type is Clip)
    match = ytVideos.find(v => v.type === "Clip");
    if (match) return match.key;

    // 5. First valid YouTube video
    return ytVideos[0].key;
}

function populateGenres(genres) {
    const container = document.getElementById("genresContainer");
    if (!container || !genres) return;
    container.innerHTML = "";
    genres.forEach(g => {
        const name = typeof g === 'object' ? (g.name || '') : g;
        if (!name) return;
        const span = document.createElement("span");
        span.innerText = name;
        container.appendChild(span);
    });
}

function loadYoutubePlayerApi() {
    return new Promise((resolve, reject) => {
        const timeout = setTimeout(() => {
            if (window.YT && window.YT.Player) {
                resolve(window.YT);
            } else {
                reject(new Error("YouTube API load timeout after 3s"));
            }
        }, 3000);

        if (window.YT && window.YT.Player) {
            clearTimeout(timeout);
            resolve(window.YT);
            return;
        }
        
        const existingScript = document.querySelector('script[src="https://www.youtube.com/iframe_api"]');
        if (existingScript) {
            const interval = setInterval(() => {
                if (window.YT && window.YT.Player) {
                    clearInterval(interval);
                    clearTimeout(timeout);
                    resolve(window.YT);
                }
            }, 100);
            return;
        }

        const tag = document.createElement('script');
        tag.src = "https://www.youtube.com/iframe_api";
        const firstScriptTag = document.getElementsByTagName('script')[0];
        if (firstScriptTag && firstScriptTag.parentNode) {
            firstScriptTag.parentNode.insertBefore(tag, firstScriptTag);
        } else {
            document.head.appendChild(tag);
        }

        const prevCallback = window.onYouTubeIframeAPIReady;
        window.onYouTubeIframeAPIReady = () => {
            if (prevCallback) prevCallback();
            clearTimeout(timeout);
            resolve(window.YT);
        };
    });
}

async function verifyEmbeddable(videoId) {
    try {
        const apiBase = window.location.port === '3000' ? '' : 'http://localhost:3000';
        const res = await fetch(`${apiBase}/api/check-youtube-embed?id=${videoId}`, {
            signal: AbortSignal.timeout(2000)
        });
        if (res.ok) {
            const data = await res.json();
            return data.embeddable === true;
        }
    } catch (e) {
        console.warn(`[Trailer System] Failed to verify embeddability for video ${videoId} via backend check:`, e);
    }
    return true; // Fallback to true if check fails, let player error handle it
}

function showBlockedTrailerCard(videoId) {
    const frame = document.getElementById("trailerFrame");
    if (frame) {
        frame.style.display = "none";
        if (frame.tagName === 'IFRAME') {
            frame.src = "";
        }
    }
    const loadingEl = document.getElementById("playerLoading");
    if (loadingEl) {
        loadingEl.style.display = "none";
    }
    if (!playerContainer) return;
    
    playerContainer.innerHTML = `
        <div class="blocked-trailer-card" style="position:relative; width:100%; height:100%; display:flex; align-items:center; justify-content:center; background:url('https://i.ytimg.com/vi/${videoId}/hqdefault.jpg') center/cover no-repeat;">
            <div style="position:absolute; top:0; left:0; width:100%; height:100%; background:rgba(0,0,0,0.75); backdrop-filter:blur(10px); -webkit-backdrop-filter:blur(10px); z-index:1;"></div>
            <div style="position:relative; z-index:2; text-align:center; color:white; padding:20px; max-width:550px; margin: 0 auto;">
                <h2 style="font-size:32px; margin-bottom:15px; font-weight:700; color:#E50914;">🎬 Trailer Embedding Restricted</h2>
                <p style="font-size:16px; margin-bottom:24px; color:#ddd; line-height:1.5;">The publisher restricts playing this trailer inside embedded players. You can watch the official video directly on YouTube.</p>
                <a href="https://www.youtube.com/watch?v=${videoId}" target="_blank" class="play-btn" style="display:inline-flex; align-items:center; gap:8px; padding:12px 28px; font-size:16px; font-weight:600; text-decoration:none; border-radius:30px; background-color:#E50914; color:white; transition:var(--transition); border:none; cursor:pointer;">
                    Watch Trailer on YouTube ↗
                </a>
            </div>
        </div>`;
}

async function renderYoutubePlayer(youtubeId, cacheKey, trailerUrl) {
    try {
        if (playerContainer) {
            playerContainer.innerHTML = `
                <iframe id="trailerFrame" style="width: 100%; height: 100%; border: none;" allow="autoplay; encrypted-media; gyroscope; picture-in-picture; fullscreen" allowfullscreen src="${trailerUrl}"></iframe>
            `;
        }

        const loadingEl = document.getElementById("playerLoading");
        if (loadingEl) loadingEl.style.display = "none";

        // Asynchronously initialize YT Player API in background for embed block monitoring
        loadYoutubePlayerApi().then(YT => {
            new YT.Player('trailerFrame', {
                events: {
                    'onError': (event) => {
                        console.warn(`[Trailer System] YouTube Player onError fired for Video ID: ${youtubeId}. Error code: ${event.data}`);
                        localStorage.setItem(cacheKey, `blocked_${youtubeId}`);
                        showBlockedTrailerCard(youtubeId);
                    }
                }
            });
        }).catch(err => {
            console.warn("[Trailer System] YouTube Player API background monitor failed to load:", err);
        });

    } catch (e) {
        console.error("[Trailer System] Error rendering YouTube Player:", e);
        if (playerContainer) {
            playerContainer.innerHTML = `
                <iframe id="trailerFrame" style="width: 100%; height: 100%; border: none;" allow="autoplay; encrypted-media; gyroscope; picture-in-picture; fullscreen" allowfullscreen src="${trailerUrl}"></iframe>
            `;
        }
        const loadingEl = document.getElementById("playerLoading");
        if (loadingEl) loadingEl.style.display = "none";
    }
}

async function loadTrailer() {
    try {
        console.log("Starting trailer load");
        console.log("Selected Item:", item);
        console.log("Media Type:", item.media_type);
        console.log("Item ID:", item.id);

        const isAnime = item.mal_id || (item.media_type || item.mediaType || item.type || '').toString().toLowerCase() === 'anime';
        const mediaType = isAnime ? 'Anime' : ((item.media_type || item.mediaType || item.type || '').toString().toLowerCase().includes('tv') ? 'tv' : 'movie');
        const cacheKey = isAnime ? `trailer_${item.mal_id}` : `trailer_${item.id}`;

        // 1. Check cache
        const cachedUrl = localStorage.getItem(cacheKey);
        if (cachedUrl) {
            if (cachedUrl === "none") {
                console.log(`[Trailer System] Cache hit: No trailer available.`);
                console.log("Selected Item:", item);
                console.log("Media Type:", item.media_type);
                console.log("Item ID:", item.id);
                console.log("Trailer URL:", null);
                showNoTrailer();
                return;
            }
            if (cachedUrl.startsWith("blocked_")) {
                const blockedId = cachedUrl.replace("blocked_", "");
                const trailerUrl = `https://www.youtube.com/embed/${blockedId}`;
                console.log(`[Trailer System] Cache hit: Embedding restricted for Video ID: ${blockedId}. Embed allowed = false`);
                console.log("Selected Item:", item);
                console.log("Media Type:", item.media_type);
                console.log("Item ID:", item.id);
                console.log("Trailer URL:", trailerUrl);
                showBlockedTrailerCard(blockedId);
                return;
            }
            
            console.log(`[Trailer System] Cache hit: Trailer URL found: ${cachedUrl}`);
            const cachedId = extractYoutubeId(cachedUrl);
            if (cachedId) {
                let trailerUrl = cachedUrl;
                if (!trailerUrl.includes('autoplay=')) {
                    const currentOrigin = (window.location && window.location.origin) || "http://localhost:3000";
                    const separator = trailerUrl.includes('?') ? '&' : '?';
                    trailerUrl = `${trailerUrl}${separator}autoplay=1&mute=1&enablejsapi=1&origin=${encodeURIComponent(currentOrigin)}`;
                } else if (!trailerUrl.includes('origin=')) {
                    const currentOrigin = (window.location && window.location.origin) || "http://localhost:3000";
                    const separator = trailerUrl.includes('?') ? '&' : '?';
                    trailerUrl = `${trailerUrl}${separator}enablejsapi=1&origin=${encodeURIComponent(currentOrigin)}`;
                }
                console.log("Selected Item:", item);
                console.log("Media Type:", item.media_type);
                console.log("Item ID:", item.id);
                console.log("Trailer URL:", trailerUrl);
                await renderYoutubePlayer(cachedId, cacheKey, trailerUrl);
                return;
            }
        }

        let youtubeId = null;
        let preferredEmbedUrl = null;

        if (isAnime) {
            // Anime flow: Jikan -> YouTube Search
            const id = item.mal_id;
            if (id) {
                console.log(`[Trailer System] Querying Jikan API for Anime ID: ${id}`);
                const response = await fetch(`https://api.jikan.moe/v4/anime/${id}`);
                if (!response.ok) {
                    throw new Error(`Jikan API request failed with status: ${response.status}`);
                }
                const data = await response.json();
                console.log("Jikan anime details:", data);
                const animeData = data && data.data;

                if (animeData) {
                    // Sync metadata into item and save to localStorage
                    item.episodes = animeData.episodes || item.episodes;
                    item.rating = animeData.score || item.rating;
                    item.description = animeData.synopsis || item.description;
                    item.year = animeData.aired && animeData.aired.prop && animeData.aired.prop.from && animeData.aired.prop.from.year ? animeData.aired.prop.from.year : item.year;
                    item.type = animeData.type || item.type;
                    item.mediaType = 'Anime';
                    item.media_type = 'Anime';
                    localStorage.setItem("selectedItem", JSON.stringify(item));

                    // Dynamically update metadata UI elements
                    setIf('detailsRating',      item.rating ? '⭐ ' + item.rating : 'N/A');
                    setIf('detailsDescription', item.description || 'No description available.');
                    setIf('detailsYear',        item.year || '');
                    setIf('detailsType',        item.type || '');
                    if (animeData.genres) {
                        populateGenres(animeData.genres);
                    }

                    // Try extracting youtube ID from Jikan trailer object
                    if (animeData.trailer) {
                        if (animeData.trailer.embed_url) {
                            preferredEmbedUrl = animeData.trailer.embed_url;
                        }
                        youtubeId = getAnimeYoutubeId(animeData.trailer);
                    }
                }
            }

            // Fallback: YouTube Search
            if (!youtubeId) {
                console.log(`[Trailer System] Jikan trailer unavailable. Falling back to YouTube search...`);
                youtubeId = await searchYoutubeProxy(`"${item.title}" official trailer`);
            }

        } else {
            // Movie/TV series flow: TMDB -> YouTube Search
            let tmdbId = item.id;
            let type = mediaType;

            let first = null;
            if (tmdbId && type) {
                first = { id: tmdbId, media_type: type };
            } else {
                console.log(`[Trailer System] Searching TMDB multi-search for: "${item.title}"`);
                const searchRes = await fetch(`https://api.themoviedb.org/3/search/multi?api_key=${API_KEY}&query=${encodeURIComponent(item.title)}`);
                if (!searchRes.ok) {
                    throw new Error(`TMDB Multi Search failed with status: ${searchRes.status}`);
                }
                const searchData = await searchRes.json();
                console.log("TMDB search multi response:", searchData);
                first = searchData && searchData.results && searchData.results[0];
                if (first) {
                    item.id = first.id;
                    item.type = first.media_type;
                    item.mediaType = first.media_type;
                    item.media_type = first.media_type;
                    localStorage.setItem("selectedItem", JSON.stringify(item));
                    tmdbId = first.id;
                    type = first.media_type.toLowerCase().includes('tv') ? 'tv' : 'movie';
                }
            }

            if (first) {
                const mediaId = tmdbId;
                console.log(`[Trailer System] Querying TMDB details for: ${type}/${mediaId}`);
                const detailsRes = await fetch(`https://api.themoviedb.org/3/${type}/${mediaId}?api_key=${API_KEY}`);
                if (!detailsRes.ok) {
                    throw new Error(`TMDB Details fetch failed with status: ${detailsRes.status}`);
                }
                const detailsData = await detailsRes.json();
                console.log("TMDB details response:", detailsData);

                if (detailsData) {
                    item.rating = detailsData.vote_average ? detailsData.vote_average.toFixed(1) : item.rating;
                    item.description = detailsData.overview || item.description;
                    item.year = (detailsData.release_date || detailsData.first_air_date || '').slice(0, 4) || item.year;
                    item.episodes = detailsData.number_of_episodes || item.episodes;
                    localStorage.setItem("selectedItem", JSON.stringify(item));

                    // Dynamically update metadata UI elements
                    setIf('detailsRating',      item.rating ? '⭐ ' + item.rating : 'N/A');
                    setIf('detailsDescription', item.description || 'No description available.');
                    setIf('detailsYear',        item.year || '');
                    setIf('detailsType',        type === 'tv' ? 'TV Series' : 'Movie');
                    if (detailsData.genres) {
                        populateGenres(detailsData.genres);
                    }
                }

                await trackUserActivity({
                    title: item.title,
                    type: type === 'tv' ? 'TV' : 'Movie',
                    genres: detailsData.genres || []
                }, 'click');

                console.log(`[Trailer System] Querying TMDB videos for: ${type}/${mediaId}`);
                const videoRes = await fetch(`https://api.themoviedb.org/3/${type}/${mediaId}/videos?api_key=${API_KEY}`);
                if (!videoRes.ok) {
                    throw new Error(`TMDB Videos fetch failed with status: ${videoRes.status}`);
                }
                const videoData = await videoRes.json();
                if (type === "movie") {
                    console.log("TMDB movie videos:", videoData);
                } else {
                    console.log("TMDB tv videos:", videoData);
                }
                youtubeId = findBestTrailer(videoData.results);
            }

            // Fallback: YouTube Search
            if (!youtubeId) {
                console.log(`[Trailer System] TMDB trailer unavailable. Falling back to YouTube search...`);
                youtubeId = await searchYoutubeProxy(`"${item.title}" official trailer`);
            }
        }

        // Process result
        let trailerUrl = youtubeId ? (preferredEmbedUrl || `https://www.youtube.com/embed/${youtubeId}`) : null;
        if (trailerUrl) {
            const currentOrigin = (window.location && window.location.origin) || "http://localhost:3000";
            const separator = trailerUrl.includes('?') ? '&' : '?';
            trailerUrl = `${trailerUrl}${separator}autoplay=1&mute=1&enablejsapi=1&origin=${encodeURIComponent(currentOrigin)}`;
        }

        console.log("Selected Item:", item);
        console.log("Media Type:", item.media_type);
        console.log("Item ID:", item.id);
        console.log("Trailer URL:", trailerUrl);

        if (trailerUrl) {
            // Verify embeddability before rendering
            console.log(`[Trailer System] Verifying embeddability for Video ID: ${youtubeId}...`);
            const embeddable = await verifyEmbeddable(youtubeId);
            
            if (!embeddable) {
                console.log(`[Trailer System] Embed allowed = false (verified from backend pre-check)`);
                localStorage.setItem(cacheKey, `blocked_${youtubeId}`);
                showBlockedTrailerCard(youtubeId);
            } else {
                await renderYoutubePlayer(youtubeId, cacheKey, trailerUrl);
            }
        } else {
            const reason = "No video found in API response or YouTube search fallbacks.";
            console.log(`[Trailer System] Failure reason: ${reason}`);
            localStorage.setItem(cacheKey, "none");
            showNoTrailer();
        }
    } catch(err) {
        console.error("Trailer Error:", err);
        showTrailerError();
    }
}

function showNoTrailer() {
    const frame = document.getElementById("trailerFrame");
    if (frame) {
        frame.style.display = "none";
        if (frame.tagName === 'IFRAME') {
            frame.src = "";
        }
    }
    const loadingEl = document.getElementById("playerLoading");
    if (loadingEl) {
        loadingEl.style.display = "none";
    }
    if (!playerContainer) return;
    playerContainer.innerHTML = `
        <div class="no-trailer" style="display:flex;align-items:center;justify-content:center;height:100%;flex-direction:column;">
            <h2>🎬 Trailer Not Available</h2>
            <p>This title currently has no official trailer.</p>
        </div>`;
}

function showTrailerError() {
    const frame = document.getElementById("trailerFrame");
    if (frame) {
        frame.style.display = "none";
        if (frame.tagName === 'IFRAME') {
            frame.src = "";
        }
    }
    const loadingEl = document.getElementById("playerLoading");
    if (loadingEl) {
        loadingEl.style.display = "none";
    }
    if (!playerContainer) return;
    playerContainer.innerHTML = `
        <div class="no-trailer" style="display:flex;align-items:center;justify-content:center;height:100%;flex-direction:column;">
            <h2>🎬 Trailer Not Available</h2>
            <p>Failed to load trailer.</p>
        </div>`;
}

function renderCast(castList, isAnime) {
    const castContainer = document.getElementById("castContainer");
    const animeCharacters = document.getElementById("animeCharacters");
    
    if (isAnime) {
        if (!animeCharacters) return;
        animeCharacters.innerHTML = "";
        
        if (castList.length === 0) {
            animeCharacters.innerHTML = "<p>No character information available.</p>";
            return;
        }

        castList.slice(0, 6).forEach(character => {
            const voiceActor = character.voice_actors?.[0]?.person?.name || "Unknown";
            const card = document.createElement("div");
            card.className = "character-card";
            card.innerHTML = `
                <img src="${character.character.images.jpg.image_url}" alt="${character.character.name}" loading="lazy">
                <h4>${character.character.name}</h4>
                <p>${character.role}</p>
                <small>🎙 ${voiceActor}</small>
            `;
            if (character.character.url) {
                card.style.cursor = "pointer";
                card.addEventListener("click", () => {
                    window.open(character.character.url, "_blank");
                });
            }
            animeCharacters.appendChild(card);
        });
    } else {
        if (!castContainer) return;
        castContainer.innerHTML = "";
        
        if (castList.length === 0) {
            castContainer.innerHTML = "<p>No cast information available.</p>";
            return;
        }

        const PROFILE = "https://image.tmdb.org/t/p/w185";
        castList.slice(0, 6).forEach(actor => {
            const photo = actor.profile_path ? PROFILE + actor.profile_path : "images/default-avatar.png";
            const card = document.createElement("div");
            card.className = "cast-card";
            card.innerHTML = `
                <img src="${photo}" alt="${actor.name || 'Unknown'}" loading="lazy">
                <h4>${actor.name || 'Unknown'}</h4>
                <p>${actor.character || 'N/A'}</p>
            `;
            card.addEventListener("click", () => {
                if (actor && actor.id) {
                    window.open(`https://www.themoviedb.org/person/${actor.id}`, "_blank");
                }
            });
            castContainer.appendChild(card);
        });
    }
}

function renderRecommendations(results, isAnime) {
    const container = document.getElementById("similarContainer");
    if (!container) return;
    container.innerHTML = "";

    if (results.length === 0) {
        container.innerHTML = "<p>No similar titles found.</p>";
        return;
    }

    results.slice(0, 6).forEach(recItem => {
        const card = document.createElement("div");
        card.classList.add("card");
        
        if (isAnime) {
            const anime = recItem.entry;
            card.innerHTML = `
                <img src="${anime.images.jpg.image_url}" alt="${anime.title}" loading="lazy">
                <h3>${anime.title}</h3>
            `;
            card.addEventListener("click", () => {
                const newItem = {
                    title:       anime.title,
                    image:       anime.images.jpg.large_image_url || anime.images.jpg.image_url,
                    rating:      null,
                    description: '',
                    type:        'Anime',
                    mediaType:   'Anime',
                    year:        '',
                    episodes:    null,
                    id:          null,
                    mal_id:      anime.mal_id
                };
                localStorage.setItem("selectedItem", JSON.stringify(newItem));
                location.reload();
            });
        } else {
            card.innerHTML = `
                <img src="${IMG + recItem.poster_path}" alt="${recItem.title || recItem.name || 'Similar'}" loading="lazy">
                <h3>${recItem.title || recItem.name}</h3>
            `;
            card.addEventListener("click", () => {
                const parentTypeLower = (item.media_type || item.mediaType || item.type || '').toString().toLowerCase();
                const deducedType = parentTypeLower.includes('tv') ? 'tv' : 'movie';
                
                const newItem = {
                    ...recItem,
                    media_type: deducedType,
                    mediaType: deducedType,
                    type: deducedType
                };
                
                localStorage.setItem("selectedItem", JSON.stringify(newItem));
                location.reload();
            });
        }
        container.appendChild(card);
    });
}

function renderEpisodes(episodes, isAnime = true, seasonNumber = 1) {
    const container = document.getElementById("episodesContainer");
    if (!container) return;
    container.innerHTML = "";

    if (!episodes || episodes.length === 0) {
        container.innerHTML = "<p>Episodes unavailable.</p>";
        return;
    }

    episodes.forEach(ep => {
        const epNum = isAnime ? ep.mal_id : ep.episode_number;
        const epTitle = isAnime ? ep.title : ep.name;
        const rawDate = isAnime ? ep.aired : ep.air_date;
        
        let formattedDate = "";
        if (rawDate) {
            try {
                formattedDate = new Date(rawDate).toLocaleDateString(undefined, {
                    year: 'numeric',
                    month: 'short',
                    day: 'numeric'
                });
            } catch (e) {
                formattedDate = rawDate;
            }
        }
        
        const card = document.createElement("div");
        card.className = "episode-card";
        card.innerHTML = `
            <div class="ep-card-left">
                <span class="play-icon">▶</span>
                <span class="ep-number">Episode ${epNum}</span>
                <h4 class="ep-title">${epTitle || "Untitled"}</h4>
            </div>
            ${formattedDate ? `<div class="ep-card-right"><span class="ep-date">${formattedDate}</span></div>` : ""}
        `;
        
        card.addEventListener("click", async () => {
            localStorage.setItem("selectedEpisode", JSON.stringify(ep));
            localStorage.setItem("currentEpisode", epNum);
            localStorage.setItem("currentSeason", seasonNumber);
            
            const typeLower = (item.media_type || item.mediaType || item.type || '').toString().toLowerCase();
            const isAnime = !!item.mal_id || typeLower === 'anime';
            const isMovie = typeLower === 'movie' || typeLower === 'feature';
            const deducedType = isAnime ? 'Anime' : (isMovie ? 'Movie' : 'TV');
            
            let continueWatching = JSON.parse(localStorage.getItem("continueWatching")) || [];
            let existing = continueWatching.find(c => c && (c.title || '').toLowerCase().trim() === (item.title || '').toLowerCase().trim());
            
            if (existing) {
                if (Number(existing.episode) !== Number(epNum) || Number(existing.season) !== Number(seasonNumber)) {
                    existing.episode = epNum;
                    existing.season = seasonNumber;
                    existing.progress = 0;
                    existing.lastWatched = 0;
                }
            } else {
                existing = {
                    id: item.id || item.mal_id || '',
                    title: item.title,
                    poster: item.image || item.poster_path || '',
                    media_type: deducedType,
                    season: seasonNumber,
                    episode: epNum,
                    lastWatched: 0,
                    progress: 0
                };
            }
            
            continueWatching = continueWatching.filter(c => c && (c.title || '').toLowerCase().trim() !== (item.title || '').toLowerCase().trim());
            continueWatching.unshift(existing);
            continueWatching = continueWatching.slice(0, 10);
            
            localStorage.setItem("continueWatching", JSON.stringify(continueWatching));
            await syncStorageToDb("continueWatching", continueWatching);
            
            const id = item.mal_id || item.id || '';
            if (id) {
                window.location.href = `watch.html?id=${id}&ep=${epNum}`;
            }
        });
        
        container.appendChild(card);
    });
}

function renderSeasonSelector(seasons, tvId) {
    const container = document.getElementById("seasonSelectContainer");
    if (!container) return;
    container.innerHTML = "";
    
    let validSeasons = seasons.filter(s => s.season_number > 0);
    if (validSeasons.length === 0 && seasons.length > 0) {
        validSeasons = [seasons[0]];
    }
    
    if (validSeasons.length <= 1) return;
    
    const select = document.createElement("select");
    select.className = "season-select";
    
    const storedSeason = localStorage.getItem("currentSeason") || "1";
    
    validSeasons.forEach(s => {
        const opt = document.createElement("option");
        opt.value = s.season_number;
        opt.innerText = s.name || `Season ${s.season_number}`;
        if (s.season_number.toString() === storedSeason.toString()) {
            opt.selected = true;
        }
        select.appendChild(opt);
    });
    
    select.addEventListener("change", async (e) => {
        const val = e.target.value;
        localStorage.setItem("currentSeason", val);
        await fetchTvSeasonEpisodes(tvId, val);
    });
    
    container.appendChild(select);
}

async function fetchTvSeasonEpisodes(tvId, seasonNumber) {
    try {
        const epContainer = document.getElementById("episodesContainer");
        if (epContainer) {
            epContainer.innerHTML = '<p>Loading episodes...</p>';
        }
        
        const cacheKey = `cache_ep_tmdb_tv_${tvId}_s${seasonNumber}`;
        const cached = localStorage.getItem(cacheKey);
        if (cached) {
            renderEpisodes(JSON.parse(cached), false, seasonNumber);
            return;
        }
        
        const res = await fetch(`${TMDB_API}/tv/${tvId}/season/${seasonNumber}?api_key=${API_KEY}`);
        if (!res.ok) throw new Error("Failed to fetch season episodes");
        const data = await res.json();
        const episodes = data.episodes || [];
        
        localStorage.setItem(cacheKey, JSON.stringify(episodes));
        renderEpisodes(episodes, false, seasonNumber);
    } catch (err) {
        console.error("Error fetching season episodes:", err);
        const epContainer = document.getElementById("episodesContainer");
        if (epContainer) {
            epContainer.innerHTML = '<p>Episodes unavailable for this season.</p>';
        }
    }
}

async function fetchCastAndSimilar(id, mediaType) {
    const isAnime = !!item.mal_id || mediaType === 'anime';
    const isTv = mediaType === 'tv' || (item.type || '').toString().toLowerCase() === 'tv';
    const loadStart = performance.now();
    const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

    const activeSeason = localStorage.getItem("currentSeason") || "1";

    // Cache keys
    const castKey = isAnime ? `cache_cast_anime_${item.mal_id}` : `cache_cast_tmdb_${item.id}`;
    const recsKey = isAnime ? `cache_recs_anime_${item.mal_id}` : `cache_recs_tmdb_${item.id}`;
    const epKey   = isAnime ? `cache_ep_anime_${item.mal_id}` : `cache_ep_tmdb_tv_${item.id}_s${activeSeason}`;
    const seasonsKey = `cache_seasons_tmdb_tv_${item.id}`;

    // Try reading from cache
    let cachedCast = localStorage.getItem(castKey);
    let cachedRecs = localStorage.getItem(recsKey);
    let cachedEp   = localStorage.getItem(epKey);
    let cachedSeasons = localStorage.getItem(seasonsKey);

    if (cachedCast && cachedRecs && (isAnime ? cachedEp : (!isTv || (cachedEp && cachedSeasons)))) {
        console.log(`[Performance] Cache hit for ID: ${isAnime ? item.mal_id : item.id}`);
        renderCast(JSON.parse(cachedCast), isAnime);
        renderRecommendations(JSON.parse(cachedRecs), isAnime);
        if (isAnime && cachedEp) {
            renderEpisodes(JSON.parse(cachedEp), true, 1);
        } else if (isTv && cachedEp && cachedSeasons) {
            renderSeasonSelector(JSON.parse(cachedSeasons), item.id);
            renderEpisodes(JSON.parse(cachedEp), false, activeSeason);
        }
        const loadEnd = performance.now();
        console.log(`[Performance] Details rendered from CACHE in ${(loadEnd - loadStart).toFixed(2)}ms`);
        return;
    }

    console.log(`[Performance] Cache miss for ID: ${isAnime ? item.mal_id : item.id}. Fetching from APIs...`);
    try {
        if (isAnime) {
            const [charRes, recRes, epRes] = await Promise.all([
                fetch(`https://api.jikan.moe/v4/anime/${item.mal_id}/characters`).then(async r => {
                    if (r.status === 429) {
                        await delay(500);
                        return fetch(`https://api.jikan.moe/v4/anime/${item.mal_id}/characters`).then(res => res.json());
                    }
                    return r.json();
                }),
                fetch(`https://api.jikan.moe/v4/anime/${item.mal_id}/recommendations`).then(async r => {
                    if (r.status === 429) {
                        await delay(1000);
                        return fetch(`https://api.jikan.moe/v4/anime/${item.mal_id}/recommendations`).then(res => res.json());
                    }
                    return r.json();
                }),
                fetch(`https://api.jikan.moe/v4/anime/${item.mal_id}/episodes`).then(async r => {
                    if (r.status === 429) {
                        await delay(1500);
                        return fetch(`https://api.jikan.moe/v4/anime/${item.mal_id}/episodes`).then(res => res.json());
                    }
                    return r.json();
                }).catch(() => ({ data: [] }))
            ]);

            const characters = Array.isArray(charRes.data) ? charRes.data : [];
            const recommendations = Array.isArray(recRes.data) ? recRes.data : [];
            const episodes = Array.isArray(epRes.data) ? epRes.data : [];

            // Cache data
            localStorage.setItem(castKey, JSON.stringify(characters));
            localStorage.setItem(recsKey, JSON.stringify(recommendations));
            localStorage.setItem(epKey, JSON.stringify(episodes));

            // Render
            renderCast(characters, true);
            renderRecommendations(recommendations, true);
            renderEpisodes(episodes, true, 1);
        } else {
            const endpoint = mediaType === "movie" ? "movie" : "tv";
            let seasons = [];
            let episodes = [];

            if (isTv) {
                try {
                    // Fetch TV details to get list of seasons
                    const tvDetails = await fetch(`${TMDB_API}/tv/${id}?api_key=${API_KEY}`).then(r => r.json());
                    seasons = tvDetails.seasons || [];
                    renderSeasonSelector(seasons, id);

                    const seasonData = await fetch(`${TMDB_API}/tv/${id}/season/${activeSeason}?api_key=${API_KEY}`).then(r => r.json());
                    episodes = seasonData.episodes || [];

                    // Cache season info
                    localStorage.setItem(`cache_ep_tmdb_tv_${id}_s${activeSeason}`, JSON.stringify(episodes));
                    localStorage.setItem(`cache_seasons_tmdb_tv_${id}`, JSON.stringify(seasons));
                } catch (err) {
                    console.error("Failed to load TV seasons/episodes:", err);
                }
            }

            const [castRes, recRes] = await Promise.all([
                fetch(`${TMDB_API}/${endpoint}/${id}/credits?api_key=${API_KEY}`).then(r => r.json()),
                fetch(`${TMDB_API}/${endpoint}/${id}/similar?api_key=${API_KEY}`).then(r => r.json())
            ]);

            const castList = Array.isArray(castRes.cast) ? castRes.cast : [];
            const recList = Array.isArray(recRes.results) ? recRes.results : [];

            // Cache data
            localStorage.setItem(castKey, JSON.stringify(castList));
            localStorage.setItem(recsKey, JSON.stringify(recList));

            // Render
            renderCast(castList, false);
            renderRecommendations(recList, false);

            if (isTv) {
                renderEpisodes(episodes, false, activeSeason);
            }
        }

        const loadEnd = performance.now();
        console.log(`[Performance] Details rendered from API FETCH in ${(loadEnd - loadStart).toFixed(2)}ms`);
    } catch (err) {
        console.error(`[Performance] Parallel fetch failed:`, err);
    }
}

// Ensure trailer/details flow does not block loading cast and similar items
(async () => {
    // Check if we switched items to reset the active season
    const currentId = item.mal_id || item.id || '';
    const lastId = localStorage.getItem("lastDetailsId") || '';
    if (currentId !== lastId) {
        localStorage.setItem("currentSeason", "1");
        localStorage.setItem("lastDetailsId", currentId);
    }

    loadTrailer().catch(err => {
        console.warn('loadTrailer failed:', err);
    });

    const typeLower = (item.media_type || item.mediaType || item.type || '').toString().toLowerCase();
    const isAnime = !!item.mal_id || typeLower === 'anime';
    const isMovie = typeLower === 'movie' || typeLower === 'feature';

    const castSec = document.getElementById("castSection");
    const charSec = document.getElementById("animeCharactersSection");
    const epSec = document.getElementById("episodesSection");

    // Dynamic section visibility show/hide
    if (isAnime) {
        if (castSec) castSec.style.display = 'none';
        if (charSec) charSec.style.display = 'block';
    } else {
        if (castSec) castSec.style.display = 'block';
        if (charSec) charSec.style.display = 'none';
    }

    // Hide/show episodes section & scrolling button
    const episodeBtn = document.getElementById("episodeBtn");
    if (isMovie) {
        if (epSec) epSec.style.display = 'none';
        if (episodeBtn) episodeBtn.style.display = 'none';
    } else {
        if (epSec) epSec.style.display = 'block';
        if (episodeBtn) {
            episodeBtn.style.display = 'inline-block';
            episodeBtn.addEventListener("click", () => {
                if (epSec) epSec.scrollIntoView({ behavior: 'smooth' });
            });
        }
    }

    // Parallel fetch & render
    await fetchCastAndSimilar(item.id, item.media_type || item.mediaType || item.type);
})();

// ============================================================
// PLAY BUTTON
// ============================================================
const playBtn = document.getElementById("playBtn");
if (playBtn) {
    playBtn.addEventListener("click", () => {
        const id = item.mal_id || item.id || '';
        if (id) {
            const continueWatching = JSON.parse(localStorage.getItem("continueWatching")) || [];
            const existing = continueWatching.find(c => c && (c.title || '').toLowerCase().trim() === (item.title || '').toLowerCase().trim());
            
            const epNum = existing ? existing.episode : 1;
            const seasonNum = existing ? existing.season : 1;
            
            localStorage.setItem("currentEpisode", epNum);
            localStorage.setItem("currentSeason", seasonNum);
            
            window.location.href = `watch.html?id=${id}&ep=${epNum}`;
        } else {
            alert("Playback not available for this title.");
        }
    });
}



// ============================================================
// MARK AS WATCHED BUTTON
// ============================================================
const watchedBtn = document.getElementById("watchedBtn");
if (watchedBtn) {
    // Initial UI state sync
    (async () => {
        let watched = await fetchDbToStorage("watched");
        if (watched === null) {
            watched = JSON.parse(localStorage.getItem("watched")) || [];
        }
        const isWatched = watched.some(i => i && (i.title || '').toLowerCase().trim() === (item.title || '').toLowerCase().trim());
        if (isWatched) {
            watchedBtn.innerText = "❌ Remove from Watched";
        } else {
            watchedBtn.innerText = "✅ Mark as Watched";
        }
    })();

    watchedBtn.addEventListener("click", async () => {
        console.log("[Button Clicked] Watched");
        const selectedItem = JSON.parse(localStorage.getItem("selectedItem"));
        console.log("Current item context for Watched list:", selectedItem);
        if (!selectedItem) return;

        let watched = JSON.parse(localStorage.getItem("watched")) || [];
        const isWatched = watched.some(i => i && (i.title || '').toLowerCase().trim() === (selectedItem.title || '').toLowerCase().trim());

        if (isWatched) {
            watched = watched.filter(i => i && (i.title || '').toLowerCase().trim() !== (selectedItem.title || '').toLowerCase().trim());
            watchedBtn.innerText = "✅ Mark as Watched";
            console.log("Removing from Watched. Syncing payload:", watched);
            await syncStorageToDb("watched", watched);
            alert("Removed from Watched ❌");
        } else {
            watched = watched.filter(i => i && (i.title || '').toLowerCase().trim() !== (selectedItem.title || '').toLowerCase().trim());
            watched.unshift(selectedItem);
            watchedBtn.innerText = "❌ Remove from Watched";
            console.log("Adding to Watched. Syncing payload:", watched);
            await trackUserActivity(selectedItem, 'watched');
            await syncStorageToDb("watched", watched);
            alert("Added to Watched ✅");
        }
    });
}

// ============================================================
// MY LIST BUTTON
// ============================================================
const myListBtn = document.getElementById("myListBtn");
if (myListBtn) {
    // Initial UI state sync
    (async () => {
        let myList = await fetchDbToStorage("myList");
        if (myList === null) {
            myList = JSON.parse(localStorage.getItem("myList")) || [];
        }
        const isInList = myList.some(i => i && (i.title || '').toLowerCase().trim() === (item.title || '').toLowerCase().trim());
        if (isInList) {
            myListBtn.innerText = "➖ Remove from My List";
        } else {
            myListBtn.innerText = "➕ My List";
        }
    })();

    myListBtn.addEventListener("click", async () => {
        console.log("[Button Clicked] My List");
        const selectedItem = JSON.parse(localStorage.getItem("selectedItem"));
        console.log("Current item context for My List:", selectedItem);
        if (!selectedItem) return;

        let myList = JSON.parse(localStorage.getItem("myList")) || [];
        const isInList = myList.some(i => i && (i.title || '').toLowerCase().trim() === (selectedItem.title || '').toLowerCase().trim());
        
        if (isInList) {
            myList = myList.filter(i => i && (i.title || '').toLowerCase().trim() !== (selectedItem.title || '').toLowerCase().trim());
            myListBtn.innerText = "➕ My List";
            console.log("Removing from My List. Syncing payload:", myList);
            await syncStorageToDb("myList", myList);
            alert("Removed from My List ➖");
        } else {
            myList = myList.filter(i => i && (i.title || '').toLowerCase().trim() !== (selectedItem.title || '').toLowerCase().trim());
            myList.unshift(selectedItem);
            myListBtn.innerText = "➖ Remove from My List";
            console.log("Adding to My List. Syncing payload:", myList);
            await trackUserActivity(selectedItem, 'mylist');
            await syncStorageToDb("myList", myList);
            alert("Added to My List ➕");
        }
    });
}

// ============================================================
// FAVORITES BUTTON
// ============================================================
const favoriteBtn = document.getElementById("favoriteBtn");
if (favoriteBtn) {
    // Initial UI state sync
    (async () => {
        let favorites = await fetchDbToStorage("favorites");
        if (favorites === null) {
            favorites = JSON.parse(localStorage.getItem("favorites")) || [];
        }
        const isFav = favorites.some(i => i && (i.title || '').toLowerCase().trim() === (item.title || '').toLowerCase().trim());
        if (isFav) {
            favoriteBtn.innerText = "💔 Remove Favorite";
        } else {
            favoriteBtn.innerText = "❤️ Favorite";
        }
    })();

    favoriteBtn.addEventListener("click", async () => {
        console.log("[Button Clicked] Favorite");
        const selectedItem = JSON.parse(localStorage.getItem("selectedItem"));
        console.log("Current item context for Favorites:", selectedItem);
        if (!selectedItem) return;

        let favorites = JSON.parse(localStorage.getItem("favorites")) || [];
        const isFav = favorites.some(i => i && (i.title || '').toLowerCase().trim() === (selectedItem.title || '').toLowerCase().trim());
        
        if (isFav) {
            favorites = favorites.filter(i => i && (i.title || '').toLowerCase().trim() !== (selectedItem.title || '').toLowerCase().trim());
            favoriteBtn.innerText = "❤️ Favorite";
            console.log("Removing from Favorites. Syncing payload:", favorites);
            await syncStorageToDb("favorites", favorites);
            alert("Removed from Favorites 💔");
        } else {
            favorites = favorites.filter(i => i && (i.title || '').toLowerCase().trim() !== (selectedItem.title || '').toLowerCase().trim());
            favorites.unshift(selectedItem);
            favoriteBtn.innerText = "💔 Remove Favorite";
            console.log("Adding to Favorites. Syncing payload:", favorites);
            await trackUserActivity(selectedItem, 'favorite');
            await syncStorageToDb("favorites", favorites);
            alert("Added to Favorites ❤️");
        }
    });
}