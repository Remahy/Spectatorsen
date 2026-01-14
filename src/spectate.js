import { exec, execSync } from "child_process";
import { fetch, Agent } from "undici";

import { refreshBrowserSourceCache, playAudioFile } from "./obs.js";

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
  } catch (error) {
    console.error("Error retrieving PUUID", error);
    throw new Error("Account not found");
  }
}

async function getCurrentGame(puuid, spectateRegion) {
  const url = `https://${spectateRegion}.api.riotgames.com/lol/spectator/v5/active-games/by-summoner/${puuid}`;

  const res = await fetch(url, {
    headers: { "X-Riot-Token": API_KEY },
  });

  if (res.status === 404) {
    return null; // not in game
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
      }
    );

    if (!res.ok) {
      return {};
    }

    return res.json();
  } catch {
    return {};
  }
}

function parsePlayerData(data = {}, gameName) {
  const { allPlayers = [] } = data || {};

  const player = allPlayers.find(
    (player) => player.riotIdGameName.toLowerCase() === gameName.toLowerCase()
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
    interfaceFrames: true,
    interfaceKillCallouts: true,
    interfaceMinimap: true,
    interfaceNeutralTimers: true,
    interfaceQuests: true,
    interfaceReplay: false,
    interfaceScore: true,
    interfaceScoreboard: true,
    interfaceTarget: true,
    interfaceTimeline: false,
  };

  return changeRender(uiSettings);
}

function launchSpectator(game) {
  const { encryptionKey } = game.observers;
  const { gameId, platformId } = game;

  const uri = `opgg://spectate?host=spectator.${platformId.toLowerCase()}.lol.pvp.net%3A8080&key=${encodeURIComponent(
    encryptionKey
  )}&gameId=${gameId}&platformId=${platformId.toUpperCase()}&game=LOL`;

  exec(`cmd /c start "" "${uri}"`);
}

function shutdownSpectator() {
  try {
    execSync(`taskkill /IM "League of Legends.exe" /F`);
  } catch (error) {
    console.log("Found nothing to shutdown.");
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
  keepFocusTimer = null;
  lastGameTime = -1;
  isDead = null;
  activeGame = false;

  /** @type {Player} */
  currentPlayer = new Player();

  constructor() {}

  reset() {
    shutdownSpectator();
    clearTimeout(this.keepFocusTimer);
    this.lastGameId = null;
    this.keepFocusTimer = null;
    this.lastGameTime = -1;
    this.isDead = null;
    this.activeGame = false;
  }

  /**
   * @param {Player} playerSpectate
   */
  setPlayer(playerSpectate) {
    this.reset();

    this.currentPlayer = playerSpectate;
  }

  focusPlayerTimeout() {
    const targetPlayer = {
      selectionName: this.currentPlayer.gameName,
      cameraAttached: true,
      cameraMode: "fps",
      selectionOffset: {
        x: 0.0,
        y: 1911.85,
        z: -1200.0,
      },
    };

    const targetEveryone = {
      cameraMode: "top",
    };

    return setTimeout(async () => {
      const gameData = await getCurrentGameData();
      const { isDead = false } = parsePlayerData(
        gameData,
        this.currentPlayer.gameName
      );

      if (isDead === this.isDead && this.activeGame) {
        this.keepFocusTimer = this.focusPlayerTimeout();
        return;
      }

      if (!isDead) {
        await changeRender(targetPlayer);
        console.log("Focusing on player.");
      } else {
        playAudioFile();
        await changeRender(targetEveryone);
        console.log("Autofocus.");
      }

      if (this.isDead === null) {
        await changeRender(targetEveryone);
        console.log("START autofocus.");

        setTimeout(async () => {
          console.log("START focusing on player.");
          await changeRender(targetPlayer);
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
      }, 10_000);
    };

    checkIsLive();
  }

  async update() {
    // Prevent overlapping requests if one poll is slow
    if (this.isUpdating) {
      return;
    }

    this.isUpdating = true;

    try {
      const game = await getCurrentGame(
        this.currentPlayer.puuid,
        this.currentPlayer.region.platform
      );

      // Player not in-game.
      if (!game) {
        this.lastGameId = null;

        const { gameData } = await getCurrentGameData();

        if (gameData?.gameTime && this.lastGameTime === gameData?.gameTime) {
          this.reset();
          refreshBrowserSourceCache();
          console.log("Resetting.");
        } else {
          this.lastGameTime = gameData?.gameTime || -1;
          console.log("Not in-game.");
        }

        return;
      }

      // Same game as before, then do nothing.
      if (game.gameId === this.lastGameId) {
        return;
      }

      this.reset();

      this.lastGameId = game.gameId;
      console.log(`New game detected: ${game.gameId}`);

      setTimeout(async () => {
        launchSpectator(game);
        this.activeGame = true;

        this.autoDirector();
      }, 30_000);
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
