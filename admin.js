import { requireAdmin } from './guard.js';
import { db } from './db.js';
import { collection, getDocs, doc, setDoc, deleteDoc, getDoc } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

// Tab navigation handler
document.querySelectorAll(".admin-tab").forEach(tab => {
    tab.addEventListener("click", () => {
        document.querySelectorAll(".admin-tab").forEach(t => t.classList.remove("active"));
        document.querySelectorAll(".admin-section").forEach(s => s.classList.remove("active"));
        
        tab.classList.add("active");
        const targetSection = document.getElementById(tab.getAttribute("data-tab") + "Section");
        if (targetSection) targetSection.classList.add("active");
    });
});

const TMDB_API = "https://api.themoviedb.org/3";
const API_KEY  = "c2772546356cffa3fb0504e91da76541";
const IMG      = "https://image.tmdb.org/t/p/w500";

let charts = {};

requireAdmin().then(async (user) => {
    console.log("Admin console loaded successfully.");
    const container = document.getElementById("adminDashboardContainer");
    if (container) container.style.display = "block";
    loadOverviewData();
    loadContentManagement();
    loadRecommendationInsights();
});

// PART B & PART D: Platform Overview & User Analytics
async function loadOverviewData() {
    try {
        const usersSnap = await getDocs(collection(db, "users"));
        
        let totalUsers = 0;
        let totalFavorites = 0;
        let totalMyList = 0;
        let totalHistory = 0;

        // Analytics counters
        let activeToday = 0;
        let activeWeek = 0;
        let activeMonth = 0;

        let watchedAnime = 0;
        let watchedMovie = 0;
        let watchedTV = 0;

        const favAnimeCounts = {};
        const favMovieCounts = {};
        const favTvCounts = {};
        const watchedCounts = {};
        const genreCounts = {};
        const userActivity = [];
        const growthData = {}; // key: YYYY-MM, value: signup count

        usersSnap.forEach((userDoc) => {
            totalUsers++;
            const data = userDoc.data();
            const uFavs = data.favorites || [];
            const uWatched = data.watched || [];
            const uMyList = data.myList || [];
            const uHistory = data.watchHistory || [];

            totalFavorites += uFavs.length;
            totalWatched += uWatched.length;
            totalMyList += uMyList.length;
            totalHistory += uHistory.length;

            // User Growth tracking by month
            const created = data.createdAt ? data.createdAt.slice(0, 7) : '2026-06';
            growthData[created] = (growthData[created] || 0) + 1;

            // Favorites stats
            uFavs.forEach(item => {
                if (!item || !item.title) return;
                const title = item.title;
                const type = (item.type || item.mediaType || 'TV').toLowerCase();
                
                // Tally genres from favorites
                let genres = item.genres || [];
                if (typeof genres === 'string') genres = genres.split(',').map(g => g.trim());
                genres.forEach(g => {
                    if (typeof g === 'object') g = g.name;
                    if (g) genreCounts[g] = (genreCounts[g] || 0) + 1;
                });

                if (type === 'anime') {
                    if (!favAnimeCounts[title]) favAnimeCounts[title] = { title, count: 0 };
                    favAnimeCounts[title].count++;
                } else if (type === 'movie') {
                    if (!favMovieCounts[title]) favMovieCounts[title] = { title, count: 0 };
                    favMovieCounts[title].count++;
                } else {
                    if (!favTvCounts[title]) favTvCounts[title] = { title, count: 0 };
                    favTvCounts[title].count++;
                }
            });

            // Watched content stats
            uWatched.forEach(item => {
                if (!item || !item.title) return;
                const title = item.title;
                if (!watchedCounts[title]) watchedCounts[title] = { title, count: 0 };
                watchedCounts[title].count++;

                const type = (item.type || item.mediaType || 'TV').toLowerCase();
                if (type === 'anime') watchedAnime++;
                else if (type === 'movie') watchedMovie++;
                else watchedTV++;

                // Tally genres from watches
                let genres = item.genres || [];
                if (typeof genres === 'string') genres = genres.split(',').map(g => g.trim());
                genres.forEach(g => {
                    if (typeof g === 'object') g = g.name;
                    if (g) genreCounts[g] = (genreCounts[g] || 0) + 1;
                });
            });

            // Calculate user interaction score
            const interactionScore = uFavs.length + uWatched.length + uMyList.length + uHistory.length;
            userActivity.push({
                email: data.email || 'Anonymous',
                displayName: data.displayName || 'Anime Fan',
                photoURL: data.photoURL || 'https://i.pinimg.com/736x/8b/16/7a/8b167af653c2399dd93b952a48740620.jpg',
                role: data.role || 'user',
                favorites: uFavs.length,
                watched: uWatched.length,
                myList: uMyList.length,
                history: uHistory.length,
                score: interactionScore
            });
        });

        // Set overview indicators
        document.getElementById("statTotalUsers").innerText = totalUsers;
        document.getElementById("statTotalFavorites").innerText = totalFavorites;
        document.getElementById("statTotalWatched").innerText = totalWatched;
        document.getElementById("statTotalMyList").innerText = totalMyList;
        document.getElementById("statTotalHistory").innerText = totalHistory;

        // Fetch Analytics (Daily Visits & Active Users)
        const analyticsSnap = await getDocs(collection(db, "analytics"));
        const todayStr = new Date().toISOString().split('T')[0];
        const now = new Date();
        
        const visitsLabels = [];
        const visitsData = [];
        const activityLogData = [];

        analyticsSnap.forEach(docSnap => {
            if (docSnap.id === "recommendations") return; // skip recs doc
            const d = docSnap.data();
            const dateStr = docSnap.id;
            const dateObj = new Date(dateStr);
            const activeUserCount = d.activeUsers ? Object.keys(d.activeUsers).length : 0;
            
            if (dateStr === todayStr) activeToday += activeUserCount;
            
            const diffDays = Math.ceil(Math.abs(now - dateObj) / (1000 * 60 * 60 * 24));
            if (diffDays <= 7) activeWeek += activeUserCount;
            if (dateObj.getMonth() === now.getMonth() && dateObj.getFullYear() === now.getFullYear()) activeMonth += activeUserCount;

            visitsLabels.push(dateStr);
            visitsData.push(d.visits || 0);
            activityLogData.push(activeUserCount);
        });

        const statActiveToday = document.getElementById("statActiveToday");
        if (statActiveToday) statActiveToday.innerText = activeToday;
        const statActiveWeek = document.getElementById("statActiveWeek");
        if (statActiveWeek) statActiveWeek.innerText = activeWeek;
        const statActiveMonth = document.getElementById("statActiveMonth");
        if (statActiveMonth) statActiveMonth.innerText = activeMonth;

        // Fetch Search Analytics
        const searchSnap = await getDocs(collection(db, "searchAnalytics"));
        const searchTally = {};
        const failedTally = {};
        searchSnap.forEach(docSnap => {
            const d = docSnap.data();
            if (d.successful) {
                for (const [k, v] of Object.entries(d.successful)) {
                    searchTally[k] = (searchTally[k] || 0) + v;
                }
            }
            if (d.failed) {
                for (const [k, v] of Object.entries(d.failed)) {
                    failedTally[k] = (failedTally[k] || 0) + v;
                }
            }
        });

        const renderSearchList = (tally, elementId) => {
            const el = document.getElementById(elementId);
            if (!el) return;
            const sorted = Object.entries(tally).sort((a, b) => b[1] - a[1]).slice(0, 10);
            if (sorted.length === 0) {
                el.innerHTML = "<li>No data yet</li>";
            } else {
                el.innerHTML = sorted.map(s => `<li>${s[0]} <span style="float:right">${s[1]}</span></li>`).join('');
            }
        };
        renderSearchList(searchTally, "mostSearchedList");
        renderSearchList(failedTally, "failedSearchesList");

        // Display Top favorited items
        const topAnimeList = Object.values(favAnimeCounts).sort((a,b) => b.count - a.count);
        if (topAnimeList.length > 0) {
            document.getElementById("topFavAnime").innerText = topAnimeList[0].title;
            document.getElementById("topFavAnimeCount").innerText = topAnimeList[0].count;
        }
        
        const topMovieList = Object.values(favMovieCounts).sort((a,b) => b.count - a.count);
        if (topMovieList.length > 0) {
            document.getElementById("topFavMovie").innerText = topMovieList[0].title;
            document.getElementById("topFavMovieCount").innerText = topMovieList[0].count;
        }

        const topTVList = Object.values(favTvCounts).sort((a,b) => b.count - a.count);
        if (topTVList.length > 0) {
            document.getElementById("topFavTV").innerText = topTVList[0].title;
            document.getElementById("topFavTVCount").innerText = topTVList[0].count;
        }

        const topWatchedList = Object.values(watchedCounts).sort((a,b) => b.count - a.count);
        if (topWatchedList.length > 0) {
            document.getElementById("topWatchedContent").innerText = topWatchedList[0].title;
            document.getElementById("topWatchedCount").innerText = topWatchedList[0].count;
        }

        // Tally trending genres
        const sortedGenres = Object.entries(genreCounts).sort((a,b) => b[1] - a[1]);
        const genreTable = document.getElementById("trendingGenresTableBody");
        genreTable.innerHTML = "";
        if (sortedGenres.length === 0) {
            genreTable.innerHTML = `<tr><td colspan="3" style="text-align: center; color: var(--text-muted);">No genre interactions yet.</td></tr>`;
        } else {
            sortedGenres.slice(0, 10).forEach(([genre, count], idx) => {
                const tr = document.createElement("tr");
                tr.innerHTML = `
                    <td>#${idx + 1}</td>
                    <td><strong>${genre}</strong></td>
                    <td>${count} references</td>
                `;
                genreTable.appendChild(tr);
            });
        }

        // Render User Analytics table (Top active users)
        const userTable = document.getElementById("topUsersTableBody");
        userTable.innerHTML = "";
        const sortedUsers = userActivity.sort((a,b) => b.score - a.score).slice(0, 10);
        sortedUsers.forEach(u => {
            const tr = document.createElement("tr");
            tr.innerHTML = `
                <td>
                    <div class="user-cell">
                        <img src="${u.photoURL}" alt="User Avatar" class="user-avatar" />
                        <div>
                            <div style="font-weight:600;color:#fff;">${u.displayName}</div>
                            <div style="font-size:12px;color:var(--text-muted);">${u.email}</div>
                        </div>
                    </div>
                </td>
                <td><span class="admin-badge ${u.role}">${u.role}</span></td>
                <td>${u.favorites}</td>
                <td>${u.watched}</td>
                <td>${u.myList}</td>
                <td>${u.history}</td>
                <td><strong style="color: var(--accent);">${u.score}</strong></td>
            `;
            userTable.appendChild(tr);
        });

        // Chart: User Activity Log (Daily Active Users)
        const ctxActivityLog = document.getElementById('userActivityLogChart');
        if (ctxActivityLog) {
            if (charts['userActivityLog']) charts['userActivityLog'].destroy();
            charts['userActivityLog'] = new Chart(ctxActivityLog.getContext('2d'), {
                type: 'line',
                data: {
                    labels: visitsLabels.slice(-7), // Last 7 days
                    datasets: [{
                        label: 'Active Users',
                        data: activityLogData.slice(-7),
                        borderColor: '#00adb5',
                        tension: 0.3,
                        fill: false
                    }]
                },
                options: { responsive: true, maintainAspectRatio: false }
            });
        }

        // Chart: Daily Visits
        const ctxVisits = document.getElementById('dailyVisitsChart');
        if (ctxVisits) {
            if (charts['dailyVisits']) charts['dailyVisits'].destroy();
            charts['dailyVisits'] = new Chart(ctxVisits.getContext('2d'), {
                type: 'bar',
                data: {
                    labels: visitsLabels.slice(-7),
                    datasets: [{
                        label: 'Visits',
                        data: visitsData.slice(-7),
                        backgroundColor: '#ffc107',
                        borderRadius: 4
                    }]
                },
                options: { responsive: true, maintainAspectRatio: false }
            });
        }

        // Chart: Favorites Growth (Cumulative)
        const ctxFavs = document.getElementById('favoritesGrowthChart');
        if (ctxFavs) {
            if (charts['favoritesGrowth']) charts['favoritesGrowth'].destroy();
            charts['favoritesGrowth'] = new Chart(ctxFavs.getContext('2d'), {
                type: 'line',
                data: {
                    labels: Object.keys(growthData).sort(), // reusing growth data keys
                    datasets: [{
                        label: 'Favorites Added',
                        data: Object.keys(growthData).sort().map(() => Math.floor(Math.random() * totalFavorites)), // Mock data
                        borderColor: '#e50914',
                        tension: 0.3,
                        fill: true,
                        backgroundColor: 'rgba(229, 9, 20, 0.2)'
                    }]
                },
                options: { responsive: true, maintainAspectRatio: false }
            });
        }

        // Initialize platform charts
        initializeCharts(growthData, sortedGenres, totalFavorites, totalWatched, totalHistory, totalMyList, watchedAnime, watchedMovie, watchedTV);

    } catch (e) {
        console.error("Overview data fetch error:", e);
    }
}

// PART E: Charts Generator
function initializeCharts(growthData, genreData, totalFavorites, totalWatched, totalHistory, totalMyList, watchedAnime, watchedMovie, watchedTV) {
    // 1. User Growth Chart
    const growthCtx = document.getElementById('userGrowthChart').getContext('2d');
    const sortedDates = Object.keys(growthData).sort();
    let cumulative = 0;
    const values = sortedDates.map(date => {
        cumulative += growthData[date];
        return cumulative;
    });

    if (charts.growth) charts.growth.destroy();
    charts.growth = new Chart(growthCtx, {
        type: 'line',
        data: {
            labels: sortedDates,
            datasets: [{
                label: 'Total Accounts',
                data: values,
                borderColor: '#e50914',
                backgroundColor: 'rgba(229, 9, 20, 0.1)',
                fill: true,
                tension: 0.35,
                borderWidth: 3
            }]
        },
        options: chartOptions()
    });

    // 2. Favorites by Genre Chart
    const genreCtx = document.getElementById('genreFavoritesChart').getContext('2d');
    const topGNames = genreData.slice(0, 6).map(g => g[0]);
    const topGCounts = genreData.slice(0, 6).map(g => g[1]);

    if (charts.genre) charts.genre.destroy();
    charts.genre = new Chart(genreCtx, {
        type: 'bar',
        data: {
            labels: topGNames.length > 0 ? topGNames : ['Action', 'Comedy', 'Drama', 'Fantasy', 'Romance', 'Sci-Fi'],
            datasets: [{
                label: 'Tally Count',
                data: topGCounts.length > 0 ? topGCounts : [0, 0, 0, 0, 0, 0],
                backgroundColor: ['#e50914', '#ffc107', '#17a2b8', '#28a745', '#6f42c1', '#fd7e14']
            }]
        },
        options: chartOptions()
    });

    // 3. Watched Content Types Chart
    const distributionCtx = document.getElementById('contentDistributionChart').getContext('2d');
    if (charts.dist) charts.dist.destroy();
    charts.dist = new Chart(distributionCtx, {
        type: 'doughnut',
        data: {
            labels: ['Anime', 'Movies', 'TV Series'],
            datasets: [{
                data: [watchedAnime, watchedMovie, watchedTV],
                backgroundColor: ['#e50914', '#17a2b8', '#ffc107'],
                borderColor: '#181818',
                borderWidth: 2
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: { position: 'right', labels: { color: '#ccc', font: { size: 12, weight: '600' } } }
            }
        }
    });

    // 4. Platform Activity Chart
    const activityCtx = document.getElementById('platformActivityChart').getContext('2d');
    if (charts.activity) charts.activity.destroy();
    charts.activity = new Chart(activityCtx, {
        type: 'radar',
        data: {
            labels: ['Favorites', 'Watched', 'History Logs', 'My List'],
            datasets: [{
                label: 'Platform Totals',
                data: [totalFavorites, totalWatched, totalHistory, totalMyList],
                backgroundColor: 'rgba(229, 9, 20, 0.15)',
                borderColor: '#e50914',
                pointBackgroundColor: '#fff',
                borderWidth: 2
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: { labels: { color: 'white' } }
            },
            scales: {
                r: {
                    grid: { color: 'rgba(255, 255, 255, 0.08)' },
                    angleLines: { color: 'rgba(255, 255, 255, 0.08)' },
                    pointLabels: { color: 'rgba(255,255,255,0.7)', font: { size: 11, weight: '600' } },
                    ticks: { color: '#bbb', backdropColor: 'transparent' }
                }
            }
        }
    });
}

function chartOptions() {
    return {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
            legend: { labels: { color: '#ccc', font: { size: 12, weight: '600' } } }
        },
        scales: {
            x: { grid: { color: 'rgba(255, 255, 255, 0.04)' }, ticks: { color: 'rgba(255,255,255,0.6)', font: { size: 10 } } },
            y: { grid: { color: 'rgba(255, 255, 255, 0.04)' }, ticks: { color: 'rgba(255,255,255,0.6)', font: { size: 10 } } }
        }
    };
}

// PART F: Content Management (Featuring / Hiding)
function loadContentManagement() {
    loadFeaturedList();
    loadHiddenList();

    const searchInput = document.getElementById("contentSearchInput");
    const searchBtn = document.getElementById("contentSearchBtn");

    if (searchBtn && searchInput) {
        const triggerSearch = () => {
            const query = searchInput.value.trim();
            if (query.length > 1) {
                searchContent(query);
            }
        };
        searchBtn.addEventListener("click", triggerSearch);
        searchInput.addEventListener("keyup", e => { if (e.key === "Enter") triggerSearch(); });
    }
}

async function loadFeaturedList() {
    try {
        const querySnapshot = await getDocs(collection(db, "featuredContent"));
        const listContainer = document.getElementById("featuredList");
        listContainer.innerHTML = "";

        if (querySnapshot.empty) {
            listContainer.innerHTML = `<p style="color: var(--text-muted); text-align: center; padding: 10px 0;">No featured titles found.</p>`;
            return;
        }

        const table = document.createElement("table");
        table.className = "admin-table";
        table.innerHTML = `
            <thead>
                <tr>
                    <th>Title</th>
                    <th>Category</th>
                    <th>Action</th>
                </tr>
            </thead>
            <tbody></tbody>
        `;
        const tbody = table.querySelector("tbody");

        querySnapshot.forEach(docSnap => {
            const data = docSnap.data();
            const tr = document.createElement("tr");
            tr.innerHTML = `
                <td><strong>${data.title}</strong></td>
                <td><span class="admin-badge user" style="background:rgba(255,255,255,0.05); color:#ccc;">${data.media_type || 'Media'}</span></td>
                <td><button class="admin-btn danger" style="padding: 4px 10px; font-size:11px;">Remove</button></td>
            `;
            
            tr.querySelector(".admin-btn.danger").addEventListener("click", async () => {
                await deleteDoc(doc(db, "featuredContent", docSnap.id));
                alert(`"${data.title}" removed from Featured section.`);
                loadFeaturedList();
            });
            tbody.appendChild(tr);
        });

        listContainer.appendChild(table);
    } catch (e) {
        console.warn("Featured content load error:", e);
    }
}

async function loadHiddenList() {
    try {
        const querySnapshot = await getDocs(collection(db, "hiddenContent"));
        const listContainer = document.getElementById("hiddenList");
        listContainer.innerHTML = "";

        if (querySnapshot.empty) {
            listContainer.innerHTML = `<p style="color: var(--text-muted); text-align: center; padding: 10px 0;">No blocked content.</p>`;
            return;
        }

        const table = document.createElement("table");
        table.className = "admin-table";
        table.innerHTML = `
            <thead>
                <tr>
                    <th>Blocked Content Title</th>
                    <th>Action</th>
                </tr>
            </thead>
            <tbody></tbody>
        `;
        const tbody = table.querySelector("tbody");

        querySnapshot.forEach(docSnap => {
            const data = docSnap.data();
            const tr = document.createElement("tr");
            tr.innerHTML = `
                <td><strong>${data.title}</strong></td>
                <td><button class="admin-btn success" style="padding: 4px 10px; font-size:11px;">Unhide</button></td>
            `;
            
            tr.querySelector(".admin-btn.success").addEventListener("click", async () => {
                await deleteDoc(doc(db, "hiddenContent", docSnap.id));
                alert(`"${data.title}" has been unblocked.`);
                loadHiddenList();
            });
            tbody.appendChild(tr);
        });

        listContainer.appendChild(table);
    } catch (e) {
        console.warn("Hidden content load error:", e);
    }
}

async function searchContent(query) {
    const resultsContainer = document.getElementById("contentSearchResults");
    resultsContainer.innerHTML = `<p style="color: var(--text-muted); text-align: center;">Searching APIs...</p>`;

    try {
        const [tmdbRes, jikanRes] = await Promise.all([
            fetch(`${TMDB_API}/search/multi?api_key=${API_KEY}&query=${encodeURIComponent(query)}`).then(r => r.json()).catch(() => null),
            fetch(`https://api.jikan.moe/v4/anime?q=${encodeURIComponent(query)}`).then(r => r.json()).catch(() => null)
        ]);

        const items = [];

        if (tmdbRes && tmdbRes.results) {
            tmdbRes.results.slice(0, 5).forEach(r => {
                if (!r.poster_path) return;
                items.push({
                    id: r.id,
                    mal_id: null,
                    title: r.title || r.name,
                    image: IMG + r.poster_path,
                    rating: r.vote_average || 0,
                    description: r.overview || '',
                    mediaType: r.media_type === 'tv' ? 'TV' : 'Movie',
                    year: (r.release_date || r.first_air_date || '').slice(0, 4)
                });
            });
        }

        if (jikanRes && jikanRes.data) {
            jikanRes.data.slice(0, 5).forEach(item => {
                items.push({
                    id: null,
                    mal_id: item.mal_id,
                    title: item.title,
                    image: item.images && item.images.jpg ? item.images.jpg.large_image_url : '',
                    rating: item.score || 0,
                    description: item.synopsis || '',
                    mediaType: 'Anime',
                    year: item.aired && item.aired.from ? item.aired.from.slice(0, 4) : ''
                });
            });
        }

        resultsContainer.innerHTML = "";
        if (items.length === 0) {
            resultsContainer.innerHTML = `<p style="color: var(--text-muted); text-align: center;">No matches found.</p>`;
            return;
        }

        items.forEach(item => {
            const card = document.createElement("div");
            card.className = "mg-card";
            card.innerHTML = `
                <img src="${item.image}" alt="poster" />
                <div class="mg-details">
                    <h5>${item.title}</h5>
                    <p style="color: var(--text-muted); font-size:12px;">${item.mediaType} &bull; ${item.year || 'N/A'}</p>
                </div>
                <div class="mg-actions">
                    <button class="admin-btn primary" style="padding: 6px 12px; font-size:12px;">Feature</button>
                    <button class="admin-btn danger" style="padding: 6px 12px; font-size:12px;">Hide</button>
                </div>
            `;

            card.querySelector(".mg-actions .admin-btn.primary").addEventListener("click", async () => {
                const docId = item.mal_id ? `anime_${item.mal_id}` : `tmdb_${item.id}`;
                await setDoc(doc(db, "featuredContent", docId), {
                    id: item.id,
                    mal_id: item.mal_id,
                    title: item.title,
                    poster_path: item.image,
                    vote_average: item.rating,
                    overview: item.description,
                    media_type: item.mediaType,
                    featuredAt: new Date().toISOString()
                });
                alert(`"${item.title}" added to home screen features.`);
                loadFeaturedList();
            });

            card.querySelector(".mg-actions .admin-btn.danger").addEventListener("click", async () => {
                const docId = item.mal_id ? `anime_${item.mal_id}` : `tmdb_${item.id}`;
                await setDoc(doc(db, "hiddenContent", docId), {
                    id: item.id,
                    mal_id: item.mal_id,
                    title: item.title,
                    mediaType: item.mediaType,
                    hiddenAt: new Date().toISOString()
                });
                alert(`"${item.title}" is now blocked/hidden.`);
                loadHiddenList();
            });

            resultsContainer.appendChild(card);
        });
    } catch (e) {
        console.error("Content search error:", e);
        resultsContainer.innerHTML = `<p style="color: var(--text-muted); text-align: center;">Error running search.</p>`;
    }
}

// PART G: Recommendation Insights (impressions, clicks, click rate)
async function loadRecommendationInsights() {
    try {
        const docRef = doc(db, "analytics", "recommendations");
        const docSnap = await getDoc(docRef);
        
        let clicks = 0;
        let impressions = 0;
        let clickedCount = {};
        let recommendedCount = {};

        if (docSnap.exists()) {
            const data = docSnap.data();
            clicks = data.clicks || 0;
            impressions = data.impressions || 0;
            clickedCount = data.clickedCount || {};
            recommendedCount = data.recommendedCount || {};
        }

        const clickRate = impressions > 0 ? ((clicks / impressions) * 100).toFixed(1) : "0.0";
        document.getElementById("recClickRate").innerText = `${clickRate}%`;
        document.getElementById("recImpressions").innerText = impressions;
        document.getElementById("recClicks").innerText = clicks;

        const tableBody = document.getElementById("mostRecommendedTableBody");
        tableBody.innerHTML = "";
        
        const sortedRecs = Object.entries(recommendedCount).sort((a,b) => b[1] - a[1]);
        if (sortedRecs.length === 0) {
            tableBody.innerHTML = `<tr><td colspan="4" style="text-align: center; color: var(--text-muted);">No recommendation views logged.</td></tr>`;
        } else {
            sortedRecs.slice(0, 10).forEach(([rawTitle, rCount], idx) => {
                const title = rawTitle.replace(/_/g, " ");
                const cCount = clickedCount[rawTitle] || 0;
                const tr = document.createElement("tr");
                tr.innerHTML = `
                    <td>#${idx + 1}</td>
                    <td><strong>${title}</strong></td>
                    <td>${rCount} lists</td>
                    <td>${cCount} clicks</td>
                `;
                tableBody.appendChild(tr);
            });
        }
    } catch (e) {
        console.error("Recommendations analytics load error:", e);
    }
}

// ── PART E: ML Dataset Prep ──────────────────────────────────────────────────
let aggregatedMLDataset = null;
const btnGenerate = document.getElementById('btnGenerateDataset');
if (btnGenerate) {
    btnGenerate.addEventListener('click', async () => {
        const statusBox = document.getElementById('mlDatasetStatus');
        statusBox.innerText = "Processing users... This may take a moment.";
        try {
            const ml = await import('./ml.js');
            const res = await ml.generatePlatformDataset();
            if (res.success) {
                aggregatedMLDataset = res.aggregatedDataset;
                statusBox.innerHTML = `✅ Dataset Generated Successfully.<br><br>Users Processed: ${res.totalUsers}<br>Records Extracted: ${res.totalRecords}`;
                document.getElementById('mlTotalRecords').innerText = res.totalRecords;
                document.getElementById('mlTotalUsers').innerText = res.totalUsers;
                
                document.getElementById('btnExportJSON').style.display = 'inline-block';
                document.getElementById('btnExportCSV').style.display = 'inline-block';

                // Calculate ML specific Most Popular Genre and Type
                const gTally = {};
                const tTally = {};
                res.aggregatedDataset.forEach(i => {
                    i.genres.forEach(g => {
                        gTally[g] = (gTally[g] || 0) + 1;
                    });
                    tTally[i.mediaType] = (tTally[i.mediaType] || 0) + 1;
                });
                const popGenre = Object.entries(gTally).sort((a,b)=>b[1]-a[1])[0];
                const popType = Object.entries(tTally).sort((a,b)=>b[1]-a[1])[0];
                
                document.getElementById('mlPopularGenre').innerText = popGenre ? popGenre[0] : 'N/A';
                document.getElementById('mlPopularType').innerText = popType ? popType[0] : 'N/A';

            } else {
                statusBox.innerHTML = `❌ Error: ${res.error}`;
            }
        } catch(e) {
            statusBox.innerHTML = `❌ Fatal Error: ${e.message}`;
        }
    });
}

const btnExportJSON = document.getElementById('btnExportJSON');
if (btnExportJSON) {
    btnExportJSON.addEventListener('click', async () => {
        if (!aggregatedMLDataset) return;
        const ml = await import('./ml.js');
        ml.exportDatasetAsJSON(aggregatedMLDataset);
    });
}

const btnExportCSV = document.getElementById('btnExportCSV');
if (btnExportCSV) {
    btnExportCSV.addEventListener('click', async () => {
        if (!aggregatedMLDataset) return;
        const ml = await import('./ml.js');
        ml.exportDatasetAsCSV(aggregatedMLDataset);
    });
}
