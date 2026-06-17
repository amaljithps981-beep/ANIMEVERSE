# AnimeVerse

Your personal anime streaming and tracking platform.

## What is AnimeVerse?

AnimeVerse is a web app for anime and TV lovers. Track what you're watching, save favorites, get recommendations, and discover new titles all in one place.

## Features

- **Watch Anime, Movies & TV**: Stream content from integrated sources
- **Track Your Progress**: Keep notes on what you're watching and where you left off
- **Save Favorites**: Build your personal collection of favorites
- **My List**: Create custom watchlists
- **Watch History**: See everything you've watched
- **Smart Recommendations**: Get personalized suggestions based on your viewing habits
- **User Profile**: View your stats and activity
- **Admin Dashboard**: Analytics and platform insights (for admins)
- **Works Offline**: Install as an app on your device
- **Secure Auth**: Firebase-powered login

## Getting Started

### Prerequisites
You need:
- A Firebase project (sign up at [firebase.google.com](https://firebase.google.com))
- Node.js (for running a local server)

### Local Setup

1. Clone the repo:
   ```bash
   git clone https://github.com/yourusername/animeverse.git
   cd animeverse
   ```

2. Start a local server:
   ```bash
   npm install -g http-server
   http-server .
   ```
   Or:
   ```bash
   npx serve .
   ```

3. Open `http://localhost:8080` in your browser

### Firebase Setup

Update your Firebase config in `config.js`:
```javascript
export const FIREBASE_CONFIG = {
  apiKey: "YOUR_KEY",
  authDomain: "your-project.firebaseapp.com",
  projectId: "your-project-id",
  // ... other keys
};
```

## Deployment

### Firebase Hosting (Recommended)
```bash
npm install -g firebase-tools
firebase login
firebase deploy --only hosting
```

### Vercel
```bash
npm i -g vercel
vercel
```

### Netlify
Drag and drop the project folder into Netlify's dashboard.

## Tech Stack

- **Frontend**: HTML5, CSS3, JavaScript ES6+
- **Database**: Firebase Firestore
- **Auth**: Firebase Authentication
- **APIs**: TMDB API, Jikan (MyAnimeList) API
- **Charts**: Chart.js

## Project Structure

```
├── index.html              # Home page
├── login.html              # Login/Signup
├── watch.html              # Video player
├── profile.html            # User profile
├── favorites.html          # Favorites list
├── mylist.html             # My List
├── history.html            # Watch history
├── watched.html            # Watched titles
├── config.js               # App configuration
├── db.js                   # Database utilities
├── auth.js                 # Authentication
├── api.js                  # API helpers
├── ai.js                   # Recommendation engine
├── script.js               # Main app logic
├── style.css               # Styling
└── ml/                     # Machine learning models
```

## Contributing

Feel free to fork, modify, and improve!

## License

MIT License - see LICENSE file for details.
