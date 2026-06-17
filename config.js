// Centralized Configuration
// All API keys, Firebase config, and constants in one place

/* Firebase Configuration */
export const FIREBASE_CONFIG = {
  apiKey: "AIzaSyCZWdwzHo5IRGWQHs6IzsFtXdoLm10gmII",
  authDomain: "animeverse-4c635.firebaseapp.com",
  projectId: "animeverse-4c635",
  storageBucket: "animeverse-4c635.firebasestorage.app",
  messagingSenderId: "200334860457",
  appId: "1:200334860457:web:d493dd34a5f541d9e8c9b8",
  measurementId: "G-8VMLXQFDWY"
};

/* API Keys & Endpoints */
export const TMDB_API_KEY = "c2772546356cffa3fb0504e91da76541";
export const TMDB_API_BASE = "https://api.themoviedb.org/3";
export const TMDB_IMAGE_BASE = "https://image.tmdb.org/t/p/w500";
export const TMDB_IMAGE_SMALL = "https://image.tmdb.org/t/p/w300";
export const JIKAN_API_BASE = "https://api.jikan.moe/v4";

/* Media Type Defaults */
export const ANIME_DURATION = 1200; // 20 minutes
export const MOVIE_DURATION = 7200; // 2 hours
export const TV_DURATION = 2700; // 45 minutes
export const DEFAULT_EPISODES = 12;

/* Genre Mappings */
export const TMDB_GENRES = {
  28: "Action",
  12: "Adventure",
  16: "Animation",
  35: "Comedy",
  80: "Crime",
  99: "Documentary",
  18: "Drama",
  10751: "Family",
  14: "Fantasy",
  36: "History",
  27: "Horror",
  10402: "Music",
  9648: "Mystery",
  10749: "Romance",
  878: "Sci-Fi",
  10770: "TV Movie",
  53: "Thriller",
  10752: "War",
  37: "Western",
  10759: "Action & Adventure",
  10765: "Sci-Fi & Fantasy",
  10766: "Romance",
  10767: "Talk",
  10768: "War & Politics"
};

export const GENRE_NAME_TO_ID = {
  Action: 28,
  Adventure: 12,
  Animation: 16,
  Comedy: 35,
  Crime: 80,
  Documentary: 99,
  Drama: 18,
  Family: 10751,
  Fantasy: 14,
  History: 36,
  Horror: 27,
  Music: 10402,
  Mystery: 9648,
  Romance: 10749,
  "Sci-Fi": 878,
  "Science Fiction": 878,
  "TV Movie": 10770,
  Thriller: 53,
  War: 10752,
  Western: 37,
  "Action & Adventure": 10759,
  "Sci-Fi & Fantasy": 10765,
  Talk: 10767,
  "War & Politics": 10768
};

export const JIKAN_GENRES = {
  action: 1,
  adventure: 2,
  comedy: 4,
  fantasy: 10,
  horror: 14,
  romance: 22,
  "sci-fi": 24,
  dark: 14,
  "slice of life": 36,
  sports: 30,
  mystery: 7,
  drama: 8
};

/* UI Defaults */
export const DEFAULT_AVATAR = "https://i.pinimg.com/736x/8b/16/7a/8b167af653c2399dd93b952a48740620.jpg";
export const PLACEHOLDER_IMAGE = "https://via.placeholder.com/200x300/1a1a1a/e50914";

/* Database Timeouts */
export const DB_TIMEOUT_MS = 1500;
export const ANALYTICS_FLUSH_INTERVAL = 30000;

/* Cache Expiration */
export const API_CACHE_DURATION = 3600000; // 1 hour

/* Colors */
export const COLORS = {
  accent: "#E50914",
  accentHover: "#ff1c2a",
  secondary: "#00E5FF",
  bgMain: "#0B0B0E",
  bgCard: "#15151A",
  textMain: "#FFFFFF",
  textMuted: "#9BA1A6"
};
