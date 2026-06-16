# AnimeVerse 🌌

**The Ultimate Anime Streaming & Tracking Platform.**

AnimeVerse is a modern, responsive, and dynamic platform to discover, track, and watch your favorite Anime, Movies, and TV Series. It uses a custom AI recommendation engine and comprehensive analytics to give users a personalized viewing experience.

## ✨ Features

- **Personalized Recommendations:** Advanced scoring algorithm based on your watch history and favorite genres.
- **Unified Catalog:** Integrates both TMDB and Jikan APIs for comprehensive Anime, TV Series, and Movie data.
- **Smart Tracking:** Keep track of what you're watching, your favorites, and your "My List".
- **Admin Dashboard:** Monitor platform growth, most active users, and trending genres with Chart.js visualization.
- **User Insights:** Activity timelines, viewing streaks, and recommendation accuracy stats on user profiles.
- **PWA Ready:** Install AnimeVerse on your home screen for a native app-like experience.
- **Secure Authentication:** Powered by Firebase Auth.

## 🛠 Tech Stack

- **Frontend:** Vanilla HTML5, CSS3, JavaScript (ES6+ Modules)
- **Backend/Database:** Firebase Firestore, Firebase Authentication
- **APIs:** TMDB API, Jikan (MyAnimeList) API
- **Visualization:** Chart.js
- **PWA:** Service Workers, Web Manifest

## 🚀 Installation & Setup

1. **Clone the repository:**
   ```bash
   git clone https://github.com/yourusername/animeverse.git
   cd animeverse
   ```

2. **Run Locally:**
   Since it uses ES modules, you must serve it over HTTP. You can use any static server.
   ```bash
   npx serve .
   ```
   *or*
   ```bash
   npm install -g http-server
   http-server .
   ```

3. **Firebase Setup:**
   Ensure you have a Firebase project created and replace the `firebaseConfig` block in `guard.js` and `db.js` with your own credentials if you intend to use a separate database.

## 📦 Deployment Options

### Deploying to Firebase Hosting (Recommended)

1. Install Firebase CLI:
   ```bash
   npm install -g firebase-tools
   ```
2. Login to your account:
   ```bash
   firebase login
   ```
3. Deploy the project:
   ```bash
   firebase deploy --only hosting
   ```

### Deploying to Vercel

1. Install Vercel CLI:
   ```bash
   npm i -g vercel
   ```
2. Run deployment:
   ```bash
   vercel
   ```
3. *Note: Ensure your output directory is set to `.` (the root folder).*

### Deploying to Netlify

1. Drag and drop the project folder into Netlify's manual deploy dashboard.
2. *Alternatively*, connect your GitHub repository to Netlify and it will automatically deploy the `main` branch.

## 📜 License

This project is licensed under the MIT License - see the LICENSE file for details.
