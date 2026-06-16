const animeDetails =
    document.getElementById("animeDetails");
const recommendContainer =
    document.getElementById(
        "recommendContainer"
    );

const characterContainer =
    document.getElementById("characterContainer");

const recommendationContainer =
    document.getElementById("recommendationContainer");

/* GET ID */

const urlParams =
    new URLSearchParams(window.location.search);

const animeId =
    urlParams.get("id");

/* FETCH DETAILS */

async function getAnimeDetails() {

    const response = await fetch(
        `https://api.jikan.moe/v4/anime/${animeId}`
    );

    const data = await response.json();

    showAnimeDetails(data.data);
}

/* SHOW DETAILS */

function showAnimeDetails(anime) {
    // Save to selectedItem so that watch.html / saveContinueWatching can access correct metadata
    const selectedItem = {
        title:       anime.title,
        image:       anime.images.jpg.large_image_url,
        rating:      anime.score,
        description: anime.synopsis,
        type:        anime.type || 'Anime',
        mediaType:   anime.type || 'Anime',
        year:        anime.aired && anime.aired.prop && anime.aired.prop.from && anime.aired.prop.from.year ? anime.aired.prop.from.year : '',
        episodes:    anime.episodes,
        id:          null,
        mal_id:      anime.mal_id
    };
    localStorage.setItem("selectedItem", JSON.stringify(selectedItem));

    const trailerHtml = anime.trailer && anime.trailer.youtube_id ? `
        <div class="player-wrapper" style="margin-bottom: 30px; border-radius: 24px; overflow: hidden; box-shadow: 0 0 40px rgba(229, 9, 20, 0.25);">
            <iframe src="https://www.youtube.com/embed/${anime.trailer.youtube_id}?autoplay=1&mute=1&controls=1&modestbranding=1&loop=1&playlist=${anime.trailer.youtube_id}" width="100%" height="100%" style="min-height: 60vh;" frameborder="0" allow="autoplay; fullscreen" allowfullscreen></iframe>
        </div>
    ` : '';

    animeDetails.innerHTML = `
        ${trailerHtml}
        <div class="details-hero">
            <img src="${anime.images.jpg.large_image_url}" loading="lazy">
            <div class="details-info">
                <h1>${anime.title}</h1>
                <div class="details-meta">
                    <span class="badge score">⭐ ${anime.score || 'N/A'}</span>
                    <span class="badge">Episodes: ${anime.episodes || 'Ongoing'}</span>
                    <span class="badge status">${anime.status}</span>
                    <span class="badge">${anime.studios.map(s => s.name).join(", ")}</span>
                </div>
                <p class="synopsis">${anime.synopsis}</p>
                <div class="details-actions">
                    <a href="watch.html?id=${anime.mal_id}" class="btn-primary">▶ Watch Anime</a>
                </div>
            </div>
        </div>
    `;
}

/* FETCH CHARACTERS */

async function getCharacters() {

    const response = await fetch(
        `https://api.jikan.moe/v4/anime/${animeId}/characters`
    );

    const data = await response.json();

    showCharacters(data.data);
}

/* SHOW CHARACTERS */

function showCharacters(characters) {

    characters.slice(0, 8).forEach(character => {

        const card =
            document.createElement("div");

        card.classList.add("card");

        card.innerHTML = `
            <img src="${character.character.images.jpg.image_url}" loading="lazy">

            <div class="card-content">

                <h3>
                    ${character.character.name}
                </h3>

            </div>
        `;

        characterContainer.appendChild(card);
    });
}

/* FETCH RECOMMENDATIONS */

async function getRecommendations() {

    const response = await fetch(
        `https://api.jikan.moe/v4/anime/${animeId}/recommendations`
    );

    const data = await response.json();

    showRecommendations(data.data);
}

/* SHOW RECOMMENDATIONS */

function showRecommendations(recommendations) {

    recommendations.slice(0, 8).forEach(rec => {

        const anime =
            rec.entry;

        const card =
            document.createElement("div");

        card.classList.add("card");

        card.innerHTML = `
            <img src="${anime.images.jpg.image_url}" loading="lazy">

            <div class="card-content">

                <h3>${anime.title}</h3>

            </div>
        `;

        /* CLICK RECOMMENDED ANIME */

        card.addEventListener("click", () => {

            window.location.href =
                `anime.html?id=${anime.mal_id}`;
        });

        recommendationContainer
            .appendChild(card);
    });
}

/* START */

getAnimeDetails();
getCharacters();
getRecommendations();
/* RECOMMEND ANIME */

async function loadRecommendations() {

    const response = await fetch(

        `https://api.jikan.moe/v4/anime/${animeId}/recommendations`
    );

    const data =
        await response.json();

    const recommendations =
        data.data.slice(0, 6);

    recommendations.forEach(item => {

        const anime =
            item.entry;

        const card =
            document.createElement("div");

        card.classList.add("card");

        card.innerHTML = `
            <img src="${anime.images.jpg.image_url}" loading="lazy">

            <div class="card-content">

                <h3>${anime.title}</h3>

            </div>
        `;

        card.addEventListener("click", () => {

            window.location.href =

                `anime.html?id=${anime.mal_id}`;
        });

        recommendContainer
            .appendChild(card);
    });
}

/* START */

loadRecommendations();