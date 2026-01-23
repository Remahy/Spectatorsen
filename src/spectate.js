import { exec, execSync } from "child_process";

import bbSchedules from "../bbSchedulesObject.cjs";
import {
  refreshSourceCache,
  playAudioFile,
  setPostGame,
  setSourceVisibility,
  changeLobbyInfo,
} from "./obs.js";
import {
  markCurrentGameCompleted,
  setBBDefaults,
  showChart,
  waitForBB,
} from "./bb.js";
import { downloadReplays } from "./downloadReplays.js";
import { getCurrentGame, getLobbyData, getPUUID } from "./riot.js";
import { changeRender, checkIsInReplay, getAllGameData } from "./lol.js";

const { OBS_POST_GAME_SOURCE } = process.env;

/**
 * @param {CurrentGame} currentGame
 */
const updateLobbyInfo = async (currentGame, game) => {
  const { players, bannedChampions } = await getLobbyData(game);

  const start = `Start: ${new Date(game.gameStartTime).toUTCString()}`;

  if (!players?.length || bannedChampions?.length) {
    const layout = start;
    return changeLobbyInfo(layout);
  }

  const layout = `${start}

${
  bannedChampions
    ? `Bans Blue:
${bannedChampions.BLUE.join(", ")}
Bans Red:
${bannedChampions.RED.join(", ")}

`
    : ""
}${
    players
      ? `Ranks Blue:
${players.BLUE.map(({ champion, fullRank }) => `${champion}: ${fullRank}`).join("\n")}

Ranks Red:
${players.RED.map(({ champion, fullRank }) => `${champion}: ${fullRank}`).join("\n")}`
      : ""
  }`;

  if (bannedChampions?.BLUE && bannedChampions?.RED) {
    currentGame.chat(
      `(Bans Blue) ${bannedChampions.BLUE.join(" / ")}. (Bans Red) ${bannedChampions.RED.join(" / ")}.`,
    );
  }

  if (players?.BLUE && players?.RED) {
    setTimeout(() => {
      currentGame.chat(
        `(Ranks Blue) ${players.BLUE.map(({ champion, fullRank }) => `${champion}: ${fullRank}`).join(" / ")}`,
      );

      setTimeout(() => {
        currentGame.chat(
          `(Ranks Red) ${players.RED.map(({ champion, fullRank }) => `${champion}: ${fullRank}`).join(" / ")}`,
        );
      }, 500);
    }, 500);
  }

  return changeLobbyInfo(layout);
};

function parsePlayerData(data = {}, name) {
  const { allPlayers = [] } = data || {};

  const lowerCaseName = name.toLowerCase();

  const player = allPlayers.find(
    (player) =>
      player.riotIdGameName.toLowerCase() === lowerCaseName ||
      player.championName.toLowerCase() === lowerCaseName,
  );

  return player || {};
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
    selectionName: currentGame.customFollow || gameName,
    cameraAttached: true,
    cameraMode: "fps",
    selectionOffset: {
      x: 0.0,
      y: 2389.35009765625,
      z: -1500.0,
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

class CurrentGame {
  lastGameId = null;
  isUpdating = false;
  startAutoDirectorTimer = null;
  gameEventTimeout = null;
  lastGameTime = -1;
  isDead = null;
  activeGame = false;
  customFollow = null;

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

  async reset() {
    clearTimeout(this.startAutoDirectorTimer);
    clearTimeout(this.gameEventTimeout);
    clearTimeout(this.teamfightUpdateTimer);
    shutdownSpectator();
    this.schedules = structuredClone(bbSchedules);
    this.lastGameId = null;
    this.startAutoDirectorTimer = null;
    this.gameEventTimeout = null;
    this.teamfightUpdateTimer = null;
    this.lastGameTime = -1;
    this.isDead = null;
    this.activeGame = false;
    this.customFollow = null;
    await setSourceVisibility("Game", OBS_POST_GAME_SOURCE, false);
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

  gameEventTimer() {
    return setTimeout(async () => {
      // Always maintain UI.
      renderDefaultUI();

      let data;
      let gameData;

      try {
        data = await getAllGameData();
        gameData = data.gameData;
      } catch {
        this.reset();
        return;
      }

      if (!gameData) {
        console.log("No gameData in gameEventTimer?", JSON.stringify(data));
        return;
      }

      if (this.schedules.length && this.schedules[0].time < gameData.gameTime) {
        const schedule = this.schedules.shift();
        console.log("Auto-chart:", schedule.charts.join(", "));
        showChart(schedule.charts);
      }

      const { isDead = false } = parsePlayerData(
        data,
        this.customFollow || this.currentPlayer.gameName,
      );

      if (isDead === this.isDead && this.activeGame) {
        this.gameEventTimeout = this.gameEventTimer();
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

      this.isDead = isDead;

      if (this.activeGame) {
        this.gameEventTimeout = this.gameEventTimer();
      }
    }, 500);
  }

  autoDirector(game) {
    let times = 0;
    const checkIsLive = () => {
      return setTimeout(async () => {
        let data = (await checkIsInReplay()) && (await getAllGameData());

        if (!data || !data.allPlayers?.length) {
          if (times > 30) {
            this.reset();
            return;
          }

          if (this.activeGame) {
            times += 1;
            checkIsLive();
          }

          return;
        }

        const { gameData } = data;

        setTimeout(async () => {
          // It's fine if we're behind a little.
          this.schedules = this.schedules.filter(
            ({ time }) => time > gameData.gameTime,
          );

          renderDefaultUI();

          showChart(["runes"]);

          updateLobbyInfo(this, game);

          await setTargetAuto(this);
          console.log("START autofocus.");

          setTimeout(async () => {
            console.log("START focusing on player.");
            await setTargetPlayer(this, this.currentPlayer.gameName);
          }, 10_000);

          this.gameEventTimeout = this.gameEventTimer();
        }, 1000);
      }, 10_000);
    };

    checkIsLive();
  }

  teamfightUpdate() {
    return setTimeout(async () => {
      let gameData;

      try {
        gameData = await getAllGameData();
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
      console.error("spectate.js Error retrieving from spectator API", err);
    }

    try {
      // Player not in-game.
      if (!game) {
        this.lastGameId = null;
        let gameData;

        try {
          const data = await getAllGameData();
          gameData = data.gameData;
        } catch {
          // noop
        }

        if (
          gameData?.gameTime &&
          this.lastGameTime === Number(gameData.gameTime).toFixed(0)
        ) {
          await this.reset();

          setTimeout(() => {
            refreshSourceCache();
          }, 5000);

          console.log("Exiting completed game.");

          await markCurrentGameCompleted();

          await downloadReplays(
            this.currentPlayer.puuid,
            this.currentPlayer.region.regional,
          );

          setPostGame(true);
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
          const { gameData } = await getAllGameData();

          if (
            gameData?.gameTime &&
            this.lastGameTime === Number(gameData.gameTime).toFixed(0)
          ) {
            this.reset();
            console.log("Exiting completed game a tad late.");

            await markCurrentGameCompleted();

            refreshSourceCache();
            setPostGame(true, 60_000);

            await downloadReplays(
              this.currentPlayer.puuid,
              this.currentPlayer.region.regional,
            );
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
        this.chat(
          `Launching ${this.currentPlayer.gameName}#${this.currentPlayer.tagLine} game...`,
        );

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
