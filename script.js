import { syncStorageToDb, fetchDbToStorage, getPreferences, awaitWithTimeout, getActiveUser, db } from './db.js';
import { collection, getDocs, doc, setDoc, getDoc } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { analytics } from './analytics.js';
import { processAiQuery, saveToHistory, trackAnalytics } from './ai.js';
import { triggerSmartSuggestions } from './smartSearch.js';

const _hiddenContentSet = new Set();

const TMDB_API = "https://api.themoviedb.org/3";
const API_KEY  = "c2772546356cffa3fb0504e91da76541";

// Fetch in-memory API caching Map
const _apiCache = new Map();

// Global UI Helpers
window.showErrorState = function(message = "Something went wrong. Please try again.") {
    return `<div class="error-state">
                <h3 style="margin-bottom: 10px;">⚠ Oops!</h3>
                <p>${message}</p>
                <button onclick="window.location.reload()" class="btn-primary" style="margin-top: 15px;">Retry</button>
            </div>`;
};

window.showEmptyState = function(message = "No items found.") {
    return `<div class="empty-state">
                <div style="font-size: 40px; margin-bottom: 15px;">📭</div>
                <p>${message}</p>
            </div>`;
};

// Pre-fetch all user list data from cloud to local storage on startup
fetchDbToStorage("watchHistory");
fetchDbToStorage("continueWatching");
fetchDbToStorage("favorites");
fetchDbToStorage("watched");
fetchDbToStorage("myList");

let firstAnimeLoad = true;
let firstMovieLoad = true;
let firstTVLoad    = true;
let animePage = 1;
let moviePage = 1;
let tvPage    = 1;

const IMG = "https://image.tmdb.org/t/p/w500";

// Generic cached JSON fetcher
async function fetchCachedJson(url) {
    if (_apiCache.has(url)) return _apiCache.get(url);
    try {
        const res = await fetch(url);
        const data = await res.json();
        if (!res || !data) throw new Error("Invalid response");
        _apiCache.set(url, data);
        return data;
    } catch (err) {
        console.error("Jikan API error:", err);
        return null;
    }
}

// fetchData uses fetchCachedJson and returns results (compatible with existing code)
async function fetchData(url) {
    const data = await fetchCachedJson(url);
    return data && data.results ? data.results : [];
}

// Carousel cards renderer helper
function renderCarouselCards(items, container, typeOverride = null) {
    container.innerHTML = "";
    items.forEach(item => {
        if (typeOverride) item.media_type = typeOverride;
        createCard(item, container);
    });
    if (container.updateCarousel) {
        container.updateCarousel();
    }
}

// Carousel Scroll Navigation Initialize
function initCarouselNavigation() {
    document.querySelectorAll(".carousel-wrapper").forEach(wrapper => {
        const prevBtn = wrapper.querySelector(".carousel-nav-btn.prev");
        const nextBtn = wrapper.querySelector(".carousel-nav-btn.next");
        const container = wrapper.querySelector(".anime-container");

        if (container) {
            const updateNavButtons = () => {
                const maxScroll = container.scrollWidth - container.clientWidth;
                if (prevBtn) prevBtn.style.display = container.scrollLeft <= 0 ? "none" : "flex";
                if (nextBtn) nextBtn.style.display = container.scrollLeft >= maxScroll - 5 ? "none" : "flex";
            };

            if (prevBtn) {
                prevBtn.addEventListener("click", (e) => {
                    e.stopPropagation();
                    container.scrollBy({ left: -container.clientWidth * 0.75, behavior: 'smooth' });
                });
            }
            if (nextBtn) {
                nextBtn.addEventListener("click", (e) => {
                    e.stopPropagation();
                    container.scrollBy({ left: container.clientWidth * 0.75, behavior: 'smooth' });
                });
            }

            container.addEventListener("scroll", updateNavButtons);
            setTimeout(updateNavButtons, 600);
            window.addEventListener("resize", updateNavButtons);
            
            container.updateCarousel = updateNavButtons;
        }
    });
}

// Hero banner rotation state
let heroItems = [];
let currentHeroIndex = 0;
let heroInterval = null;

async function searchTmdbForAnime(animeTitle) {
    try {
        const searchUrl = `${TMDB_API}/search/multi?api_key=${API_KEY}&query=${encodeURIComponent(animeTitle)}`;
        const searchData = await fetchCachedJson(searchUrl);
        if (searchData && searchData.results && searchData.results.length > 0) {
            const match = searchData.results.find(r => r.backdrop_path && (r.media_type === 'tv' || r.media_type === 'movie'));
            if (match) return match;
            return searchData.results[0];
        }
    } catch (e) {
        console.error("Error searching TMDB for anime:", e);
    }
    return null;
}

async function initHeroRotation() {
    try {
        const [moviesData, tvData, animeData] = await Promise.all([
            fetchCachedJson(`${TMDB_API}/trending/movie/day?api_key=${API_KEY}`),
            fetchCachedJson(`${TMDB_API}/trending/tv/day?api_key=${API_KEY}`),
            fetchCachedJson(`https://api.jikan.moe/v4/top/anime?filter=bypopularity`)
        ]);

        const movies = (moviesData && moviesData.results ? moviesData.results.slice(0, 5) : []).map(m => ({ ...m, media_type: 'movie' }));
        const tvs = (tvData && tvData.results ? tvData.results.slice(0, 5) : []).map(t => ({ ...t, media_type: 'tv' }));
        
        let animeResults = [];
        if (animeData && Array.isArray(animeData.data)) {
            animeResults = animeData.data.slice(0, 5).map(item => ({
                title:       item.title,
                poster_path: item.images && item.images.jpg ? item.images.jpg.large_image_url : "",
                vote_average: item.score,
                overview:    item.synopsis,
                media_type:  'Anime',
                episodes:    item.episodes,
                mal_id:      item.mal_id,
                id:          null,
                release_date: item.aired && item.aired.from ? item.aired.from : ''
            }));
        }

        const combined = [];
        const length = Math.max(movies.length, tvs.length, animeResults.length);
        for (let i = 0; i < length; i++) {
            if (i < movies.length) combined.push(movies[i]);
            if (i < tvs.length) combined.push(tvs[i]);
            if (i < animeResults.length) combined.push(animeResults[i]);
        }

        if (combined.length > 0) {
            heroItems = combined;
            await showBanner(heroItems[0]);
            
            if (heroInterval) clearInterval(heroInterval);
            heroInterval = setInterval(async () => {
                currentHeroIndex = (currentHeroIndex + 1) % heroItems.length;
                await showBanner(heroItems[currentHeroIndex]);
            }, 8000);
        }
    } catch (err) {
        console.error("Hero banner rotation error:", err);
    }
}

function playHeroTrailer(item) {
    const modal = document.getElementById("homeTrailerModal");
    const player = document.getElementById("homeTrailerPlayer");
    if (!modal || !player) return;

    analytics.trackTrailerClick();

    modal.classList.remove("hidden");
    player.innerHTML = `<div style="color: white; padding: 20px; font-size: 16px;">Loading trailer...</div>`;

    const id = item.tmdb_id || item.id;
    const type = item.tmdb_type || item.media_type || (item.first_air_date ? 'tv' : 'movie');

    if (!id && item.mal_id) {
        fetchCachedJson(`https://api.jikan.moe/v4/anime/${item.mal_id}`).then(res => {
            const ytId = res && res.data && res.data.trailer && res.data.trailer.youtube_id;
            if (ytId) {
                const currentOrigin = (window.location && window.location.origin) || "http://localhost:3000";
                player.innerHTML = `
                    <iframe style="width: 100%; height: 100%; border: none;" allow="autoplay; encrypted-media; gyroscope; picture-in-picture; fullscreen" allowfullscreen 
                        src="https://www.youtube.com/embed/${ytId}?autoplay=1&mute=0&enablejsapi=1&origin=${encodeURIComponent(currentOrigin)}">
                    </iframe>`;
            } else {
                player.innerHTML = `
                    <div style="display: flex; flex-direction: column; align-items: center; justify-content: center; height: 100%; color: white; text-align: center;">
                        <h3 style="font-size: 20px; margin-bottom: 10px;">🎬 Trailer Not Available</h3>
                        <p style="color: #aaa;">Could not find an official YouTube trailer for this anime.</p>
                    </div>`;
            }
        }).catch(err => {
            console.error("Error loading Jikan hero trailer:", err);
            player.innerHTML = `
                <div style="display: flex; flex-direction: column; align-items: center; justify-content: center; height: 100%; color: white; text-align: center;">
                    <h3 style="font-size: 20px; margin-bottom: 10px;">🎬 Trailer Not Available</h3>
                    <p style="color: #aaa;">Failed to load trailer.</p>
                </div>`;
        });
        return;
    }

    if (!id) {
        player.innerHTML = `
            <div style="display: flex; flex-direction: column; align-items: center; justify-content: center; height: 100%; color: white; text-align: center;">
                <h3 style="font-size: 20px; margin-bottom: 10px;">🎬 Trailer Not Available</h3>
                <p style="color: #aaa;">Trailer not available for this item.</p>
            </div>`;
        return;
    }

    fetchCachedJson(`${TMDB_API}/${type}/${id}/videos?api_key=${API_KEY}`).then(videoRes => {
        const ytId = videoRes && videoRes.results ? findBestTrailer(videoRes.results) : null;
        if (ytId) {
            const currentOrigin = (window.location && window.location.origin) || "http://localhost:3000";
            player.innerHTML = `
                <iframe style="width: 100%; height: 100%; border: none;" allow="autoplay; encrypted-media; gyroscope; picture-in-picture; fullscreen" allowfullscreen 
                    src="https://www.youtube.com/embed/${ytId}?autoplay=1&mute=0&enablejsapi=1&origin=${encodeURIComponent(currentOrigin)}">
                </iframe>`;
        } else {
            player.innerHTML = `
                <div style="display: flex; flex-direction: column; align-items: center; justify-content: center; height: 100%; color: white; text-align: center;">
                    <h3 style="font-size: 20px; margin-bottom: 10px;">🎬 Trailer Not Available</h3>
                    <p style="color: #aaa;">Could not find an official YouTube trailer for this title.</p>
                </div>`;
        }
    }).catch(err => {
        console.error("Error loading hero trailer:", err);
        player.innerHTML = `
            <div style="display: flex; flex-direction: column; align-items: center; justify-content: center; height: 100%; color: white; text-align: center;">
                <h3 style="font-size: 20px; margin-bottom: 10px;">🎬 Trailer Not Available</h3>
                <p style="color: #aaa;">Failed to load trailer.</p>
            </div>`;
    });
}

function findBestTrailer(results) {
    if (!results || !Array.isArray(results)) return null;
    const ytVideos = results.filter(v => v.site === "YouTube" && v.key);
    if (ytVideos.length === 0) return null;

    let match = ytVideos.find(v => v.type === "Trailer" && (v.name || "").toLowerCase().includes("official"));
    if (match) return match.key;

    match = ytVideos.find(v => v.type === "Trailer");
    if (match) return match.key;

    match = ytVideos.find(v => v.type === "Teaser");
    if (match) return match.key;

    match = ytVideos.find(v => v.type === "Clip");
    if (match) return match.key;

    return ytVideos[0].key;
}

// Genre maps for Filtering
const GENRE_MAPS = {
    Action:    { tmdbMovie: 28,    tmdbTv: 10759, jikan: 1 },
    Adventure: { tmdbMovie: 12,    tmdbTv: 10759, jikan: 2 },
    Comedy:    { tmdbMovie: 35,    tmdbTv: 35,    jikan: 4 },
    Fantasy:   { tmdbMovie: 14,    tmdbTv: 10765, jikan: 10 },
    Romance:   { tmdbMovie: 10749, tmdbTv: 10766, jikan: 22 },
    "Sci-Fi":  { tmdbMovie: 878,    tmdbTv: 10765, jikan: 24 },
    Horror:    { tmdbMovie: 27,    tmdbTv: 9648,  jikan: 14 }
};

// Setup genre click triggers
document.querySelectorAll(".genre-pill").forEach(pill => {
    pill.addEventListener("click", () => {
        document.querySelectorAll(".genre-pill").forEach(p => p.classList.remove("active"));
        pill.classList.add("active");
        
        const genre = pill.getAttribute("data-genre");
        const homeMain = document.getElementById("homeMainContent");
        const genreFilter = document.getElementById("genreFilterSection");
        const banner = document.querySelector(".banner");
        
        if (genre === "all") {
            if (homeMain) homeMain.classList.remove("hidden");
            if (genreFilter) genreFilter.classList.add("hidden");
            if (banner) banner.style.display = "flex";
            document.querySelectorAll(".carousel-container").forEach(c => {
                if (c.updateCarousel) c.updateCarousel();
            });
        } else {
            if (homeMain) homeMain.classList.add("hidden");
            if (genreFilter) genreFilter.classList.remove("hidden");
            if (banner) banner.style.display = "none";
            filterByGenre(genre);
        }
    });
});

async function filterByGenre(genreName) {
    const container = document.getElementById("genreFilterContainer");
    const title = document.getElementById("genreFilterTitle");
    if (!container) return;

    title.innerText = `${genreName} Catalog`;
    container.innerHTML = `
        <div class="skeleton-card"><div class="skeleton-thumbnail"></div><div class="skeleton-details"><div class="skeleton-title"></div><div class="skeleton-meta"></div></div></div>
        <div class="skeleton-card"><div class="skeleton-thumbnail"></div><div class="skeleton-details"><div class="skeleton-title"></div><div class="skeleton-meta"></div></div></div>
        <div class="skeleton-card"><div class="skeleton-thumbnail"></div><div class="skeleton-details"><div class="skeleton-title"></div><div class="skeleton-meta"></div></div></div>
        <div class="skeleton-card"><div class="skeleton-thumbnail"></div><div class="skeleton-details"><div class="skeleton-title"></div><div class="skeleton-meta"></div></div></div>`;

    const map = GENRE_MAPS[genreName];
    if (!map) return;

    try {
        const [movies, tvs, anime] = await Promise.all([
            fetchCachedJson(`${TMDB_API}/discover/movie?api_key=${API_KEY}&with_genres=${map.tmdbMovie}&sort_by=popularity.desc`),
            fetchCachedJson(`${TMDB_API}/discover/tv?api_key=${API_KEY}&with_genres=${map.tmdbTv}&sort_by=popularity.desc`),
            fetchCachedJson(`https://api.jikan.moe/v4/anime?genres=${map.jikan}&order_by=popularity&sort=desc`)
        ]);

        const movieItems = (movies && movies.results ? movies.results : []).map(r => ({ ...r, media_type: 'movie' }));
        const tvItems = (tvs && tvs.results ? tvs.results : []).map(r => ({ ...r, media_type: 'tv' }));
        const animeItems = (anime && anime.data ? anime.data : []).map(item => ({
            title:       item.title,
            poster_path: item.images && item.images.jpg ? item.images.jpg.large_image_url : "",
            vote_average: item.score,
            overview:    item.synopsis,
            type:        'Anime',
            media_type:  'Anime',
            episodes:    item.episodes,
            mal_id:      item.mal_id,
            id:          null,
            release_date: item.aired && item.aired.from ? item.aired.from : ''
        }));

        const combined = [...movieItems, ...tvItems, ...animeItems].sort((a,b) => (b.vote_average || 0) - (a.vote_average || 0));

        container.innerHTML = "";
        if (combined.length === 0) {
            container.innerHTML = window.showEmptyState("No titles found in this genre.");
        } else {
            combined.forEach(item => createCard(item, container));
        }
    } catch (e) {
        console.error("Genre filter loading error:", e);
        container.innerHTML = window.showErrorState("Failed to load catalog. Please try again later.");
    }
}

// Close home trailer modal
const closeTrailerModal = document.getElementById("closeTrailerModal");
if (closeTrailerModal) {
    closeTrailerModal.addEventListener("click", () => {
        const modal = document.getElementById("homeTrailerModal");
        const player = document.getElementById("homeTrailerPlayer");
        if (modal) modal.classList.add("hidden");
        if (player) player.innerHTML = ""; // Stop playback
    });
}

// Floating back-to-top button logic
const backToTopBtn = document.getElementById("backToTopBtn");
if (backToTopBtn) {
    window.addEventListener("scroll", () => {
        if (window.scrollY > 400) {
            backToTopBtn.classList.remove("hidden");
        } else {
            backToTopBtn.classList.add("hidden");
        }
    });
    backToTopBtn.addEventListener("click", () => {
        window.scrollTo({ top: 0, behavior: 'smooth' });
    });
}

// Improved search suggestions
const search = document.getElementById("search");

if (search) {
    search.addEventListener("focus", () => {
        const query = search.value.trim();
        if (query.length === 0) {
            renderRecentSearches();
        }
    });

    search.addEventListener("keyup", async () => {
        const query = search.value.trim();
        if (query.length === 0) {
            renderRecentSearches();
        } else {
            const results = document.getElementById("searchResults");
            triggerSmartSuggestions(query, results);
        }
    });
}

function renderRecentSearches() {
    const results = document.getElementById("searchResults");
    if (!results) return;
    
    let recents = JSON.parse(localStorage.getItem("recentSearches") || "[]");
    if (recents.length === 0) {
        results.innerHTML = "";
        results.classList.add("hidden");
        return;
    }
    
    results.innerHTML = `
        <div class="search-header" style="padding: 12px 15px; border-bottom: 1px solid rgba(255,255,255,0.05); display: flex; justify-content: space-between; align-items: center; background: rgba(0,0,0,0.2);">
            <span style="font-size: 13px; font-weight: bold; color: var(--text-muted); text-transform: uppercase; letter-spacing: 0.5px;">Recent Searches</span>
            <button id="clearSearchHistoryBtn" style="background: none; border: none; color: var(--accent); font-size: 12px; font-weight: 600; cursor: pointer;">Clear All</button>
        </div>
    `;
    results.classList.remove("hidden");
    
    recents.forEach(term => {
        const div = document.createElement("div");
        div.classList.add("search-item");
        div.innerHTML = `
            <span style="font-size: 14px; margin-right: 10px;">🕒</span>
            <p style="flex: 1;">${term}</p>
        `;
        div.addEventListener("click", () => {
            search.value = term;
            triggerSmartSuggestions(term, results);
        });
        results.appendChild(div);
    });
    
    const clearBtn = document.getElementById("clearSearchHistoryBtn");
    if (clearBtn) {
        clearBtn.addEventListener("click", (e) => {
            e.stopPropagation();
            localStorage.setItem("recentSearches", "[]");
            results.innerHTML = "";
            results.classList.add("hidden");
        });
    }
}

async function triggerSearch(query) {
    if (query.length < 2) {
        const results = document.getElementById("searchResults");
        if (results) {
            results.innerHTML = "";
            results.classList.add("hidden");
        }
        return;
    }

    try {
        const res = await fetch(`${TMDB_API}/search/multi?api_key=${API_KEY}&query=${encodeURIComponent(query)}`);
        const data = await res.json();
        const results = document.getElementById("searchResults");
        if (!results) return;

        results.innerHTML = "";
        if (data.results && data.results.length > 0) {
            results.classList.remove("hidden");
            data.results.slice(0, 5).forEach(item => {
                if (!item.poster_path) return;
                const title = item.title || item.name;
                if (title && _hiddenContentSet.has(title.toLowerCase().trim())) return;
                if (item.id && (_hiddenContentSet.has(`tmdb_${item.id}`) || _hiddenContentSet.has(`anime_${item.id}`))) return;

                const div = document.createElement("div");
                div.classList.add("search-item");

                div.innerHTML = `
                    <img src="${IMG + item.poster_path}" loading="lazy" />
                    <p style="flex: 1;">${item.title || item.name}</p>
                    <span style="font-size:11px;background:rgba(229,9,20,0.8);color:#fff;border-radius:4px;padding:2px 6px;">${(item.media_type || 'media').toUpperCase()}</span>
                `;

                div.addEventListener("click", async () => {
                    saveSearchQuery(query);
                    const selectedItem = {
                        title:       item.title || item.name,
                        image:       IMG + item.poster_path,
                        rating:      item.vote_average,
                        description: item.overview,
                        type:        item.media_type || '',
                        mediaType:   item.media_type || '',
                        year:        (item.release_date || item.first_air_date || '').slice(0, 4),
                        episodes:    item.number_of_episodes || null,
                        id:          item.id     || null,
                        mal_id:      null,
                    };

                    localStorage.setItem("selectedItem", JSON.stringify(selectedItem));

                    // WATCH HISTORY
                    let watchHistory = JSON.parse(localStorage.getItem("watchHistory")) || [];
                    watchHistory = watchHistory.filter(h => !(h && h.title && h.title.toLowerCase().trim() === selectedItem.title.toLowerCase().trim()));
                    watchHistory.unshift(selectedItem);
                    watchHistory = watchHistory.slice(0, 20);
                    await syncStorageToDb("watchHistory", watchHistory);

                    window.location.href = "details.html";
                });

                results.appendChild(div);
            });
        } else {
            analytics.trackSearch(query, false);
            results.classList.add("hidden");
        }
    } catch (err) {
        console.error("Search error:", err);
        const results = document.getElementById("searchResults");
        if (results) results.innerHTML = window.showErrorState("Search failed. Please try again later.");
    }
}

function saveSearchQuery(query) {
    if (!query) return;
    let recents = JSON.parse(localStorage.getItem("recentSearches") || "[]");
    recents = recents.filter(q => q.toLowerCase().trim() !== query.toLowerCase().trim());
    recents.unshift(query);
    recents = recents.slice(0, 5);
    localStorage.setItem("recentSearches", JSON.stringify(recents));
}

// Close search dropdown on click outside
document.addEventListener("click", (e) => {
    const searchBox = document.querySelector(".search-box");
    const results = document.getElementById("searchResults");
    if (searchBox && results && !searchBox.contains(e.target)) {
        results.classList.add("hidden");
    }
});

// Category loads helpers
async function loadTrendingThisWeek() {
    const results = await fetchData(`${TMDB_API}/trending/all/week?api_key=${API_KEY}`);
    const container = document.getElementById("trendingWeekContainer");
    if (container) renderCarouselCards(results, container);
}

async function loadTopRatedMovies() {
    const results = await fetchData(`${TMDB_API}/movie/top_rated?api_key=${API_KEY}`);
    const container = document.getElementById("topRatedMoviesContainer");
    if (container) renderCarouselCards(results, container, 'movie');
}

async function loadTopRatedTV() {
    const results = await fetchData(`${TMDB_API}/tv/top_rated?api_key=${API_KEY}`);
    const container = document.getElementById("topRatedTVContainer");
    if (container) renderCarouselCards(results, container, 'tv');
}

async function loadTopRatedAnime() {
    const data = await fetchCachedJson(`https://api.jikan.moe/v4/top/anime?filter=bypopularity`);
    const container = document.getElementById("topRatedAnimeContainer");
    if (container && data && data.data) {
        const items = data.data.map(item => ({
            title:       item.title,
            poster_path: item.images && item.images.jpg ? item.images.jpg.large_image_url : "",
            vote_average: item.score,
            overview:    item.synopsis,
            type:        'Anime',
            media_type:  'Anime',
            episodes:    item.episodes,
            mal_id:      item.mal_id,
            id:          null,
            release_date: item.aired && item.aired.from ? item.aired.from : ''
        }));
        renderCarouselCards(items, container);
    }
}

async function loadNewReleases() {
    const results = await fetchData(`${TMDB_API}/movie/now_playing?api_key=${API_KEY}`);
    const container = document.getElementById("newReleasesContainer");
    if (container) renderCarouselCards(results, container, 'movie');
}

async function loadAnime() {
    try {
        const data = await fetchCachedJson(`https://api.jikan.moe/v4/top/anime?page=${animePage}`);
        const container = document.getElementById("animeContainer");
        if (!container) return;

        if (firstAnimeLoad) {
            container.innerHTML = "";
            firstAnimeLoad = false;
        }

        if (data && Array.isArray(data.data)) {
            data.data.forEach(item => {
                createCard(
                    {
                        title:       item.title,
                        poster_path: item.images && item.images.jpg ? item.images.jpg.large_image_url : "",
                        vote_average: item.score,
                        overview:    item.synopsis,
                        type:        item.type,
                        media_type:  'Anime',
                        episodes:    item.episodes,
                        mal_id:      item.mal_id,
                        id:          null,
                        release_date: item.aired && item.aired.from ? item.aired.from : ''
                    },
                    container
                );
            });
        } else {
            console.warn("loadAnime: Invalid Jikan API response format", data);
        }
        if (container.updateCarousel) {
            container.updateCarousel();
        }
    } catch (error) {
        console.error("Failed to load anime:", error);
    }
}

async function loadMovies() {
    try {
        const data = await fetchData(`${TMDB_API}/movie/popular?api_key=${API_KEY}&page=${moviePage}`);
        const container = document.getElementById("popularMovies");
        if (!container) return;

        if (firstMovieLoad) {
            container.innerHTML = "";
            firstMovieLoad = false;
        }

        if (data && Array.isArray(data)) {
            data.forEach(item => {
                item.media_type = 'movie';
                createCard(item, container);
            });
        }
        if (container.updateCarousel) {
            container.updateCarousel();
        }
    } catch (error) {
        console.error("Failed to load movies:", error);
    }
}

async function loadTV() {
    try {
        const data = await fetchData(`${TMDB_API}/tv/popular?api_key=${API_KEY}&page=${tvPage}`);
        const container = document.getElementById("popularTV");
        if (!container) return;

        if (firstTVLoad) {
            container.innerHTML = "";
            firstTVLoad = false;
        }

        if (data && Array.isArray(data)) {
            data.forEach(item => {
                item.media_type = 'tv';
                createCard(item, container);
            });
        }
        if (container.updateCarousel) {
            container.updateCarousel();
        }
    } catch (error) {
        console.error("Failed to load TV series:", error);
    }
}
// ======================
// CREATE CARD
// ======================
function createCard(rawItem, container) {
    const title = rawItem.title || rawItem.name;
    if (title && _hiddenContentSet.has(title.toLowerCase().trim())) {
        return;
    }
    const id = rawItem.id || rawItem.mal_id;
    if (id && (_hiddenContentSet.has(`tmdb_${id}`) || _hiddenContentSet.has(`anime_${id}`))) {
        return;
    }

    const card = document.createElement("div");
    card.classList.add("card");
    const image = rawItem.poster_path && rawItem.poster_path.startsWith("http")
        ? rawItem.poster_path
        : IMG + rawItem.poster_path;
    const rating      = rawItem.vote_average || rawItem.rating;
    const description = rawItem.overview    || rawItem.description;

    card.innerHTML = `
        <img src="${image}" alt="${title}" loading="lazy" />
        <div class="card-content">
            <h3>${title}</h3>
            <div class="card-meta">
                <span class="rating">⭐ ${rating ? (typeof rating === 'number' ? rating.toFixed(1) : rating) : "N/A"}</span>
            </div>
        </div>
    `;

    card.addEventListener("click", async () => {
        const selectedItem = {
            title:       title,
            image:       image,
            rating:      rating,
            description: description,
            type:        rawItem.media_type || rawItem.type || '',
            mediaType:   rawItem.media_type || rawItem.type || '',
            year:        (rawItem.release_date || rawItem.first_air_date || '').slice(0, 4),
            episodes:    rawItem.number_of_episodes || rawItem.episodes || null,
            id:          rawItem.id     || null,
            mal_id:      rawItem.mal_id || null,
        };

        localStorage.setItem("selectedItem", JSON.stringify(selectedItem));

        let watchHistory = JSON.parse(localStorage.getItem("watchHistory")) || [];
        watchHistory = watchHistory.filter(h => {
            const sameTitle = h && h.title && h.title.toLowerCase().trim() === selectedItem.title.toLowerCase().trim();
            const sameImage = h && h.image && h.image === selectedItem.image;
            return !(sameTitle || sameImage);
        });

        watchHistory.unshift(selectedItem);
        watchHistory = watchHistory.slice(0, 20);
        await awaitWithTimeout(syncStorageToDb("watchHistory", watchHistory), 150);
        window.location.href = "details.html";
    });

    container.appendChild(card);
}

// ======================
// HERO BANNER
// ======================
async function showBanner(item) {
    const banner = document.querySelector(".banner");
    if (!banner || !item) return;

    // Resolve TMDB details for anime if not already done
    if (item.media_type === 'Anime' && !item.backdrop_path && !item.tmdb_resolved) {
        item.tmdb_resolved = true;
        const tmdbMatch = await searchTmdbForAnime(item.title);
        if (tmdbMatch) {
            item.backdrop_path = tmdbMatch.backdrop_path;
            item.tmdb_id = tmdbMatch.id;
            item.tmdb_type = tmdbMatch.media_type || 'tv';
            if (!item.overview) item.overview = tmdbMatch.overview;
            if (tmdbMatch.vote_average) {
                item.vote_average = tmdbMatch.vote_average;
            }
        }
    }

    // Start smooth fade transition by adding fading class
    banner.classList.add("fading");

    // Wait for the fade-out (500ms) before changing contents
    setTimeout(() => {
        const title = item.title || item.name;
        let backdrop = "";
        if (item.backdrop_path) {
            const size = window.innerWidth <= 768 ? "w780" : "w1280";
            backdrop = item.backdrop_path.startsWith("http") ? item.backdrop_path : `https://image.tmdb.org/t/p/${size}` + item.backdrop_path;
        } else if (item.poster_path) {
            backdrop = item.poster_path; // fallback
        }

        banner.style.backgroundImage = backdrop ? `url(${backdrop})` : "none";

        const bannerTitle = document.getElementById("bannerTitle");
        if (bannerTitle) bannerTitle.innerText = title;

        const bannerDescription = document.getElementById("bannerDescription");
        if (bannerDescription) bannerDescription.innerText = item.overview || "No description available.";

        const bannerRating = document.getElementById("bannerRating");
        if (bannerRating) bannerRating.innerText = item.vote_average ? `⭐ ${Number(item.vote_average).toFixed(1)}` : "";

        const bannerType = document.getElementById("bannerType");
        if (bannerType) {
            bannerType.innerText = item.media_type.toUpperCase();
        }

        const playBtn = document.getElementById("bannerPlayBtn");
        const detailsBtn = document.getElementById("bannerDetailsBtn");

        if (playBtn) {
            const newPlayBtn = playBtn.cloneNode(true);
            playBtn.parentNode.replaceChild(newPlayBtn, playBtn);
            newPlayBtn.addEventListener("click", () => {
                analytics.trackTrailerClick(title);
                playHeroTrailer(item);
            });
        }

        if (detailsBtn) {
            const newDetailsBtn = detailsBtn.cloneNode(true);
            detailsBtn.parentNode.replaceChild(newDetailsBtn, detailsBtn);
            newDetailsBtn.addEventListener("click", () => {
                const selectedItem = {
                    title:       title,
                    image:       item.poster_path && item.poster_path.startsWith("http") ? item.poster_path : (item.poster_path ? IMG + item.poster_path : (item.backdrop_path ? "https://image.tmdb.org/t/p/w500" + item.backdrop_path : "")),
                    rating:      item.vote_average || null,
                    description: item.overview || "",
                    type:        item.media_type || (item.first_air_date ? 'tv' : 'movie'),
                    mediaType:   item.media_type || (item.first_air_date ? 'tv' : 'movie'),
                    year:        (item.release_date || item.first_air_date || '').slice(0, 4),
                    episodes:    item.number_of_episodes || item.episodes || null,
                    id:          item.id || item.tmdb_id || null,
                    mal_id:      item.mal_id || null,
                };
                localStorage.setItem("selectedItem", JSON.stringify(selectedItem));
                window.location.href = "details.html";
            });
        }

        // Fade back in
        banner.classList.remove("fading");
    }, 500);
}





// ======================
// CONTINUE WATCHING
// ======================
async function loadContinueWatching() {
    let data = await fetchDbToStorage("continueWatching");
    if (data === null) {
        data = JSON.parse(localStorage.getItem("continueWatching")) || [];
    }
    if (data.length === 0) return;

    // Deduplicate continue watching list by title (case-insensitive & trimmed)
    const cleaned = [];
    const seen = new Set();
    let hasDuplicates = false;
    data.forEach(item => {
        if (!item) return;
        const titleKey = (item.title || item.name || '').toLowerCase().trim();
        if (titleKey) {
            if (!seen.has(titleKey)) {
                seen.add(titleKey);
                cleaned.push(item);
            } else {
                hasDuplicates = true;
            }
        }
    });

    if (hasDuplicates) {
        data = cleaned;
        await syncStorageToDb("continueWatching", data);
    }

    const container = document.getElementById("continueContainer");
    const section = document.getElementById("continueSection");
    if(!container || !section) return;

    section.classList.remove("hidden");
    container.innerHTML = "";

    data.forEach(item => {
        if (!item) return;
        const card = document.createElement("div");
        card.classList.add("card");
        
        const progress = item.progress || 0;
        const episodeStr = item.media_type === "Movie" ? "Movie" : `Episode ${item.episode || 1}`;
        const posterUrl = item.poster || item.image || '';

        card.innerHTML = `
            <img src="${posterUrl}" alt="${item.title || 'Unknown'}" loading="lazy" />
            <div class="card-content">
                <h3>${item.title || 'Unknown'}</h3>
                <div class="continue-meta" style="margin-top: 4px;">
                    <span class="episode-info" style="font-size: 13px; color: var(--text-muted); font-weight: 600;">${episodeStr}</span>
                    <div class="progress-bar-container" style="background: rgba(255,255,255,0.1); height: 6px; border-radius: 3px; margin: 6px 0; overflow: hidden;">
                        <div class="progress-bar-fill" style="width: ${progress}%; background: var(--accent); height: 100%; border-radius: 3px;"></div>
                    </div>
                    <div class="progress-text" style="font-size: 12px; color: var(--text-muted); font-weight: 500; text-align: right; margin-bottom: 8px;">${progress}% watched</div>
                </div>
                <button class="resume-btn" style="width: 100%; padding: 8px; background: var(--accent); color: white; border: none; border-radius: 20px; font-weight: 600; font-size: 13px; cursor: pointer; transition: var(--transition); display: flex; align-items: center; justify-content: center; gap: 6px;">
                    ▶ Resume
                </button>
            </div>
        `;
        
        const navigateToWatch = () => {
            localStorage.setItem("selectedItem", JSON.stringify(item));
            localStorage.setItem("currentSeason", item.season || 1);
            localStorage.setItem("currentEpisode", item.episode || 1);
            const id = item.id || item.mal_id || '';
            window.location.href = `watch.html?id=${id}&ep=${item.episode || 1}`;
        };

        const resumeBtn = card.querySelector(".resume-btn");
        if (resumeBtn) {
            resumeBtn.addEventListener("click", (e) => {
                e.stopPropagation();
                navigateToWatch();
            });
        }
        
        card.addEventListener("click", () => {
            localStorage.setItem("selectedItem", JSON.stringify(item));
            window.location.href = "details.html";
        });
        
        container.appendChild(card);
    });
    if (container.updateCarousel) {
        container.updateCarousel();
    }
}

// ======================
// CHATBOT (Context-Aware / Unified AnimeVerse AI)
// ======================

const chatToggle = document.getElementById("chatToggle");
const chatbot    = document.getElementById("chatbot");
const closeChat  = document.getElementById("closeChat");
const chatOverlay= document.getElementById("chatOverlay");

let popupSessionId = Date.now().toString();
let popupContext = { lastGenre: null, lastTitle: null, modifier: null };

function toggleChat() {
    chatbot.classList.toggle("hidden");
    if (chatOverlay) chatOverlay.classList.toggle("hidden");
}

if (chatToggle) chatToggle.addEventListener("click", toggleChat);
if (closeChat) closeChat.addEventListener("click", toggleChat);
if (chatOverlay) chatOverlay.addEventListener("click", toggleChat);

const chatInput = document.getElementById("chatInput");
const chatBtn   = document.getElementById("chatBtn");
const chatBox   = document.getElementById("chatBox");

function appendMessage(text, sender, cards = null) {
    const msg = document.createElement("div");
    msg.classList.add("message", sender === "user" ? "user-message" : "ai-message");

    let cardsHtml = '';
    if (cards && cards.length > 0) {
        cardsHtml = `<div class="chat-cards-container" style="display:flex; gap:10px; overflow-x:auto; padding-bottom:5px; margin-top:10px;">`;
        cards.forEach(card => {
            const imgUrl = card.image || `https://via.placeholder.com/120x180/1a1a1a/e50914?text=${encodeURIComponent(card.title)}`;
            const title = card.title;
            const rating = card.rating || 'N/A';
            const itemId = card.id;
            const mediaType = card.mediaType || 'movie';

            cardsHtml += `
                <div class="chat-card" style="background:#141414; border:1px solid #222; border-radius:6px; width:110px; overflow:hidden; cursor:pointer; flex-shrink:0;" onclick="handleCardClick('${title.replace(/'/g, "\\'")}', '${itemId}', '${mediaType}', '${imgUrl}')">
                    <img src="${imgUrl}" alt="${title}" style="width:100%; height:140px; object-fit:cover; display:block;">
                    <div style="padding:6px;">
                        <h4 style="font-size:11px; font-weight:600; margin:0 0 3px 0; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">${title}</h4>
                        <div style="font-size:9px; color:#aaa; display:flex; justify-content:space-between;">
                            <span>⭐ ${rating}</span>
                            <span>${mediaType.toUpperCase()}</span>
                        </div>
                    </div>
                </div>
            `;
        });
        cardsHtml += `</div>`;
    }

    // Convert markdown bold and newlines to HTML format
    const formattedText = text
        .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
        .replace(/\n/g, '<br>');

    msg.innerHTML = `
        <div>
            <div>${formattedText}</div>
            ${cardsHtml}
        </div>
    `;

    chatBox.appendChild(msg);
    chatBox.scrollTop = chatBox.scrollHeight;
}

function appendTypingIndicator() {
    const msg = document.createElement("div");
    msg.classList.add("message", "ai-message");
    msg.id = "typingIndicator";
    msg.innerHTML = "<em>typing...</em>";
    chatBox.appendChild(msg);
    chatBox.scrollTop = chatBox.scrollHeight;
}

function removeTypingIndicator() {
    const el = document.getElementById("typingIndicator");
    if (el) el.remove();
}

async function handleChatSubmit() {
    const query = chatInput.value.trim();
    if (!query) return;

    chatInput.value = "";
    appendMessage(query, "user");
    appendTypingIndicator();

    const currentUser = await getActiveUser();

    // Process intent and generate unified response
    const response = await processAiQuery(query, currentUser, popupContext);

    removeTypingIndicator();
    appendMessage(response.text, "ai", response.cards);

    // Save to Firestore
    await saveToHistory(currentUser, popupSessionId, query, response.text);
}

if (chatBtn) chatBtn.addEventListener("click", handleChatSubmit);
if (chatInput) {
    chatInput.addEventListener("keyup", e => { if (e.key === "Enter") handleChatSubmit(); });
}

window.handleCardClick = function(title, itemId, mediaType, imgUrl) {
    const isAnime = mediaType.toLowerCase() === 'anime';
    const selectedItem = {
        title: title,
        image: imgUrl,
        rating: null,
        description: "",
        type: isAnime ? 'Anime' : mediaType,
        mediaType: isAnime ? 'Anime' : mediaType,
        year: "",
        episodes: null,
        id: isAnime ? null : itemId,
        mal_id: isAnime ? itemId : null
    };
    localStorage.setItem("selectedItem", JSON.stringify(selectedItem));

    // Add to watch history
    let watchHistory = JSON.parse(localStorage.getItem("watchHistory")) || [];
    watchHistory = watchHistory.filter(h => h && (h.title || '').toLowerCase().trim() !== title.toLowerCase().trim());
    watchHistory.unshift(selectedItem);
    localStorage.setItem("watchHistory", JSON.stringify(watchHistory.slice(0, 20)));

    trackAnalytics("click", title);

    window.location.href = "details.html";
};


// ======================
// LOAD MORE
// ======================

const loadMoreBtn =
document.getElementById(
    "loadMoreBtn"
);

loadMoreBtn.addEventListener(
    "click",

    () => {

        animePage++;
        moviePage++;
        tvPage++;

        loadAnime();

        loadMovies();

        loadTV();

    }

);


// ======================
// LOAD FEATURED AND HIDDEN CONTENT
// ======================
async function loadAdminManagedContent() {
    try {
        const hiddenSnap = await getDocs(collection(db, "hiddenContent"));
        hiddenSnap.forEach(doc => {
            const data = doc.data();
            if (data.title) _hiddenContentSet.add(data.title.toLowerCase().trim());
            if (data.id) {
                const key = data.mediaType === 'Anime' ? `anime_${data.id}` : `tmdb_${data.id}`;
                _hiddenContentSet.add(key);
            }
        });

        const featuredSnap = await getDocs(collection(db, "featuredContent"));
        const featuredContainer = document.getElementById("featuredContainer");
        const featuredSection = document.getElementById("featuredSection");
        if (featuredContainer && featuredSection && !featuredSnap.empty) {
            const items = [];
            featuredSnap.forEach(doc => {
                const data = doc.data();
                const title = data.title || data.name;
                const isHidden = (title && _hiddenContentSet.has(title.toLowerCase().trim())) ||
                                 (data.id && _hiddenContentSet.has(`tmdb_${data.id}`)) ||
                                 (data.mal_id && _hiddenContentSet.has(`anime_${data.mal_id}`));
                if (!isHidden) {
                    items.push(data);
                }
            });

            if (items.length > 0) {
                featuredSection.classList.remove("hidden");
                items.sort((a, b) => new Date(b.featuredAt || 0) - new Date(a.featuredAt || 0));
                renderCarouselCards(items, featuredContainer);
            }
        }
    } catch (e) {
        console.warn("Error loading admin managed content:", e);
    }
}

// ======================
// START WEBSITE
// ======================
initCarouselNavigation();
initHeroRotation();

loadAdminManagedContent().then(() => {
    loadTrendingThisWeek();
    loadTopRatedMovies();
    loadTopRatedTV();
    loadTopRatedAnime();
    loadNewReleases();

    loadAnime();
    loadMovies();
    loadTV();
    loadContinueWatching();
});
// ======================
// PROFILE DROPDOWN
// ======================
const profileDropdownBtn = document.getElementById("profileDropdownBtn");
const dropdownMenu = document.getElementById("dropdownMenu");

if (profileDropdownBtn && dropdownMenu) {
    profileDropdownBtn.addEventListener("click", (e) => {
        dropdownMenu.classList.toggle("hidden");
        e.stopPropagation();
    });

    document.addEventListener("click", (e) => {
        if (!profileDropdownBtn.contains(e.target)) {
            dropdownMenu.classList.add("hidden");
        }
    });
}

// ======================
// VOICE SEARCH
// ======================
const voiceBtn = document.getElementById("voiceBtn");
if (voiceBtn) {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (SpeechRecognition) {
        const recognition = new SpeechRecognition();
        recognition.lang = 'en-US';
        recognition.interimResults = false;
        recognition.maxAlternatives = 1;

        voiceBtn.addEventListener("click", () => {
            voiceBtn.innerText = "🎙️";
            voiceBtn.style.color = "var(--accent)";
            recognition.start();
            console.log("Speech recognition started...");
        });

        recognition.addEventListener("result", (e) => {
            const transcript = e.results[0][0].transcript;
            console.log("Speech recognition result:", transcript);
            const searchInput = document.getElementById("search");
            if (searchInput) {
                searchInput.value = transcript;
                // Trigger keyup to trigger search query fetch
                const event = new Event('keyup');
                searchInput.dispatchEvent(event);
            }
        });

        recognition.addEventListener("end", () => {
            voiceBtn.innerText = "🎤";
            voiceBtn.style.color = "";
            console.log("Speech recognition ended.");
        });

        recognition.addEventListener("error", (e) => {
            console.error("Speech recognition error:", e.error);
            voiceBtn.innerText = "🎤";
            voiceBtn.style.color = "";
        });
    } else {
        voiceBtn.style.display = 'none';
    }
}

// ======================
// HORIZONTAL CAROUSEL CONTROLLER
// ======================
function updateNavButtons(wrapper) {
    const container = wrapper.querySelector('.carousel-container');
    const prevBtn = wrapper.querySelector('.carousel-nav-btn.prev');
    const nextBtn = wrapper.querySelector('.carousel-nav-btn.next');
    if (!container || !prevBtn || !nextBtn) return;

    const scrollLeft = container.scrollLeft;
    const maxScrollLeft = container.scrollWidth - container.clientWidth;

    // Show/hide prev button (with threshold)
    if (scrollLeft <= 5) {
        prevBtn.style.opacity = '0';
        prevBtn.style.pointerEvents = 'none';
    } else {
        prevBtn.style.opacity = '1';
        prevBtn.style.pointerEvents = 'auto';
    }

    // Show/hide next button (with threshold)
    if (scrollLeft >= maxScrollLeft - 5) {
        nextBtn.style.opacity = '0';
        nextBtn.style.pointerEvents = 'none';
    } else {
        nextBtn.style.opacity = '1';
        nextBtn.style.pointerEvents = 'auto';
    }
}

function initCarousels() {
    const wrappers = document.querySelectorAll('.carousel-wrapper');
    wrappers.forEach(wrapper => {
        const container = wrapper.querySelector('.carousel-container');
        const prevBtn = wrapper.querySelector('.carousel-nav-btn.prev');
        const nextBtn = wrapper.querySelector('.carousel-nav-btn.next');
        if (!container || !prevBtn || !nextBtn) return;

        // Prevent duplicate initialization
        if (container.dataset.carouselInitialized === 'true') {
            updateNavButtons(wrapper);
            return;
        }
        container.dataset.carouselInitialized = 'true';

        // Click events
        prevBtn.addEventListener('click', () => {
            const step = container.clientWidth * 0.75;
            container.scrollBy({ left: -step, behavior: 'smooth' });
        });

        nextBtn.addEventListener('click', () => {
            const step = container.clientWidth * 0.75;
            container.scrollBy({ left: step, behavior: 'smooth' });
        });

        // Mouse wheel support (vertical wheel scroll -> horizontal scroll)
        container.addEventListener('wheel', (e) => {
            if (e.deltaY !== 0) {
                const maxScrollLeft = container.scrollWidth - container.clientWidth;
                if ((e.deltaY < 0 && container.scrollLeft > 0) || (e.deltaY > 0 && container.scrollLeft < maxScrollLeft)) {
                    e.preventDefault();
                    container.scrollLeft += e.deltaY;
                }
            }
        }, { passive: false });

        // Mouse drag scrolling (Touch swipe support is native via overflow-x: auto)
        let isDragging = false;
        let startX = 0;
        let scrollLeftStart = 0;
        const dragThreshold = 7;

        container.addEventListener('mousedown', (e) => {
            if (e.button !== 0) return; // only left click drag
            isDragging = false;
            startX = e.clientX;
            scrollLeftStart = container.scrollLeft;
            container.style.cursor = 'grabbing';
            container.style.userSelect = 'none';

            const onMouseMove = (moveEvent) => {
                const dx = moveEvent.clientX - startX;
                if (Math.abs(dx) > dragThreshold) {
                    isDragging = true;
                    container.scrollLeft = scrollLeftStart - dx;
                }
            };

            const onMouseUp = () => {
                window.removeEventListener('mousemove', onMouseMove);
                window.removeEventListener('mouseup', onMouseUp);
                container.style.cursor = '';
                container.style.userSelect = '';
            };

            window.addEventListener('mousemove', onMouseMove);
            window.addEventListener('mouseup', onMouseUp);
        });

        // Intercept clicks on cards during a drag operation
        container.addEventListener('click', (e) => {
            if (isDragging) {
                e.preventDefault();
                e.stopPropagation();
                isDragging = false;
            }
        }, true); // Capture phase listener to prevent event bubbling

        // Update nav buttons on scroll
        container.addEventListener('scroll', () => {
            updateNavButtons(wrapper);
        });

        // Update nav buttons on window resize
        window.addEventListener('resize', () => {
            updateNavButtons(wrapper);
        });

        // Initial update
        setTimeout(() => {
            updateNavButtons(wrapper);
        }, 200);
    });
}

// Set up MutationObserver to initialize carousels as dynamic content loads
const carouselObserver = new MutationObserver(() => {
    initCarousels();
});

document.querySelectorAll('.carousel-container').forEach(container => {
    carouselObserver.observe(container, { childList: true });
});

// Run initially
initCarousels();

// ======================
// MOBILE HAMBURGER MENU TOGGLE
// ======================
function initHamburgerMenu() {
    const hamburgerBtn = document.getElementById("hamburgerBtn");
    const navOverlay = document.getElementById("navOverlay");
    const navUl = document.querySelector("nav ul");

    if (!hamburgerBtn || !navOverlay || !navUl) return;

    function toggleMenu() {
        hamburgerBtn.classList.toggle("open");
        navUl.classList.toggle("active");
        navOverlay.classList.toggle("active");
    }

    function closeMenu() {
        hamburgerBtn.classList.remove("open");
        navUl.classList.remove("active");
        navOverlay.classList.remove("active");
    }

    hamburgerBtn.addEventListener("click", (e) => {
        toggleMenu();
        e.stopPropagation();
    });

    navOverlay.addEventListener("click", closeMenu);

    // Close menu when clicking on any link inside nav ul
    navUl.querySelectorAll("a").forEach(link => {
        link.addEventListener("click", closeMenu);
    });
}

initHamburgerMenu();

// ======================
// PWA INSTALLATION PROMPT
// ======================
let deferredPrompt;
window.addEventListener('beforeinstallprompt', (e) => {
    // Prevent Chrome 67 and earlier from automatically showing the prompt
    e.preventDefault();
    // Stash the event so it can be triggered later.
    deferredPrompt = e;
    // Update UI to show the install buttons
    const installBtns = document.querySelectorAll('.install-btn');
    installBtns.forEach(btn => {
        btn.style.setProperty('display', 'flex', 'important');
    });
});

document.querySelectorAll('.install-btn').forEach(btn => {
    btn.addEventListener('click', async (e) => {
        e.preventDefault();
        if (!deferredPrompt) return;
        // Show the prompt
        deferredPrompt.prompt();
        // Wait for the user to respond to the prompt
        const { outcome } = await deferredPrompt.userChoice;
        console.log(`User response to the install prompt: ${outcome}`);
        // We've used the prompt, and can't use it again
        deferredPrompt = null;
        // Hide the install buttons
        const installBtns = document.querySelectorAll('.install-btn');
        installBtns.forEach(ib => ib.style.setProperty('display', 'none', 'important'));
    });
});

window.addEventListener('appinstalled', () => {
    // Hide the install buttons
    const installBtns = document.querySelectorAll('.install-btn');
    installBtns.forEach(ib => ib.style.setProperty('display', 'none', 'important'));
    console.log('AnimeVerse was installed.');
});
