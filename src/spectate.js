import { exec, execSync } from "child_process";
import { fetch, Agent } from "undici";

import { refreshSourceCache, playAudioFile, setPostGame } from "./obs.js";
import { resetCurrentGame, setBBDefaults, waitForBB } from "./bb.js";

const agent = new Agent({
  connect: {
    rejectUnauthorized: false,
  },
});

const { API_KEY, REGION } = process.env;

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

      let gameData;

      try {
        gameData = await getCurrentGameData();
      } catch {
        this.reset();
        return;
      }

      const { isDead = false } = parsePlayerData(
        gameData,
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

      if (this.isDead === null) {
        await setTargetAuto(this);
        console.log("START autofocus.");

        setTimeout(async () => {
          console.log("START focusing on player.");
          await setTargetAuto(this);
          this.keepFocusTimer = this.focusPlayerTimeout();
        }, 5000);

        this.isDead = isDead;
        return;
      }

      this.isDead = isDead;

      if (this.activeGame) {
        this.keepFocusTimer = this.focusPlayerTimeout();
      }
    }, 500);
  }

  autoDirector() {
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

        this.keepFocusTimer = this.focusPlayerTimeout();
        this.teamfightUpdateTimer = this.teamfightUpdate();
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
          refreshSourceCache();
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

        this.autoDirector();
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
