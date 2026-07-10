"use strict";

/* =========================================================
   CONFIGURATION
   ========================================================= */

const CONFIG = {
    apiBase: "https://statsapi.mlb.com/api/v1",

    refreshIntervalMs: 30_000,
    pageIntervalMs: 8_000,

    gamesPerPage: 4,

    // Leave empty to show every team.
    // Example:
    // preferredTeams: ["BOS", "NYY", "LAD"],
    preferredTeams: [],

    // Options:
    // "all"
    // "preferred-first"
    // "preferred-only"
    teamFilterMode: "all",

    showRecords: true,
    showBases: true,
    showEmptyCards: true,

    // For testing, enter a date such as "2026-07-09".
    // Leave null for today's date.
    dateOverride: null,

    // When today has no games, search backward for
    // the most recent day that had games.
    showLatestGamesWhenEmpty: true,

    // Maximum number of prior days to search.
    latestGamesLookbackDays: 14
};

/* =========================================================
   TEAM PRESENTATION COLORS
   ========================================================= */

const TEAM_INFO = {
    ARI: { color: "#a71930" },
    ATH: { color: "#003831" },
    ATL: { color: "#ce1141" },
    BAL: { color: "#df4601" },
    BOS: { color: "#bd3039" },
    CHC: { color: "#0e3386" },
    CWS: { color: "#27251f" },
    CIN: { color: "#c6011f" },
    CLE: { color: "#00385d" },
    COL: { color: "#333366" },
    DET: { color: "#0c2340" },
    HOU: { color: "#002d62" },
    KC:  { color: "#004687" },
    LAA: { color: "#ba0021" },
    LAD: { color: "#005a9c" },
    MIA: { color: "#00a3e0" },
    MIL: { color: "#12284b" },
    MIN: { color: "#002b5c" },
    NYM: { color: "#002d72" },
    NYY: { color: "#0c2340" },
    PHI: { color: "#e81828" },
    PIT: { color: "#fdb827" },
    SD:  { color: "#2f241d" },
    SF:  { color: "#fd5a1e" },
    SEA: { color: "#0c2c56" },
    STL: { color: "#c41e3a" },
    TB:  { color: "#092c5c" },
    TEX: { color: "#003278" },
    TOR: { color: "#134a8e" },
    WSH: { color: "#ab0003" }
};

/* =========================================================
   STATE
   ========================================================= */

const state = {
    games: [],
    pages: [],

    currentPage: 0,

    refreshTimer: null,
    pageTimer: null,

    lastSuccessfulUpdate: null,

    isLoading: false,

    displayedDate: null,
    showingPreviousDate: false
};

/* =========================================================
   DOM REFERENCES
   ========================================================= */

const elements = {
    scoresTrack: document.querySelector("#scores-track"),
    tickerDate: document.querySelector("#ticker-date"),
    pageIndicator: document.querySelector("#page-indicator"),
    lastUpdated: document.querySelector("#last-updated"),
    liveDot: document.querySelector("#live-dot"),
    connectionLabel: document.querySelector("#connection-label"),
    bottomMarquee: document.querySelector("#bottom-marquee"),
    bottomLabel: document.querySelector("#bottom-label")
};

/* =========================================================
   STARTUP
   ========================================================= */

document.addEventListener("DOMContentLoaded", initializeTicker);

async function initializeTicker() {
    updateDisplayedDateLabel();

    await refreshScores();

    state.refreshTimer = window.setInterval(
        refreshScores,
        CONFIG.refreshIntervalMs
    );

    document.addEventListener("visibilitychange", () => {
        if (!document.hidden) {
            refreshScores();
        }
    });
}

/* =========================================================
   SCORE REFRESH
   ========================================================= */

async function refreshScores() {
    if (state.isLoading) {
        return;
    }

    state.isLoading = true;

    try {
        const requestedDate = getRequestDate();

        let result = await fetchGamesForDate(requestedDate);

        state.displayedDate = requestedDate;
        state.showingPreviousDate = false;

        if (
            result.games.length === 0 &&
            CONFIG.showLatestGamesWhenEmpty &&
            !CONFIG.dateOverride
        ) {
            const latestResult = await findLatestGamesBefore(
                requestedDate,
                CONFIG.latestGamesLookbackDays
            );

            if (latestResult) {
                result = latestResult;

                state.displayedDate = latestResult.date;
                state.showingPreviousDate = true;
            }
        }

        const processedGames = result.games
            .map(normalizeGame)
            .filter(Boolean);

        state.games = sortAndFilterGames(processedGames);

        state.lastSuccessfulUpdate = new Date();

        updateDisplayedDateLabel();
        renderTicker();
        setConnectionState(true);
    } catch (error) {
        console.error("Unable to update MLB ticker:", error);

        setConnectionState(false);

        if (state.games.length === 0) {
            renderErrorMessage();
        }
    } finally {
        state.isLoading = false;

        updateLastUpdatedLabel();
    }
}

/* =========================================================
   MLB API REQUESTS
   ========================================================= */

async function fetchGamesForDate(date) {
    const query = new URLSearchParams({
        sportId: "1",
        date,
        hydrate: "linescore,team,probablePitcher"
    });

    const requestUrl =
        `${CONFIG.apiBase}/schedule?${query.toString()}`;

    const response = await fetch(requestUrl, {
        method: "GET",
        cache: "no-store"
    });

    if (!response.ok) {
        throw new Error(
            `MLB request failed with status ${response.status}`
        );
    }

    const payload = await response.json();

    const games =
        Array.isArray(payload.dates)
            ? payload.dates.flatMap(
                dateItem => dateItem.games ?? []
            )
            : [];

    return {
        date,
        games
    };
}

async function findLatestGamesBefore(startDate, maximumDays) {
    for (
        let daysBack = 1;
        daysBack <= maximumDays;
        daysBack += 1
    ) {
        const previousDate = shiftDate(
            startDate,
            -daysBack
        );

        try {
            const result = await fetchGamesForDate(
                previousDate
            );

            if (result.games.length > 0) {
                return result;
            }
        } catch (error) {
            console.warn(
                `Could not check games for ${previousDate}:`,
                error
            );
        }
    }

    return null;
}

/* =========================================================
   NORMALIZE API DATA
   ========================================================= */

function normalizeGame(game) {
    if (
        !game?.teams?.away?.team ||
        !game?.teams?.home?.team
    ) {
        return null;
    }

    const awayTeam = normalizeTeam(
        game.teams.away
    );

    const homeTeam = normalizeTeam(
        game.teams.home
    );

    const linescore = game.linescore ?? {};

    return {
        id: game.gamePk,

        gameDate: game.gameDate
            ? new Date(game.gameDate)
            : null,

        away: awayTeam,
        home: homeTeam,

        abstractState:
            game.status?.abstractGameState ??
            "Preview",

        detailedState:
            game.status?.detailedState ??
            "Scheduled",

        codedState:
            game.status?.codedGameState ??
            "",

        inning:
            Number(linescore.currentInning ?? 0),

        inningOrdinal:
            linescore.currentInningOrdinal ??
            "",

        inningHalf:
            linescore.inningHalf ??
            "",

        outs:
            Number(linescore.outs ?? 0),

        offense: {
            first:
                Boolean(linescore.offense?.first),

            second:
                Boolean(linescore.offense?.second),

            third:
                Boolean(linescore.offense?.third)
        },

        venue:
            game.venue?.name ??
            "",

        probablePitchers: {
            away:
                game.teams.away.probablePitcher?.fullName ??
                "",

            home:
                game.teams.home.probablePitcher?.fullName ??
                ""
        }
    };
}

function normalizeTeam(teamEntry) {
    const team = teamEntry.team ?? {};

    let abbreviation =
        team.abbreviation ??
        deriveAbbreviation(team.name);

    if (abbreviation === "OAK") {
        abbreviation = "ATH";
    }

    return {
        id: team.id,

        name:
            team.name ??
            "Unknown",

        abbreviation,

        score:
            Number(teamEntry.score ?? 0),

        wins:
            Number(
                teamEntry.leagueRecord?.wins ??
                0
            ),

        losses:
            Number(
                teamEntry.leagueRecord?.losses ??
                0
            )
    };
}

function deriveAbbreviation(teamName) {
    return String(teamName ?? "")
        .split(/\s+/)
        .filter(Boolean)
        .map(word => word[0])
        .join("")
        .slice(0, 3)
        .toUpperCase();
}

/* =========================================================
   SORTING / FILTERING
   ========================================================= */

function sortAndFilterGames(games) {
    let result = [...games];

    if (
        CONFIG.teamFilterMode === "preferred-only" &&
        CONFIG.preferredTeams.length > 0
    ) {
        result = result.filter(
            game => isPreferredGame(game)
        );
    }

    result.sort((a, b) => {
        if (
            CONFIG.teamFilterMode === "preferred-first"
        ) {
            const preferredDifference =
                Number(isPreferredGame(b)) -
                Number(isPreferredGame(a));

            if (preferredDifference !== 0) {
                return preferredDifference;
            }
        }

        const statusDifference =
            getStatusSortValue(a) -
            getStatusSortValue(b);

        if (statusDifference !== 0) {
            return statusDifference;
        }

        const aTime =
            a.gameDate?.getTime() ??
            0;

        const bTime =
            b.gameDate?.getTime() ??
            0;

        return aTime - bTime;
    });

    return result;
}

function isPreferredGame(game) {
    if (CONFIG.preferredTeams.length === 0) {
        return false;
    }

    const preferred = new Set(
        CONFIG.preferredTeams.map(
            team => team.toUpperCase()
        )
    );

    return (
        preferred.has(game.away.abbreviation) ||
        preferred.has(game.home.abbreviation)
    );
}

function getStatusSortValue(game) {
    if (isLiveGame(game)) {
        return 0;
    }

    if (isUpcomingGame(game)) {
        return 1;
    }

    if (isDelayedGame(game)) {
        return 2;
    }

    if (isFinalGame(game)) {
        return 3;
    }

    return 4;
}

/* =========================================================
   TICKER RENDERING
   ========================================================= */

function renderTicker() {
    stopPageRotation();

    if (state.games.length === 0) {
        renderNoGamesMessage();
        return;
    }

    state.pages = chunkArray(
        state.games,
        CONFIG.gamesPerPage
    );

    state.currentPage = Math.min(
        state.currentPage,
        state.pages.length - 1
    );

    elements.scoresTrack.innerHTML = "";

    state.pages.forEach(
        (games, pageIndex) => {
            const page =
                document.createElement("div");

            page.className = "score-page";

            if (pageIndex === state.currentPage) {
                page.classList.add("is-active");
            } else if (
                pageIndex < state.currentPage
            ) {
                page.classList.add("is-before");
            } else {
                page.classList.add("is-after");
            }

            games.forEach(game => {
                page.appendChild(
                    createGameCard(game)
                );
            });

            if (
                CONFIG.showEmptyCards &&
                games.length < CONFIG.gamesPerPage
            ) {
                const emptyCount =
                    CONFIG.gamesPerPage -
                    games.length;

                for (
                    let i = 0;
                    i < emptyCount;
                    i += 1
                ) {
                    const emptyCard =
                        document.createElement("div");

                    emptyCard.className =
                        "empty-game-card";

                    emptyCard.textContent =
                        "MLB";

                    page.appendChild(emptyCard);
                }
            }

            elements.scoresTrack.appendChild(page);
        }
    );

    updatePageIndicator();
    renderBottomMarquee();

    if (state.pages.length > 1) {
        startPageRotation();
    }
}

function createGameCard(game) {
    const card =
        document.createElement("article");

    card.className =
        `game-card ${getGameClass(game)}`;

    card.style.setProperty(
        "--card-accent",
        getTeamColor(
            game.home.abbreviation
        )
    );

    const awayWinning =
        isFinalOrLive(game) &&
        game.away.score >
        game.home.score;

    const homeWinning =
        isFinalOrLive(game) &&
        game.home.score >
        game.away.score;

    card.innerHTML = `
        <header class="game-header">
            <span class="game-header-status">
                ${escapeHtml(
                    getPrimaryStatus(game)
                )}
            </span>

            <span class="game-header-extra">
                ${escapeHtml(
                    getHeaderExtra(game)
                )}
            </span>
        </header>

        ${createTeamRowHtml(
            game.away,
            "away",
            awayWinning,
            homeWinning,
            game
        )}

        ${createTeamRowHtml(
            game.home,
            "home",
            homeWinning,
            awayWinning,
            game
        )}

        <footer class="game-footer">
            <span class="game-detail ${
                isLiveGame(game)
                    ? "game-live"
                    : ""
            }">
                ${escapeHtml(
                    getGameDetail(game)
                )}
            </span>

            ${
                CONFIG.showBases &&
                isLiveGame(game)
                    ? createBasesHtml(
                        game.offense
                    )
                    : ""
            }
        </footer>
    `;

    return card;
}

function createTeamRowHtml(
    team,
    homeAway,
    isWinning,
    isLosing,
    game
) {
    const classes = [
        "team-row",
        `team-row-${homeAway}`
    ];

    if (isWinning) {
        classes.push("is-winning");
    }

    if (isLosing) {
        classes.push("is-losing");
    }

    const record =
        CONFIG.showRecords
            ? `${team.wins}-${team.losses}`
            : "";

    const score =
        shouldShowScore(game)
            ? team.score
            : "–";

    return `
        <div class="${classes.join(" ")}">
            <span
                class="team-color"
                style="--team-color: ${
                    getTeamColor(
                        team.abbreviation
                    )
                }"
            ></span>

            <span class="team-info">
                <span class="team-abbreviation">
                    ${escapeHtml(
                        team.abbreviation
                    )}
                </span>

                ${
                    record
                        ? `
                            <span class="team-record">
                                ${escapeHtml(record)}
                            </span>
                        `
                        : ""
                }
            </span>

            <span class="team-score">
                ${score}
            </span>
        </div>
    `;
}

function createBasesHtml(offense) {
    return `
        <span
            class="bases"
            aria-label="Runners on base"
        >
            <span class="base base-first ${
                offense.first
                    ? "is-occupied"
                    : ""
            }"></span>

            <span class="base base-second ${
                offense.second
                    ? "is-occupied"
                    : ""
            }"></span>

            <span class="base base-third ${
                offense.third
                    ? "is-occupied"
                    : ""
            }"></span>
        </span>
    `;
}

/* =========================================================
   GAME STATUS TEXT
   ========================================================= */

function getPrimaryStatus(game) {
    if (isFinalGame(game)) {
        if (
            /final/i.test(game.detailedState)
        ) {
            return game.detailedState;
        }

        return "Final";
    }

    if (isLiveGame(game)) {
        const half =
            game.inningHalf === "Top"
                ? "Top"
                : game.inningHalf === "Bottom"
                    ? "Bot"
                    : game.inningHalf;

        return `${half} ${game.inningOrdinal}`.trim();
    }

    if (isDelayedGame(game)) {
        return game.detailedState;
    }

    return formatGameTime(
        game.gameDate
    );
}

function getHeaderExtra(game) {
    if (isLiveGame(game)) {
        return formatOuts(game.outs);
    }

    if (isFinalGame(game)) {
        return "FINAL";
    }

    if (isDelayedGame(game)) {
        return "STATUS";
    }

    return "";
}

function getGameDetail(game) {
    if (isLiveGame(game)) {
        return formatOuts(game.outs);
    }

    if (isFinalGame(game)) {
        return "Game complete";
    }

    if (isDelayedGame(game)) {
        return game.detailedState;
    }

    const awayPitcher =
        game.probablePitchers.away;

    const homePitcher =
        game.probablePitchers.home;

    if (
        awayPitcher &&
        homePitcher
    ) {
        return (
            `${lastName(awayPitcher)} vs ` +
            `${lastName(homePitcher)}`
        );
    }

    if (game.venue) {
        return game.venue;
    }

    return "Scheduled";
}

function formatOuts(outs) {
    if (outs === 1) {
        return "1 OUT";
    }

    return `${outs} OUTS`;
}

function formatGameTime(date) {
    if (
        !(date instanceof Date) ||
        Number.isNaN(date.getTime())
    ) {
        return "TBD";
    }

    return new Intl.DateTimeFormat(
        "en-US",
        {
            hour: "numeric",
            minute: "2-digit"
        }
    ).format(date);
}

function lastName(fullName) {
    const parts = String(fullName)
        .trim()
        .split(/\s+/);

    return (
        parts.at(-1) ??
        fullName
    );
}

/* =========================================================
   GAME STATE HELPERS
   ========================================================= */

function isLiveGame(game) {
    return game.abstractState === "Live";
}

function isFinalGame(game) {
    return game.abstractState === "Final";
}

function isUpcomingGame(game) {
    return game.abstractState === "Preview";
}

function isDelayedGame(game) {
    return /delay|postpon|suspend/i.test(
        game.detailedState
    );
}

function isFinalOrLive(game) {
    return (
        isFinalGame(game) ||
        isLiveGame(game)
    );
}

function shouldShowScore(game) {
    return (
        isLiveGame(game) ||
        isFinalGame(game)
    );
}

function getGameClass(game) {
    if (isDelayedGame(game)) {
        return "delayed-game";
    }

    if (isLiveGame(game)) {
        return "live-game";
    }

    if (isFinalGame(game)) {
        return "final-game";
    }

    return "upcoming-game";
}

/* =========================================================
   PAGE ROTATION
   ========================================================= */

function startPageRotation() {
    stopPageRotation();

    state.pageTimer = window.setInterval(
        showNextPage,
        CONFIG.pageIntervalMs
    );
}

function stopPageRotation() {
    if (state.pageTimer !== null) {
        window.clearInterval(
            state.pageTimer
        );

        state.pageTimer = null;
    }
}

function showNextPage() {
    if (state.pages.length <= 1) {
        return;
    }

    const previousPage =
        state.currentPage;

    state.currentPage =
        (state.currentPage + 1) %
        state.pages.length;

    updatePageClasses(previousPage);
    updatePageIndicator();
}

function updatePageClasses(previousPage) {
    const pageElements =
        elements.scoresTrack.querySelectorAll(
            ".score-page"
        );

    pageElements.forEach(
        (page, index) => {
            page.classList.remove(
                "is-active",
                "is-before",
                "is-after"
            );

            if (
                index === state.currentPage
            ) {
                page.classList.add(
                    "is-active"
                );

                return;
            }

            if (
                previousPage ===
                    state.pages.length - 1 &&
                state.currentPage === 0
            ) {
                page.classList.add(
                    "is-after"
                );

                return;
            }

            if (
                index < state.currentPage
            ) {
                page.classList.add(
                    "is-before"
                );
            } else {
                page.classList.add(
                    "is-after"
                );
            }
        }
    );
}

function updatePageIndicator() {
    const pageCount = Math.max(
        state.pages.length,
        1
    );

    elements.pageIndicator.textContent =
        `${state.currentPage + 1} / ${pageCount}`;
}

/* =========================================================
   BOTTOM MARQUEE
   ========================================================= */

function renderBottomMarquee() {
    if (state.games.length === 0) {
        elements.bottomMarquee.textContent =
            "No recent MLB games were found.";

        restartMarqueeAnimation();

        return;
    }

    const summaries = state.games.map(game => {
        const away =
            game.away.abbreviation;

        const home =
            game.home.abbreviation;

        if (isLiveGame(game)) {
            return (
                `${away} ${game.away.score}, ` +
                `${home} ${game.home.score} — ` +
                `${getPrimaryStatus(game)}`
            );
        }

        if (isFinalGame(game)) {
            return (
                `${away} ${game.away.score}, ` +
                `${home} ${game.home.score} — Final`
            );
        }

        if (isDelayedGame(game)) {
            return (
                `${away} at ${home} — ` +
                `${game.detailedState}`
            );
        }

        return (
            `${away} at ${home} — ` +
            `${formatGameTime(game.gameDate)}`
        );
    });

    elements.bottomMarquee.textContent =
        summaries.join("     •     ");

    restartMarqueeAnimation();
}

function restartMarqueeAnimation() {
    elements.bottomMarquee.style.animation =
        "none";

    void elements.bottomMarquee.offsetWidth;

    elements.bottomMarquee.style.animation =
        "";
}

/* =========================================================
   EMPTY / ERROR STATES
   ========================================================= */

function renderNoGamesMessage() {
    state.pages = [];
    state.currentPage = 0;

    elements.scoresTrack.innerHTML = `
        <div class="message-card">
            No recent MLB games found
        </div>
    `;

    elements.pageIndicator.textContent =
        "0 / 0";

    elements.bottomLabel.textContent =
        "MLB SCOREBOARD";

    elements.bottomMarquee.textContent =
        "No MLB games were found within the previous " +
        `${CONFIG.latestGamesLookbackDays} days.`;

    restartMarqueeAnimation();
}

function renderErrorMessage() {
    state.pages = [];
    state.currentPage = 0;

    elements.scoresTrack.innerHTML = `
        <div class="message-card">
            MLB scores are temporarily unavailable
        </div>
    `;

    elements.pageIndicator.textContent =
        "—";

    elements.bottomMarquee.textContent =
        "Unable to reach the MLB score service. Retrying automatically.";

    restartMarqueeAnimation();
}

/* =========================================================
   CONNECTION / DATE LABELS
   ========================================================= */

function setConnectionState(isConnected) {
    elements.liveDot.classList.toggle(
        "is-error",
        !isConnected
    );

    elements.liveDot.classList.toggle(
        "is-previous",
        isConnected &&
        state.showingPreviousDate
    );

    if (!isConnected) {
        elements.connectionLabel.textContent =
            "RETRYING";

        return;
    }

    elements.connectionLabel.textContent =
        state.showingPreviousDate
            ? "LATEST RESULTS"
            : "LIVE SCORES";
}

function updateLastUpdatedLabel() {
    if (!state.lastSuccessfulUpdate) {
        elements.lastUpdated.textContent =
            "WAITING";

        return;
    }

    const formatted =
        new Intl.DateTimeFormat(
            "en-US",
            {
                hour: "numeric",
                minute: "2-digit",
                second: "2-digit"
            }
        ).format(
            state.lastSuccessfulUpdate
        );

    elements.lastUpdated.textContent =
        `UPDATED ${formatted}`;
}

function updateDisplayedDateLabel() {
    const dateString =
        state.displayedDate ??
        getRequestDate();

    const date =
        parseLocalDate(dateString);

    const formattedDate =
        new Intl.DateTimeFormat(
            "en-US",
            {
                weekday: "short",
                month: "short",
                day: "numeric"
            }
        )
            .format(date)
            .toUpperCase();

    elements.tickerDate.textContent =
        state.showingPreviousDate
            ? `LATEST • ${formattedDate}`
            : formattedDate;

    elements.bottomLabel.textContent =
        state.showingPreviousDate
            ? "LATEST MLB SCORES"
            : "MLB SCOREBOARD";

    elements.connectionLabel.textContent =
        state.showingPreviousDate
            ? "LATEST RESULTS"
            : "LIVE SCORES";
}

/* =========================================================
   DATE UTILITIES
   ========================================================= */

function getRequestDate() {
    if (CONFIG.dateOverride) {
        return CONFIG.dateOverride;
    }

    return formatLocalDate(
        new Date()
    );
}

function shiftDate(
    dateString,
    dayAmount
) {
    const date =
        parseLocalDate(dateString);

    date.setDate(
        date.getDate() +
        dayAmount
    );

    return formatLocalDate(date);
}

function formatLocalDate(date) {
    const year =
        date.getFullYear();

    const month =
        String(
            date.getMonth() + 1
        ).padStart(2, "0");

    const day =
        String(
            date.getDate()
        ).padStart(2, "0");

    return `${year}-${month}-${day}`;
}

function parseLocalDate(dateString) {
    const [
        year,
        month,
        day
    ] = dateString
        .split("-")
        .map(Number);

    return new Date(
        year,
        month - 1,
        day,
        12,
        0,
        0
    );
}

/* =========================================================
   GENERAL UTILITIES
   ========================================================= */

function getTeamColor(abbreviation) {
    return (
        TEAM_INFO[abbreviation]?.color ??
        "#6c7582"
    );
}

function chunkArray(items, size) {
    const chunks = [];

    for (
        let i = 0;
        i < items.length;
        i += size
    ) {
        chunks.push(
            items.slice(i, i + size)
        );
    }

    return chunks;
}

function escapeHtml(value) {
    return String(value ?? "")
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;")
        .replaceAll("'", "&#039;");
}
