import { syncStorageToDb, fetchDbToStorage, getPreferences, awaitWithTimeout, db } from './db.js';
import { collection, getDocs, doc, setDoc, getDoc } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { analytics } from './analytics.js';

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
            triggerSearch(query);
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
            triggerSearch(term);
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
// CHATBOT (Context-Aware)
// ======================

const chatToggle = document.getElementById("chatToggle");
const chatbot    = document.getElementById("chatbot");
const closeChat  = document.getElementById("closeChat");
const chatOverlay= document.getElementById("chatOverlay");

function toggleChat() {
    chatbot.classList.toggle("hidden");
    if (chatOverlay) chatOverlay.classList.toggle("hidden");
}

chatToggle.addEventListener("click", toggleChat);
closeChat.addEventListener("click", toggleChat);
if (chatOverlay) chatOverlay.addEventListener("click", toggleChat);

const chatInput = document.getElementById("chatInput");
const chatBtn   = document.getElementById("chatBtn");
const chatBox   = document.getElementById("chatBox");

function appendMessage(text, sender, isHtml = false) {
    const msg = document.createElement("div");
    msg.classList.add("message", sender === "user" ? "user-message" : "ai-message");
    if (isHtml) msg.innerHTML = text;
    else msg.innerText = text;
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

window.viewChatbotDetails = async function(title, image, rating, description, id, type) {
    // Log recommendation click
    try {
        const docRef = doc(db, "analytics", "recommendations");
        const docSnap = await getDoc(docRef);
        const data = docSnap.exists() ? docSnap.data() : { impressions: 0, clicks: 0, recommendedCount: {}, clickedCount: {} };
        data.clicks = (data.clicks || 0) + 1;
        const recKey = (title || "").replace(/ /g, "_");
        if (!data.clickedCount) data.clickedCount = {};
        data.clickedCount[recKey] = (data.clickedCount[recKey] || 0) + 1;
        await setDoc(docRef, data, { merge: true });
    } catch (err) {
        console.warn("Analytics log error:", err);
    }

    const selectedItem = { title, image, rating, description, id: id || null, type: type || '', mediaType: type || '', mal_id: null };
    localStorage.setItem("selectedItem", JSON.stringify(selectedItem));
    let watchHistory = JSON.parse(localStorage.getItem("watchHistory")) || [];
    watchHistory = watchHistory.filter(h => h && (h.title || '').toLowerCase().trim() !== title.toLowerCase().trim());
    watchHistory.unshift(selectedItem);
    await awaitWithTimeout(syncStorageToDb("watchHistory", watchHistory), 150);
    window.location.href = "details.html";
};

async function processQuery(query) {
    const esc = (val) => JSON.stringify(val).replace(/'/g, "&#39;");
    appendMessage(query, "user");
    const q = query.toLowerCase().trim();

    // 1. GREETINGS
    if (/^(hi|hello|hey|yo)$/.test(q)) {
        setTimeout(() => appendMessage("Hi! I'm your AnimeVerse AI Assistant. Ask me about any show, request a recommendation, or check what is in your watch lists (history, favorites, watched list, or My List)!", "ai"), 400);
        return;
    }
    if (q.includes("how are you")) {
        setTimeout(() => appendMessage("I'm doing awesome! Ready to analyze your watch habits and recommend your next favorite show. What are you in the mood for?", "ai"), 400);
        return;
    }

    // Retrieve user collections
    const watchHistory = JSON.parse(localStorage.getItem("watchHistory")) || [];
    const favorites    = JSON.parse(localStorage.getItem("favorites"))    || [];
    const watched      = JSON.parse(localStorage.getItem("watched"))      || [];
    const myList       = JSON.parse(localStorage.getItem("myList"))       || [];

    // 2. CHECK HISTORY QUERY
    if (q.includes("history") || q.includes("watch history") || q.includes("what did i watch") || q.includes("what have i watched")) {
        if (watchHistory.length === 0) {
            appendMessage("Your watch history is currently empty. Start watching some titles to populate it! 🎬", "ai");
        } else {
            const titles = watchHistory.slice(0, 5).map(item => `• ${item.title || item.name}`).join("<br>");
            appendMessage(`Here are your most recently watched titles:<br>${titles}`, "ai", true);
        }
        return;
    }

    // 3. CHECK FAVORITES QUERY
    if (q.includes("favorite") || q.includes("favorites") || q.includes("my favorite")) {
        if (favorites.length === 0) {
            appendMessage("You haven't added any titles to your Favorites list yet. ❤️", "ai");
        } else {
            const titles = favorites.slice(0, 5).map(item => `• ${item.title || item.name}`).join("<br>");
            appendMessage(`Here are your favorite titles:<br>${titles}`, "ai", true);
        }
        return;
    }

    // 4. CHECK WATCHED QUERY
    if (q.includes("watched list") || q.includes("watched") || q.includes("what i marked watched")) {
        if (watched.length === 0) {
            appendMessage("You haven't marked any titles as watched yet. ✅", "ai");
        } else {
            const titles = watched.slice(0, 5).map(item => `• ${item.title || item.name}`).join("<br>");
            appendMessage(`Here are the titles you marked as watched:<br>${titles}`, "ai", true);
        }
        return;
    }

    // 5. CHECK MY LIST QUERY
    if (q.includes("my list") || q.includes("mylist") || q.includes("watchlist") || q.includes("my watchlist")) {
        if (myList.length === 0) {
            appendMessage("Your list is currently empty. Click the 'My List' button on details pages to save titles for later! ➕", "ai");
        } else {
            const titles = myList.slice(0, 5).map(item => `• ${item.title || item.name}`).join("<br>");
            appendMessage(`Here are the titles on your My List:<br>${titles}`, "ai", true);
        }
        return;
    }

    // 6. RECOMMENDATION OR SUGGESTION QUERY
    if (q.includes("recommend") || q.includes("suggest") || q.includes("what should i watch") || q.includes("next show") || q.includes("next movie")) {
        appendTypingIndicator();
        
        // Load preferences from Firestore
        const prefs = await getPreferences();
        
        // Analyze genres dynamically from all 4 lists
        const genresTally = {};
        [...watchHistory, ...favorites, ...watched, ...myList].forEach(item => {
            if (item && item.genres) {
                const itemGenres = Array.isArray(item.genres) ? item.genres : (typeof item.genres === 'string' ? item.genres.split(',') : []);
                itemGenres.forEach(g => {
                    const name = typeof g === 'object' ? (g.name || '') : g;
                    const cleaned = name.trim();
                    if (cleaned) genresTally[cleaned] = (genresTally[cleaned] || 0) + 1;
                });
            }
        });
        
        let favoriteGenres = Object.entries(genresTally).sort((a,b) => b[1]-a[1]).slice(0,2).map(e=>e[0]);
        if (favoriteGenres.length === 0) {
            favoriteGenres = Object.entries(prefs.genres || {}).sort((a,b) => b[1]-a[1]).slice(0,2).map(e=>e[0]);
        }
        if (favoriteGenres.length === 0) {
            favoriteGenres = ["Action", "Drama"]; // defaults
        }

        const watchedTitlesSet = new Set(
            [...watchHistory, ...watched, ...favorites, ...myList]
                .map(i => (i.title || '').toLowerCase().trim())
        );

        let recommendTitle = "";
        let recommendOverview = "";
        let recommendImage = "";
        let recommendRating = "";
        let recommendId = "";
        let recommendMediaType = "tv";

        const hasActionShonen = Array.from(watchedTitlesSet).some(t => 
            t.includes("attack on titan") || 
            t.includes("jujutsu kaisen") || 
            t.includes("demon slayer") ||
            t.includes("naruto") ||
            t.includes("bleach")
        );

        if (hasActionShonen) {
            // Recommend Chainsaw Man, Hell's Paradise, or Solo Leveling
            const suggestions = [
                { title: "Solo Leveling", id: 216090, type: "tv", overview: "In a world where hunters must battle deadly monsters to protect mankind, Sung Jinwoo, the weakest hunter of all mankind, finds himself in a struggle for survival.", rating: "8.7", poster_path: "/g8aH6OI45BcHbnp0gTmL2AIe95N.jpg" },
                { title: "Chainsaw Man", id: 114410, type: "tv", overview: "Denji has a simple dream—to live a happy and peaceful life, spending time with a girl he likes. This is a far cry from reality, however, as Denji is forced by the yakuza into killing devils.", rating: "8.6", poster_path: "/npdB6e5ufCCIafl4KM0J48m2chb.jpg" },
                { title: "Hell's Paradise", id: 210855, type: "tv", overview: "Gabimaru the Hollow, a ninja of Iwagakure Village known for being cold and emotionless, was set up by his fellow ninja and is now on death row.", rating: "8.5", poster_path: "/4PzC944c680Jc21Xz01V0c4rU4f.jpg" }
            ];
            const isSuggHidden = s => _hiddenContentSet.has(s.title.toLowerCase().trim()) || _hiddenContentSet.has(`tmdb_${s.id}`) || _hiddenContentSet.has(`anime_${s.id}`);
            const pick = suggestions.find(s => !watchedTitlesSet.has(s.title.toLowerCase().trim()) && !isSuggHidden(s)) || suggestions.find(s => !isSuggHidden(s)) || suggestions[0];
            recommendTitle = pick.title;
            recommendId = pick.id;
            recommendMediaType = pick.type;
            recommendOverview = pick.overview;
            recommendRating = pick.rating;
            recommendImage = IMG + pick.poster_path;
        }

        // Fallback 1: Recommend using TMDB similarity from watchHistory[0]
        if (!recommendTitle && watchHistory.length > 0) {
            try {
                const seedTitle = watchHistory[0].title;
                const search = await fetch(`${TMDB_API}/search/multi?api_key=${API_KEY}&query=${encodeURIComponent(seedTitle)}`).then(r => r.json());
                const seed = (search.results || []).find(r => r.poster_path);
                if (seed) {
                    const type = seed.media_type === 'tv' || seed.first_air_date ? 'tv' : 'movie';
                    const recs = await fetch(`${TMDB_API}/${type}/${seed.id}/recommendations?api_key=${API_KEY}`).then(r => r.json());
                    const items = recs.results || [];
                    const isItemHidden = item => _hiddenContentSet.has((item.title || item.name || '').toLowerCase().trim()) || _hiddenContentSet.has(`tmdb_${item.id}`) || _hiddenContentSet.has(`anime_${item.id}`);
                    const pick = items.find(item => item.poster_path && !watchedTitlesSet.has((item.title || item.name || '').toLowerCase().trim()) && !isItemHidden(item));
                    if (pick) {
                        recommendTitle = pick.title || pick.name;
                        recommendId = pick.id;
                        recommendMediaType = type;
                        recommendOverview = pick.overview || "";
                        recommendRating = pick.vote_average ? pick.vote_average.toFixed(1) : "N/A";
                        recommendImage = IMG + pick.poster_path;
                    }
                }
            } catch (err) {
                console.error("Fetch recommendations error:", err);
            }
        }

        // Fallback 2: Recommend matching their top genre
        if (!recommendTitle) {
            try {
                const genreQuery = favoriteGenres[0] || "action anime";
                const res = await fetch(`${TMDB_API}/search/multi?api_key=${API_KEY}&query=${encodeURIComponent(genreQuery)}`);
                const data = await res.json();
                if (data.results && data.results.length > 0) {
                    const isResultHidden = r => _hiddenContentSet.has((r.title || r.name || '').toLowerCase().trim()) || _hiddenContentSet.has(`tmdb_${r.id}`) || _hiddenContentSet.has(`anime_${r.id}`);
                    const pick = data.results.find(r => r.poster_path && !watchedTitlesSet.has((r.title || r.name || '').toLowerCase().trim()) && !isResultHidden(r)) || data.results.find(r => !isResultHidden(r)) || data.results[0];
                    recommendTitle = pick.title || pick.name;
                    recommendId = pick.id;
                    recommendMediaType = pick.media_type || "tv";
                    recommendOverview = pick.overview || "";
                    recommendRating = pick.vote_average ? pick.vote_average.toFixed(1) : "N/A";
                    recommendImage = pick.poster_path ? IMG + pick.poster_path : "";
                }
            } catch (err) {
                console.error("Fetch trending error:", err);
            }
        }

        removeTypingIndicator();

        if (recommendTitle) {
            // Log recommendation impression
            try {
                const docRef = doc(db, "analytics", "recommendations");
                const docSnap = await getDoc(docRef);
                const data = docSnap.exists() ? docSnap.data() : { impressions: 0, clicks: 0, recommendedCount: {}, clickedCount: {} };
                data.impressions = (data.impressions || 0) + 1;
                const recKey = recommendTitle.replace(/ /g, "_");
                if (!data.recommendedCount) data.recommendedCount = {};
                data.recommendedCount[recKey] = (data.recommendedCount[recKey] || 0) + 1;
                await setDoc(docRef, data, { merge: true });
            } catch (err) {
                console.warn("Analytics log error:", err);
            }

            const formattedGenres = favoriteGenres.join(" and ");
            let html = `<p style="margin-bottom:8px">You seem to enjoy <strong>${formattedGenres}</strong> anime. Based on your watch history I recommend <strong>${recommendTitle}</strong>.</p>`;
            if (recommendImage) html += `<img src="${recommendImage}" loading="lazy" style="width:100%;border-radius:8px;margin-bottom:8px;" />`;
            html += `<p style="font-size:13px;margin-bottom:4px">⭐ ${recommendRating}</p>`;
            html += `<p style="font-size:12px;line-height:1.5;opacity:0.9;margin-bottom:10px">${recommendOverview}</p>`;
            html += `<button class="btn-primary" style="padding:8px;font-size:13px;width:100%;border:none;cursor:pointer;border-radius:20px;" onclick='viewChatbotDetails(${esc(recommendTitle)},${esc(recommendImage)},${esc(recommendRating)},${esc(recommendOverview)},${esc(recommendId)},${esc(recommendMediaType)})'>▶ Watch Now</button>`;
            appendMessage(html, "ai", true);
        } else {
            appendMessage("I couldn't generate a personalized recommendation right now. Try watching or favoriting more shows first!", "ai");
        }
        return;
    }

    // 7. GENERAL SEARCH
    appendTypingIndicator();
    let searchTerm = query.replace(/^(tell me about|what is|search for|find|do you know about|info on|information about|who is)\s+/i, "").trim() || query;

    try {
        const res  = await fetch(`${TMDB_API}/search/multi?api_key=${API_KEY}&query=${encodeURIComponent(searchTerm)}`);
        const data = await res.json();
        removeTypingIndicator();

        if (data.results && data.results.length > 0) {
            analytics.trackSearch(query, true);
            const items = data.results.filter(item => item.poster_path && item.media_type !== "person" && !isContentHidden(item.title || item.name || ''));
            const item = items[0] || data.results.find(r => r.poster_path) || data.results[0];
            const title   = item.title || item.name;
            const rating  = item.vote_average ? item.vote_average.toFixed(1) : "N/A";
            const overview= item.overview || "No synopsis available.";
            const image   = item.poster_path ? IMG + item.poster_path : "";

            let html = `<p style="margin-bottom:8px">I found <strong>${title}</strong>!</p>`;
            if (image) html += `<img src="${image}" loading="lazy" style="width:100%;border-radius:8px;margin-bottom:8px;" />`;
            html += `<p style="font-size:13px;margin-bottom:4px">⭐ ${rating} &nbsp; <span style="font-size:11px;background:rgba(229,9,20,0.8);border-radius:4px;padding:2px 6px;">${(item.media_type||'').toUpperCase()}</span></p>`;
            html += `<p style="font-size:12px;line-height:1.5;opacity:0.9;margin-bottom:10px">${overview}</p>`;
            html += `<button class="btn-primary" style="padding:8px;font-size:13px;width:100%;border:none;cursor:pointer;border-radius:20px;" onclick='viewChatbotDetails(${esc(title)},${esc(image)},${esc(rating)},${esc(overview)},${esc(item.id)},${esc(item.media_type||"")})'>▶ Watch Now</button>`;
            appendMessage(html, "ai", true);
        } else {
            appendMessage(`I couldn't find anything for "${searchTerm}". Check the spelling?`, "ai");
        }
    } catch (err) {
        removeTypingIndicator();
        appendMessage("Connection error. Please try again!", "ai");
    }
}

function handleChatSubmit() {
    const val = chatInput.value.trim();
    if (!val) return;
    chatInput.value = "";
    processQuery(val);
}

chatBtn.addEventListener("click", handleChatSubmit);
chatInput.addEventListener("keyup", e => { if (e.key === "Enter") handleChatSubmit(); });


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
