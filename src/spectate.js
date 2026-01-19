import { exec, execSync } from "child_process";
import { fetch, Agent } from "undici";

import bbSchedules from "../bbSchedulesObject.cjs";
import {
  refreshSourceCache,
  playAudioFile,
  setPostGame,
  setSourceVisibility,
  changeLobbyInfo,
} from "./obs.js";
import { resetCurrentGame, setBBDefaults, showChart, waitForBB } from "./bb.js";
import { getChampions } from "./ddragon.js";

const agent = new Agent({
  connect: {
    rejectUnauthorized: false,
  },
});

const { API_KEY, REGION, OBS_POST_GAME_SOURCE, OBS_BLUEBOTTLE_SOURCE } =
  process.env;

async function getPUUID(gameName, tagLine, region = REGION) {
  try {
    const url = `https://${region}.api.riotgames.com/riot/account/v1/accounts/by-riot-id/${gameName}/${tagLine}`;

    const res = await fetch(url, {
      headers: { "X-Riot-Token": API_KEY },
    });

    if (!res.ok) {
      throw new Error("Account not found");
    }

    return res.json();
  } catch (err) {
    console.error("Error retrieving PUUID", err);
    throw new Error("Account not found");
  }
}

async function getCurrentGame(puuid, spectateRegion) {
  const url = `https://${spectateRegion}.api.riotgames.com/lol/spectator/v5/active-games/by-summoner/${puuid}`;

  const res = await fetch(url, {
    headers: { "X-Riot-Token": API_KEY },
  });

  if (res.status === 404) {
    return null;
  }

  if (!res.ok) {
    throw new Error("Spectator API error");
  }

  return res.json();
}

async function getCurrentGameData() {
  try {
    const res = await fetch(
      "https://127.0.0.1:2999/liveclientdata/allgamedata",
      {
        dispatcher: agent,
        signal: AbortSignal.timeout(5000),
      },
    );

    if (!res.ok) {
      return {};
    }

    return res.json();
  } catch (err) {
    if (err.name === "TimeoutError") {
      throw err;
    }

    return {};
  }
}

const getLobbyData = async (game) => {
  const champions = getChampions();

  try {
    let players = null;

    try {
      const playersPromisesRes = await Promise.allSettled(
        (game.participants || []).map(async (p) => {
          if (!p.puuid) {
            return null;
          }

          const res = await fetch(
            `https://${game.platformId.toLowerCase()}.api.riotgames.com/lol/league/v4/entries/by-puuid/${p.puuid}`,
            {
              headers: { "X-Riot-Token": API_KEY },
            },
          );

          if (!res.ok) {
            return null;
          }

          const entries = await res.json();

          const soloQ =
            entries.find((e) => e.queueType === "RANKED_SOLO_5x5") || null;

          return {
            name: p.riotId,
            champion: champions.find(({ key }) => key === String(p.championId))
              ?.name,
            soloQ,
            teamId: p.teamId,
          };
        }),
      );

      const playersRes = playersPromisesRes
        .map(({ value }) => value)
        .filter(Boolean);

      players = playersRes.reduce((obj, participant) => {
        const teamName = participant.teamId === 100 ? "BLUE" : "RED";

        if (!obj[teamName]) {
          obj[teamName] = [];
        }

        obj[teamName].push({
          champion: participant.champion,
					rank: participant.soloQ,
          fullRank: participant.soloQ?.tier
            ? `${participant.soloQ?.tier} ${participant.soloQ?.rank} (${participant.soloQ?.leaguePoints}) ${participant.soloQ?.wins}W-${participant.soloQ?.losses}L`
            : "UNRANKED",
        });

        return obj;
      }, {});
    } catch (err) {
      console.error("Failed to get player lobby stats.", err);
    }

    const bannedChampionsRaw = structuredClone(
      game.bannedChampions || [],
    )?.sort((a, b) => a.pickTurn - b.pickTurn);

    const bannedChampions = bannedChampionsRaw.reduce((obj, ban) => {
      const teamName = ban.teamId === 100 ? "BLUE" : "RED";

      if (!obj[teamName]) {
        obj[teamName] = [];
      }

      obj[teamName].push(
        champions.find(({ key }) => key === String(ban.championId))?.name,
      );

      return obj;
    }, {});

    return { players, bannedChampions };
  } catch (err) {
    console.error("Something went wrong getting player statistics.", err);
    return {};
  }
};

/**
 * @param {CurrentGame} currentGame
 */
const updateLobbyInfo = async (currentGame, game) => {
  const { players, bannedChampions } = await getLobbyData(game);

  const layout = `Start: ${new Date(game.gameStartTime).toUTCString()}

${
  bannedChampions
    ? `Bans B:
${bannedChampions.BLUE.join(", ")}
Bans R:
${bannedChampions.RED.join(", ")}
`
    : ""
}${
    players
      ? `Ranks B:
${players.BLUE.map(({ champion, fullRank }) => `${champion}: ${fullRank}`).join('\n')}
Ranks R:
${players.RED.map(({ champion, fullRank }) => `${champion}: ${fullRank}`).join('\n')}`
      : ""
  }`;

	currentGame.chat(`Bans blue team: ${bannedChampions.BLUE.join(", ")}. Bans red team: ${bannedChampions.RED.join(", ")}.`);


  return changeLobbyInfo(layout);
};

function parsePlayerData(data = {}, gameName) {
  const { allPlayers = [] } = data || {};

  const player = allPlayers.find(
    (player) => player.riotIdGameName.toLowerCase() === gameName.toLowerCase(),
  );

  return player || {};
}

async function changeRender(renderSettings) {
  try {
    const res = await fetch("https://127.0.0.1:2999/replay/render", {
      dispatcher: agent,
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(renderSettings),
    });

    return res;
  } catch (err) {
    console.error("Something went wrong changing render.");
  }
}

function renderDefaultUI() {
  const uiSettings = {
    interfaceAll: true,
    interfaceAnnounce: true,
    interfaceChat: true,
    interfaceFrames: false,
    interfaceKillCallouts: true,
    interfaceMinimap: true,
    interfaceNeutralTimers: true,
    interfaceQuests: true,
    interfaceReplay: false,
    interfaceScore: false,
    interfaceScoreboard: false,
    interfaceTarget: true,
    interfaceTimeline: false,
  };

  return changeRender(uiSettings);
}

/**
 * @param {CurrentGame} currentGame
 */
export const setTargetPlayer = async (currentGame, gameName) => {
  if (!currentGame.activeGame) {
    return;
  }

  const targetPlayer = {
    selectionName: gameName,
    cameraAttached: true,
    cameraMode: "fps",
    selectionOffset: {
      x: 0.0,
      y: 1911.85,
      z: -1200.0,
    },
  };

  return changeRender(targetPlayer);
};

/**
 * @param {CurrentGame} currentGame
 */
export const setTargetAuto = async (currentGame) => {
  if (!currentGame.activeGame) {
    return;
  }

  const targetAuto = {
    cameraMode: "top",
  };

  return changeRender(targetAuto);
};

function launchSpectator(game) {
  const { encryptionKey } = game.observers;
  const { gameId, platformId } = game;

  const uri = `opgg://spectate?host=spectator.${platformId.toLowerCase()}.lol.pvp.net%3A8080&key=${encodeURIComponent(
    encryptionKey,
  )}&gameId=${gameId}&platformId=${platformId.toUpperCase()}&game=LOL`;

  exec(`cmd /c start "" "${uri}"`);
}

function shutdownSpectator() {
  try {
    execSync(`taskkill /IM "League of Legends.exe" /F`, { stdio: "ignore" });
  } catch {
    // noop
  }

  try {
    execSync(`taskkill /IM "OpenWith.exe" /F`, { stdio: "ignore" });
  } catch {
    // noop
  }
}

const checkIsInReplay = async () => {
  try {
    const isInReplay = await fetch("https://127.0.0.1:2999/replay/game", {
      dispatcher: agent,
    });

    if (!isInReplay.ok) {
      return false;
    }

    const res = await isInReplay.json();

    if (typeof res.processID === "undefined") {
      return false;
    }
  } catch (err) {
    console.error("Client not live?");
    return false;
  }

  return true;
};

class CurrentGame {
  lastGameId = null;
  isUpdating = false;
  startAutoDirectorTimer = null;
  keepFocusTimer = null;
  lastGameTime = -1;
  isDead = null;
  activeGame = false;

  /**
   * @type {Array<{ time: number, charts: string[] }>}
   */
  schedules = [];

  /** @type {(msg: string) => void} */
  chat = () => {
    /* noop */
  };

  /** @type {Player} */
  currentPlayer = new Player();

  constructor() {}

  reset() {
    clearTimeout(this.startAutoDirectorTimer);
    clearTimeout(this.keepFocusTimer);
    clearTimeout(this.teamfightUpdateTimer);
    shutdownSpectator();
    setSourceVisibility("Scene", OBS_POST_GAME_SOURCE, false);
    this.schedules = structuredClone(bbSchedules);
    this.lastGameId = null;
    this.startAutoDirectorTimer = null;
    this.keepFocusTimer = null;
    this.teamfightUpdateTimer = null;
    this.lastGameTime = -1;
    this.isDead = null;
    this.activeGame = false;
  }

  /**
   * @param {(msg: string) => void} fn
   */
  setChat(fn) {
    this.chat = fn;
  }

  /**
   * @param {Player | null} playerSpectate
   */
  setPlayer(playerSpectate) {
    this.reset();

    this.currentPlayer = playerSpectate;
  }

  focusPlayerTimeout() {
    return setTimeout(async () => {
      // Always maintain UI.
      renderDefaultUI();

      let data;
      let gameData;

      try {
        data = await getCurrentGameData();
        gameData = data.gameData;
      } catch {
        this.reset();
        return;
      }

      if (this.schedules[0].time < gameData.gameTime) {
        const schedule = this.schedules.shift();
        console.log("Auto-chart:", schedule.charts.join(", "));
        showChart(schedule.charts);
      }

      const { isDead = false } = parsePlayerData(
        data,
        this.currentPlayer.gameName,
      );

      if (isDead === this.isDead && this.activeGame) {
        this.keepFocusTimer = this.focusPlayerTimeout();
        return;
      }

      if (!isDead) {
        await setTargetPlayer(this, this.currentPlayer.gameName);
        console.log("Focusing on player.");
      } else {
        playAudioFile();
        setTimeout(() => {
          setTargetAuto(this);
          console.log("Autofocus.");
        }, 2500);
      }

      if (this.isDead === null && this.activeGame) {
        await setTargetAuto(this);
        console.log("START autofocus.");

        setTimeout(async () => {
          console.log("START focusing on player.");
          await setTargetPlayer(this, this.currentPlayer.gameName);
          this.keepFocusTimer = this.focusPlayerTimeout();
        }, 10_000);

        this.isDead = isDead;

        for (let index = 0; index < this.schedules.length; index++) {
          if (this.schedules[index].time < gameData.gameTime) {
            this.schedules[index] = null;
          }
        }

        this.schedules = this.schedules.filter(Boolean);
        return;
      }

      this.isDead = isDead;

      if (this.activeGame) {
        this.keepFocusTimer = this.focusPlayerTimeout();
      }
    }, 500);
  }

  autoDirector(game) {
    const checkIsLive = () => {
      return setTimeout(async () => {
        const isInReplay = await checkIsInReplay();
        if (!isInReplay) {
          if (this.activeGame) {
            checkIsLive();
          }
          return;
        }

        renderDefaultUI();

        showChart(["runes"]);

        updateLobbyInfo(this, game);

        this.keepFocusTimer = this.focusPlayerTimeout();
        // this.teamfightUpdateTimer = this.teamfightUpdate();
      }, 10_000);
    };

    checkIsLive();
  }

  teamfightUpdate() {
    return setTimeout(async () => {
      let gameData;

      try {
        gameData = await getCurrentGameData();
      } catch {
        this.reset();
        return;
      }

      if (this.activeGame) {
        this.teamfightUpdateTimer = this.teamfightUpdate();
      }
    }, 75);
  }

  async update() {
    // Prevent overlapping requests if one poll is slow
    if (this.isUpdating) {
      return;
    }

    this.isUpdating = true;

    if (!this.currentPlayer) {
      this.isUpdating = false;
      console.log("Not spectating anyone.");
      return;
    }

    let game;
    try {
      game = await getCurrentGame(
        this.currentPlayer.puuid,
        this.currentPlayer.region.platform,
      );
    } catch (err) {
      console.error("Error retrieving spectator API", err);
    }

    try {
      // Player not in-game.
      if (!game) {
        this.lastGameId = null;
        let gameData;

        try {
          const data = await getCurrentGameData();
          gameData = data.gameData;
        } catch {
          // noop
        }

        if (
          gameData?.gameTime &&
          this.lastGameTime === Number(gameData.gameTime).toFixed(0)
        ) {
          this.reset();

          setTimeout(() => {
            refreshSourceCache();
          }, 5000);

          resetCurrentGame();
          setPostGame(true);
          console.log("Exiting completed game.");
        } else {
          this.lastGameTime = gameData?.gameTime
            ? Number(gameData?.gameTime).toFixed(0)
            : -1;
          console.log("Not in-game.");
        }

        return;
      }

      // Same game as before, then do nothing.
      if (game.gameId === this.lastGameId) {
        return;
      }

      if (this.activeGame) {
        try {
          const { gameData } = await getCurrentGameData();

          if (
            gameData?.gameTime &&
            this.lastGameTime === Number(gameData.gameTime).toFixed(0)
          ) {
            this.reset();
            refreshSourceCache();
            setPostGame(true, 60_000);
            console.log("Exiting completed game a tad late.");
          } else {
            console.log("Found new game, but current game is still ongoing.");
            this.lastGameTime = gameData?.gameTime
              ? Number(gameData?.gameTime).toFixed(0)
              : -1;
            return;
          }
        } catch {
          // noop
        }
      }

      this.lastGameId = game.gameId;
      console.log(`New game detected: ${game.gameId}`);

      setBBDefaults();
      await waitForBB();

      const msSinceStart = Date.now() - game.gameStartTime;
      const spectatorTimeout =
        msSinceStart > 200_000 ? 0 : 200_000 - msSinceStart;

      console.log(
        "Waiting",
        spectatorTimeout > 0 ? spectatorTimeout / 1000 : 0,
        "seconds before launching client.",
      );

      this.chat(
        `Game found. ${
          spectatorTimeout > 0
            ? ` Waiting ${Math.ceil(
                spectatorTimeout / 1000,
              )} seconds before launching client.`
            : ""
        }`,
      );

      refreshSourceCache();

      this.startAutoDirectorTimer = setTimeout(async () => {
        this.chat("Loading client...");

        launchSpectator(game);
        this.activeGame = true;

        this.autoDirector(game);
      }, spectatorTimeout);
    } catch (err) {
      console.error("Watcher error:", err);
      console.error(err);
    } finally {
      this.isUpdating = false;
    }
  }
}

export class Player {
  /**
   * @type {{ platform: string, regional: string }}
   */
  region = { platform: "", regional: "" };
  gameName = "";
  tagLine = "";
  puuid = "";

  /**
   *
   * @param {{ platform: string, regional: string }} region
   * @param {string} gameName
   * @param {string} tagLine
   * @param {string} puuid
   */
  constructor(region, gameName, tagLine, puuid) {
    this.region = region;
    this.gameName = gameName;
    this.tagLine = tagLine;
    this.puuid = puuid;
  }

  /**
   * @param {string} value
   */
  static async find(value) {
    const [gameName, tagLine] = value.split("#");

    if (!gameName || !tagLine) {
      throw new Error("Incorrect player value, must be playername#tagline");
    }

    return getPUUID(gameName, tagLine);
  }
}

export default new CurrentGame();
