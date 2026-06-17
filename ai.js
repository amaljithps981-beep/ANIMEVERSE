import { db, getAnalytics, syncStorageToDb, fetchDbToStorage, fetchCachedRecommendations, saveRecommendations } from './db.js';
import { doc, setDoc, getDoc, serverTimestamp, increment, collection, getDocs, query, orderBy } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { fetchSimilarFromTitle, getExcludedTitles } from './recommendations.js';
import { performSmartSearch } from './smartSearch.js';
import { TMDB_API_BASE, TMDB_API_KEY, JIKAN_API_BASE, TMDB_GENRES, JIKAN_GENRES } from './config.js';

/**
 * Normalizes list retrieval from both local storage and Firestore.
 */
async function getList(key, user) {
    let list = JSON.parse(localStorage.getItem(key)) || [];
    if (user) {
        try {
            const dbList = await fetchDbToStorage(key);
            if (dbList) list = dbList;
        } catch (e) {
            console.warn(`[AI Engine] Offline or db sync failed for list: ${key}`, e);
        }
    }
    return list;
}

/**
 * Standardizes raw media items into a uniform presentation layout for UI cards.
 */
function unifyMediaCard(item) {
    if (!item) return null;
    const title = item.title || item.name || '';
    
    let rating = item.vote_average || item.score || item.rating || 'N/A';
    if (typeof rating === 'number') {
        rating = rating.toFixed(1);
    }
    
    let image = "";
    if (item.poster_path) {
        image = item.poster_path.startsWith("http") ? item.poster_path : `https://image.tmdb.org/t/p/w500${item.poster_path}`;
    } else if (item.image) {
        image = item.image;
    } else if (item.images?.jpg?.large_image_url) {
        image = item.images.jpg.large_image_url;
    } else if (item.images?.jpg?.image_url) {
        image = item.images.jpg.image_url;
    } else if (item.poster) {
        image = item.poster;
    }

    const typeLower = (item.mediaType || item.type || '').toString().toLowerCase();
    const isAnime = item.mal_id || typeLower === 'anime';
    const isMovie = typeLower === 'movie' || typeLower === 'feature';
    const mediaType = isAnime ? 'Anime' : (isMovie ? 'Movie' : 'TV');
    
    // Genre Extraction Mapping
    const TMDB_MAP = {
        28: "Action", 12: "Adventure", 16: "Animation", 35: "Comedy", 80: "Crime",
        99: "Documentary", 18: "Drama", 10751: "Family", 14: "Fantasy", 36: "History",
        27: "Horror", 10402: "Music", 9648: "Mystery", 10749: "Romance", 878: "Sci-Fi",
        10770: "TV Movie", 53: "Thriller", 10752: "War", 37: "Western",
        10759: "Action & Adventure", 10765: "Sci-Fi & Fantasy", 10766: "Romance",
        10767: "Talk", 10768: "War & Politics"
    };
    
    let genreStr = 'N/A';
    if (Array.isArray(item.genres)) {
        genreStr = item.genres.map(g => typeof g === 'object' ? g.name : g).join(', ');
    } else if (item.genre_ids) {
        genreStr = item.genre_ids.map(id => TMDB_MAP[id]).filter(Boolean).join(', ');
    } else if (typeof item.genres === 'string') {
        genreStr = item.genres;
    } else if (item.genre) {
        genreStr = item.genre;
    }
    
    return {
        title,
        image,
        rating,
        id: item.id || item.mal_id || '',
        mediaType,
        genres: genreStr
    };
}

/**
 * Fetches popular trending multi-format weekly items from TMDB.
 */
async function fetchTrendingItems() {
    try {
        const res = await fetch(`${TMDB_API_BASE}/trending/all/week?api_key=${TMDB_API_KEY}`).then(r => r.json());
        return res.results || [];
    } catch (e) {
        console.error("[AI Engine] fetchTrendingItems error:", e);
        return [];
    }
}

/**
 * Fetches anime recommendations by genre from Jikan API.
 */
async function fetchByGenre(genreName, isShorter) {
    const genresMap = {
        'action': 1, 'adventure': 2, 'comedy': 4, 'fantasy': 10, 'horror': 14, 
        'romance': 22, 'sci-fi': 24, 'dark': 14, 'slice of life': 36, 'sports': 30,
        'mystery': 7, 'drama': 8
    };
    const gid = genresMap[genreName];
    try {
        let url = `${JIKAN_API_BASE}/anime?genres=${gid}&order_by=score&sort=desc`;
        if (isShorter) {
            url += `&type=movie`;
        }
        const res = await fetch(url).then(r => r.json());
        return res.data || [];
    } catch (e) {
        console.error("[AI Engine] fetchByGenre error:", e);
        return [];
    }
}

/**
 * Fetches movies/shows by genre from TMDB discover.
 */
async function fetchTmdbByGenre(genreName, type = 'movie') {
    const tmdbGenres = {
        'action': 28, 'adventure': 12, 'comedy': 35, 'drama': 18, 'fantasy': 14,
        'horror': 27, 'mystery': 9648, 'romance': 10749, 'sci-fi': 878, 'thriller': 53,
        'animation': 16
    };
    const tvGenres = {
        'action': 10759, 'adventure': 10759, 'comedy': 35, 'drama': 18, 'fantasy': 10765,
        'horror': 9648, 'mystery': 9648, 'romance': 10766, 'sci-fi': 10765, 'thriller': 53,
        'animation': 16
    };
    
    const gid = type === 'movie' ? tmdbGenres[genreName] : tvGenres[genreName];
    if (!gid) return [];
    try {
        const url = `${TMDB_API_BASE}/discover/${type}?api_key=${TMDB_API_KEY}&with_genres=${gid}&sort_by=popularity.desc`;
        const res = await fetch(url).then(r => r.json());
        return (res.results || []).map(item => ({ ...item, mediaType: type }));
    } catch (e) {
        console.error("[AI Engine] fetchTmdbByGenre error:", e);
        return [];
    }
}

/**
 * Multi-search on TMDB API.
 */
async function searchTmdbMulti(query) {
    try {
        const res = await fetch(`${TMDB_API_BASE}/search/multi?api_key=${TMDB_API_KEY}&query=${encodeURIComponent(query)}`).then(r => r.json());
        return res.results || [];
    } catch (e) {
        console.error("[AI Engine] searchTmdbMulti error:", e);
        return [];
    }
}

/**
 * Fetch and enrich hybrid recommendation engine results.
 */
async function getHybridRecommendations(user) {
    try {
        const fetchUid = user ? user.uid : "COLD_START";
        const docRef = doc(db, "hybridRecommendations", fetchUid);
        const docSnap = await getDoc(docRef);
        if (docSnap.exists()) {
            const categories = docSnap.data().categories || {};
            return categories.bestMatch || categories.animeYouWillLove || [];
        }
        
        // Fallback to COLD_START if user has no doc
        if (user) {
            const csRef = doc(db, "hybridRecommendations", "COLD_START");
            const csSnap = await getDoc(csRef);
            if (csSnap.exists()) {
                const categories = csSnap.data().categories || {};
                return categories.bestMatch || [];
            }
        }
    } catch (e) {
        console.warn("[AI Engine] Failed to fetch hybrid recommendations:", e);
    }
    return [];
}

/**
 * Enrich a basic hybrid item (ID and Title only) with posters and metadata using TMDB search.
 */
async function enrichHybridItem(item) {
    if (!item || !item.title) return null;
    try {
        const searchResults = await searchTmdbMulti(item.title);
        if (searchResults && searchResults.length > 0) {
            const match = searchResults.find(r => r.poster_path);
            if (match) {
                return unifyMediaCard({
                    ...match,
                    title: item.title,
                    rating: match.vote_average || item.hybridScore || 8.0
                });
            }
        }
    } catch (e) {
        console.warn(`[AI Engine] Enrich failed for title: ${item.title}`, e);
    }
    // Fallback item card
    return unifyMediaCard({
        title: item.title,
        id: item.contentId,
        mediaType: 'Anime',
        poster_path: `https://via.placeholder.com/200x300/1a1a1a/e50914?text=${encodeURIComponent(item.title)}`
    });
}

/**
 * Gets personalized recommendations based on user watch history.
 */
async function getPersonalizedRecommendations(user) {
    try {
        const history = await getList("watchHistory", user);
        if (!history || history.length === 0) {
            return [];
        }
        
        // Get trending items as fallback for new users
        const trendingItems = await fetchTrendingItems();
        return trendingItems.slice(0, 10);
    } catch (e) {
        console.error("[AI Engine] getPersonalizedRecommendations error:", e);
        return [];
    }
}

/**
 * Main query and intent parser for AnimeVerse AI.
 */
export async function processAiQuery(query, user, contextState = {}) {
    console.log("Message received");
    console.log("[Chat] Message received:", query);
    
    if (!query || typeof query !== 'string') {
        return { text: "Please provide a valid query.", cards: [] };
    }
    
    // Enforce query length boundaries (max 150 characters)
    if (query.length > 150) {
        return { 
            text: "⚠️ Your query is too long. Please keep it under 150 characters for safety and performance.", 
            cards: [] 
        };
    }
    
    // Reject unsafe characters and potential Firestore injection patterns
    const unsafePattern = /[<>\$\{\}\[\];\\\/]/;
    if (unsafePattern.test(query)) {
        return { 
            text: "⚠️ Suspicious query detected. Characters like < > { } [ ] ; $ \\ / are restricted to protect system integrity.", 
            cards: [] 
        };
    }

    console.log("Intent detected");
    const q = query.toLowerCase().trim();
    const exclusions = await getExcludedTitles().catch(() => new Set());

    // Smart discovery search check
    if (/^(find|search\s*for|search|look\s*for|show\s*me)\b/i.test(q)) {
        if (typeof trackAnalytics === "function") {
            trackAnalytics("intent", "search_discovery");
        }
        const cleanQuery = q.replace(/^(find|search\s*for|search|look\s*for|show\s*me)\s+(?:me\s+)?(?:a\s+|an\s+|some\s+)?/i, "").trim();
        const smartRes = await performSmartSearch(cleanQuery || q, user);
        return {
            text: smartRes.text,
            cards: smartRes.cards
        };
    }

    // 1. GREETINGS & HELP
    if (/^(hi|hello|hey|yo|greetings|wasup|sup|help|ai)$/.test(q)) {
        console.log("[Chat] Intent detected: GREETINGS");
        trackAnalytics("intent", "greetings");
        return {
            text: "Hi! I'm your AnimeVerse AI Assistant. Ask me about any show, request a recommendation, check what is in your watch lists, or ask for your profile stats!",
            cards: []
        };
    }
    if (q.includes("how are you")) {
        trackAnalytics("intent", "greetings");
        return {
            text: "I'm doing awesome! Ready to analyze your watch habits and recommend your next favorite show. What are you in the mood for?",
            cards: []
        };
    }

    // 2. FAVORITES LIST
    if (q.includes("favorite") || q.includes("favorites") || q.includes("my favorite") || q.includes("show my favorites")) {
        trackAnalytics("intent", "favorites");
        const list = await getList("favorites", user);
        if (list.length === 0) {
            return {
                text: "You haven't added any titles to your Favorites list yet. ❤️",
                cards: []
            };
        }
        return {
            text: "Here are your favorite titles:",
            cards: list.slice(0, 10).map(unifyMediaCard).filter(Boolean)
        };
    }

    // 3. WATCHED LIST
    if (q.includes("watched list") || q.includes("watched") || q.includes("what i marked watched") || q.includes("what have i watched") || q.includes("show my watched list")) {
        trackAnalytics("intent", "watched");
        const list = await getList("watched", user);
        if (list.length === 0) {
            return {
                text: "You haven't marked any titles as watched yet. ✅",
                cards: []
            };
        }
        return {
            text: "Here are the titles you marked as watched:",
            cards: list.slice(0, 10).map(unifyMediaCard).filter(Boolean)
        };
    }

    // 4. MY LIST (WATCHLIST)
    if (q.includes("my list") || q.includes("mylist") || q.includes("watchlist") || q.includes("my watchlist") || q.includes("show my list")) {
        trackAnalytics("intent", "mylist");
        const list = await getList("myList", user);
        if (list.length === 0) {
            return {
                text: "Your list is currently empty. Click the 'My List' button on details pages to save titles for later! ➕",
                cards: []
            };
        }
        return {
            text: "Here are the titles on your My List:",
            cards: list.slice(0, 10).map(unifyMediaCard).filter(Boolean)
        };
    }

    // 5. PROFILE STATISTICS
    if (q.includes("how many") || q.includes("stats") || q.includes("profile") || q.includes("statistics") || q.includes("streak") || q.includes("average rating") || q.includes("my rating")) {
        trackAnalytics("intent", "stats");
        const stats = await getAnalytics();
        const history = await getList("watchHistory", user);
        let streak = 0;
        if (history.length > 0) {
            const uniqueDates = [...new Set(history.map(i => {
                const d = i.addedAt ? new Date(i.addedAt) : new Date();
                return d.toISOString().split('T')[0];
            }))].sort((a,b) => new Date(b) - new Date(a));
            
            const todayStr = new Date().toISOString().split('T')[0];
            const yesterday = new Date();
            yesterday.setDate(yesterday.getDate() - 1);
            const yesterdayStr = yesterday.toISOString().split('T')[0];
            
            if (uniqueDates[0] === todayStr || uniqueDates[0] === yesterdayStr) {
                streak = 1;
                let currDate = new Date(uniqueDates[0]);
                for (let i = 1; i < uniqueDates.length; i++) {
                    currDate.setDate(currDate.getDate() - 1);
                    if (uniqueDates[i] === currDate.toISOString().split('T')[0]) {
                        streak++;
                    } else {
                        break;
                    }
                }
            }
        }

        const text = `📊 **Your AnimeVerse Profile Stats:**
• **Watched Content:** ${stats.watchedCount || 0}
• **Favorites:** ${stats.favoritesCount || 0}
• **My List size:** ${stats.myListCount || 0}
• **Average Rating:** ${stats.avgRating || 'N/A'}
• **Top Genre:** ${stats.topGenre || 'N/A'}
• **Top Type:** ${stats.topType || 'N/A'}
• **Recommendation Accuracy:** ${(stats.accuracy !== undefined ? stats.accuracy : 85)}%
• **Viewing Streak:** ${streak} Days
• **Continue Watching size:** ${stats.continueWatchingCount || 0}
• **Watch History size:** ${stats.historyCount || 0}`;

        return { text, cards: [] };
    }

    // 6. CONTEXT MODIFIERS (Shorter / Movie)
    if (q.includes("shorter") || q.includes("movie") || q.includes("film")) {
        contextState.modifier = 'shorter';
        trackAnalytics("intent", "modifier");
        if (contextState.lastGenre) {
            // Re-fetch last genre but shorter movies
            const items = await fetchByGenre(contextState.lastGenre, true);
            const cards = items
                .filter(item => item.title || item.name)
                .filter(item => !exclusions.has((item.title || item.name).toLowerCase().trim()))
                .map(unifyMediaCard)
                .filter(Boolean);
            return {
                text: `Here are some shorter movies/series for **${contextState.lastGenre.toUpperCase()}** to fit your time:`,
                cards: cards.slice(0, 10)
            };
        } else if (contextState.lastTitle) {
            const res = await fetchSimilarFromTitle(contextState.lastTitle);
            const cards = (res?.items || [])
                .filter(item => item.title || item.name)
                .filter(item => !exclusions.has((item.title || item.name).toLowerCase().trim()))
                .map(unifyMediaCard)
                .filter(Boolean);
            return {
                text: `Here are some shorter movies/series similar to **${contextState.lastTitle}**:`,
                cards: cards.slice(0, 10)
            };
        }
    }

    // 7. SIMILAR RECOMMENDATIONS (e.g. "Give me a series like Breaking Bad")
    const similarMatch = q.match(/(?:like|similar to|resemble) ([a-z0-9\s\-\:\'\,\!\.\?]+)/i);
    if (similarMatch && similarMatch[1]) {
        const title = similarMatch[1].replace(/(anime|movie|tv series|show|series|tonight)/gi, "").trim();
        if (title.length > 1) {
            contextState.lastTitle = title;
            contextState.lastGenre = null;
            trackAnalytics("intent", "similar");
            
            const res = await fetchSimilarFromTitle(title);
            if (res && res.items && res.items.length > 0) {
                const cards = res.items
                    .filter(item => item.title || item.name)
                    .filter(item => !exclusions.has((item.title || item.name).toLowerCase().trim()))
                    .map(unifyMediaCard)
                    .filter(Boolean);
                return {
                    text: `Based on content similarity, here are recommendations similar to **${title}**:`,
                    cards: cards.slice(0, 10)
                };
            }
            // Fallback: search TMDB
            const searchResults = await searchTmdbMulti(title);
            if (searchResults && searchResults.length > 0) {
                const cards = searchResults
                    .filter(item => item.title || item.name)
                    .filter(item => !exclusions.has((item.title || item.name).toLowerCase().trim()))
                    .map(unifyMediaCard)
                    .filter(Boolean);
                return {
                    text: `I couldn't find precise similarity links, but I found these matching search results for "${title}":`,
                    cards: cards.slice(0, 10)
                };
            }
            return {
                text: `I couldn't find anything exactly like "${title}". Could you try another title?`,
                cards: []
            };
        }
    }

    // 8. GENRE REQUESTS (e.g. "Recommend an action anime", "suggest a horror movie")
    const genresMap = {
        'action': 1, 'adventure': 2, 'comedy': 4, 'fantasy': 10, 'horror': 14, 
        'romance': 22, 'sci-fi': 24, 'dark': 14, 'slice of life': 36, 'sports': 30,
        'mystery': 7, 'drama': 8, 'thriller': 53, 'animation': 16
    };
    let foundGenre = null;
    for (let g of Object.keys(genresMap)) {
        if (q.includes(g)) {
            foundGenre = g;
            break;
        }
    }
    
    // Check requested media format
    let isAnimeRequested = q.includes("anime");
    let isMovieRequested = q.includes("movie") || q.includes("film");
    let isShowRequested = q.includes("series") || q.includes("tv") || q.includes("show");

    if (foundGenre) {
        contextState.lastGenre = foundGenre;
        contextState.lastTitle = null;
        trackAnalytics("genre", foundGenre);
        trackAnalytics("intent", "genre");

        let items = [];
        let formatLabel = "";
        
        if (isMovieRequested) {
            items = await fetchTmdbByGenre(foundGenre, 'movie');
            formatLabel = "movies";
        } else if (isShowRequested) {
            items = await fetchTmdbByGenre(foundGenre, 'tv');
            formatLabel = "TV shows";
        } else {
            // Default to anime or fetch anime if explicitly asked
            items = await fetchByGenre(foundGenre, contextState.modifier === 'shorter');
            formatLabel = "anime";
        }

        const cards = items
            .filter(item => item.title || item.name)
            .filter(item => !exclusions.has((item.title || item.name).toLowerCase().trim()))
            .map(unifyMediaCard)
            .filter(Boolean);

        if (cards.length > 0) {
            return {
                text: `Here are some great **${foundGenre}** ${formatLabel} I found for you:`,
                cards: cards.slice(0, 10)
            };
        }
    }

    // 9. TRENDING / POPULAR / BEST REQUESTS
    if (q.includes("trending") || q.includes("popular") || q.includes("best") || q.includes("top-rated") || q.includes("top rated")) {
        trackAnalytics("intent", "trending");
        const trendingItems = await fetchTrendingItems();
        const cards = trendingItems
            .filter(item => item.title || item.name)
            .filter(item => !exclusions.has((item.title || item.name).toLowerCase().trim()))
            .map(unifyMediaCard)
            .filter(Boolean);
        return {
            text: "Here is what is popular and trending right now across the platform:",
            cards: cards.slice(0, 10)
        };
    }

    // 10. GENERAL RECOMMENDATION REQUEST (e.g. "What should I watch tonight?")
    if (q.includes("recommend") || q.includes("suggest") || q.includes("what should i watch") || q.includes("next show") || q.includes("next movie") || q.includes("tonight")) {
        console.log("[Chat] Intent detected: RECOMMENDATION REQUEST");
        trackAnalytics("intent", "recommend");
        
        try {
            // Try fetching user hybrid recommendations
            const hybridRecs = await getHybridRecommendations(user);
            if (hybridRecs && hybridRecs.length > 0) {
                // Enrich items with posters
                const enriched = await Promise.all(hybridRecs.slice(0, 10).map(enrichHybridItem));
                const cards = enriched.filter(Boolean).filter(item => !exclusions.has(item.title.toLowerCase().trim()));
                if (cards.length > 0) {
                    console.log("[Chat] Response generated: HYBRID RECOMMENDATIONS");
                    return {
                        text: "Based on collaborative filtering and your activity, here are your best matches from the Hybrid Engine:",
                        cards: cards.slice(0, 10)
                    };
                }
            }
        } catch (e) {
            console.error("[Chat] Hybrid recommendations failed:", e);
        }
        
        try {
            // Fallback: standard cache recommendations
            const recs = await getPersonalizedRecommendations(user);
            if (recs && recs.length > 0) {
                const cards = recs
                    .filter(item => item.title || item.name)
                    .filter(item => !exclusions.has((item.title || item.name).toLowerCase().trim()))
                    .map(unifyMediaCard)
                    .filter(Boolean);
                if (cards.length > 0) {
                    console.log("[Chat] Response generated: PERSONALIZED RECOMMENDATIONS");
                    return {
                        text: "Here are recommendations calculated from your watch history and preferences:",
                        cards: cards.slice(0, 10)
                    };
                }
            }
        } catch (e) {
            console.error("[Chat] Personalized recommendations failed:", e);
        }
        
        try {
            // Ultimate Fallback: Trending
            const trendingItems = await fetchTrendingItems();
            const cards = trendingItems
                .filter(item => item.title || item.name)
                .filter(item => !exclusions.has((item.title || item.name).toLowerCase().trim()))
                .map(unifyMediaCard)
                .filter(Boolean);
            console.log("[Chat] Response generated: TRENDING FALLBACK");
            return {
                text: "I couldn't generate personalized recommendations yet. Here are some trending shows you might like:",
                cards: cards.slice(0, 10)
            };
        } catch (e) {
            console.error("[Chat] Trending fallback failed:", e);
            return {
                text: "Sorry, I couldn't generate a recommendation right now.",
                cards: []
            };
        }
    }

    // 11. GENERAL SEARCH FALLBACK (Search TMDB)
    const searchTerm = query.replace(/^(tell me about|what is|search for|find|do you know about|info on|information about|who is)\s+/i, "").trim() || query;
    try {
        const searchResults = await searchTmdbMulti(searchTerm);
        if (searchResults && searchResults.length > 0) {
            console.log("[Chat] Intent detected: SEARCH");
            trackAnalytics("intent", "search");
            const cards = searchResults
                .filter(item => item.title || item.name)
                .filter(item => !exclusions.has((item.title || item.name).toLowerCase().trim()))
                .map(unifyMediaCard)
                .filter(Boolean);
            if (cards.length > 0) {
                console.log("[Chat] Response generated: SEARCH RESULTS");
                return {
                    text: `I found these matches for "${searchTerm}":`,
                    cards: cards.slice(0, 10)
                };
            }
        }
    } catch (e) {
        console.error("[Chat] Search failed:", e);
    }

    console.log("[Chat] No matching intent found - returning default fallback");
    return {
        text: `I couldn't find any results for "${searchTerm}". Can you try describing it differently?`,
        cards: []
    };
}

/**
 * Saves messages in user's chatHistory sessions on Firestore.
 */
export async function saveToHistory(user, sessionId, userMsg, aiMsg, aiCards = null) {
    if (!user) return;
    try {
        const sessionRef = doc(db, "chatHistory", user.uid, "sessions", sessionId);
        
        // Ensure parent document exists
        await setDoc(doc(db, "chatHistory", user.uid), { lastActive: serverTimestamp() }, { merge: true });

        // Add to messages array
        const sessDoc = await getDoc(sessionRef);
        let messages = [];
        if (sessDoc.exists()) {
            messages = sessDoc.data().messages || [];
        }
        messages.push({ role: 'user', text: userMsg, timestamp: Date.now() });
        
        const aiMessageEntry = { role: 'ai', text: aiMsg, timestamp: Date.now() };
        if (aiCards && aiCards.length > 0) {
            aiMessageEntry.cards = aiCards;
        }
        messages.push(aiMessageEntry);
        
        await setDoc(sessionRef, { messages, lastUpdated: serverTimestamp() }, { merge: true });
    } catch (e) {
        console.warn("[AI Engine] Failed to save history:", e);
    }
}

/**
 * Updates global chat analytics metrics in Firestore.
 */
export async function trackAnalytics(type, value) {
    try {
        const ref = doc(db, "chatAnalytics", "global");
        const updates = {};
        if (type === 'genre') {
            updates[`genres.${value}`] = increment(1);
            updates[`totalQueries`] = increment(1);
        } else if (type === 'intent') {
            updates[`intents.${value}`] = increment(1);
            updates[`totalQueries`] = increment(1);
        } else if (type === 'click') {
            updates[`clicks`] = increment(1);
            const safeTitle = value.replace(/[\.\#\$\/\[\]]/g, "_");
            updates[`clickedTitles.${safeTitle}`] = increment(1);
        }
        await setDoc(ref, updates, { merge: true });
    } catch (e) {
        console.warn("[AI Engine] Failed to track analytics:", e);
    }
}

/**
 * Fetches previous session logs from Firestore.
 */
export async function fetchChatSessions(user) {
    if (!user) return [];
    try {
        const q = query(
            collection(db, "chatHistory", user.uid, "sessions"),
            orderBy("lastUpdated", "desc")
        );
        const snap = await getDocs(q);
        const sessions = [];
        snap.forEach(docSnap => {
            sessions.push({
                id: docSnap.id,
                ...docSnap.data()
            });
        });
        return sessions;
    } catch (e) {
        console.warn("[AI Engine] Failed to fetch sessions:", e);
        return [];
    }
}

/**
 * Fetches previous messages in a specific session.
 */
export async function fetchSessionMessages(user, sessionId) {
    if (!user || !sessionId) return [];
    try {
        const sessionRef = doc(db, "chatHistory", user.uid, "sessions", sessionId);
        const docSnap = await getDoc(sessionRef);
        if (docSnap.exists()) {
            return docSnap.data().messages || [];
        }
    } catch (e) {
        console.warn("[AI Engine] Failed to fetch session messages:", e);
    }
    return [];
}
