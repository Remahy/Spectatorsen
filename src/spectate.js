import { exec, execSync } from "child_process";
import { formatDistance } from "date-fns";

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
import { updateOpggProfile } from "./opgg.js";

const { OBS_POST_GAME_SOURCE } = process.env;

/**
 * @param {CurrentGame} currentGame
 */
const updateLobbyInfo = async (currentGame, game) => {
  try {
    const lobbyData = await getLobbyData(game);

    const start = `Start: ${new Date(game.gameStartTime).toUTCString()}`;

    if (!lobbyData) {
      return changeLobbyInfo(start);
    }

    const { players, bannedChampions } = lobbyData;

    if (
      !Object.keys(players || {}).length &&
      !Object.keys(bannedChampions || {}).length
    ) {
      return changeLobbyInfo(start);
    }

    if (bannedChampions?.BLUE?.length) {
      currentGame.chat(`(Bans Blue) ${bannedChampions.BLUE.join(" / ")}.`);
    }

    if (bannedChampions?.RED?.length) {
      setTimeout(() => {
        currentGame.chat(`(Bans Red) ${bannedChampions.RED.join(" / ")}.`);
      }, 500);
    }

    if (players?.BLUE?.length) {
      setTimeout(() => {
        currentGame.chat(
          `(Ranks Blue) ${players.BLUE.map(({ champion, fullRank }) => `${champion}: ${fullRank}`).join(" / ")}`,
        );
      }, 1000);
    }

    if (players?.RED?.length) {
      setTimeout(() => {
        currentGame.chat(
          `(Ranks Red) ${players.RED.map(({ champion, fullRank }) => `${champion}: ${fullRank}`).join(" / ")}`,
        );
      }, 1500);
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
${players.BLUE?.length ? players.BLUE.map(({ champion, fullRank }) => `${champion}: ${fullRank}`).join("\n") : "Streamer mode on everyone?"}

Ranks Red:
${players.RED?.length ? players.RED.map(({ champion, fullRank }) => `${champion}: ${fullRank}`).join("\n") : "Streamer mode on everyone?"}`
        : ""
    }`;

    return changeLobbyInfo(layout);
  } catch (err) {
    console.error("Could not display lobby info.", err);
  }
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

/**
 * @param {CurrentGame} game
 */
function renderDefaultUI(game) {
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
    selectionName: game.customFollow || game.currentPlayer?.gameName,
  };

  return changeRender(uiSettings);
}

/**
 * @param {CurrentGame} currentGame
 */
export const setTargetPlayer = async (currentGame, gameName) => {
  const targetPlayer = {
    selectionName: currentGame?.customFollow || gameName,
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

export const setTargetAuto = async () => {
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
}

class CurrentGame {
  lastGameId = null;
  startAutoDirectorTimer = null;
  gameEventTimeouts = null;
  lastGameTime = -1;
  isDead = null;
  activeGame = false;
  customFollow = null;
  updateFn = null;

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
    clearInterval(this.gameEventTimersInterval);

    shutdownSpectator();

    this.schedules = structuredClone(bbSchedules);
    this.lastGameId = null;
    this.startAutoDirectorTimer = null;
    this.gameEventTimeouts = null;
    this.teamfightUpdateTimer = null;
    this.lastGameTime = -1;
    this.isDead = null;
    this.activeGame = false;
    this.customFollow = null;

    await setSourceVisibility("Game", OBS_POST_GAME_SOURCE, false);

    this.updateFn = this.update;
  }

  /**
   * @param {(msg: string) => void} fn
   */
  setChat(fn) {
    this.chat = fn;
  }

  /**
   * @param {Player | null} player
   */
  async setPlayer(player) {
    this.reset();

    if (player) {
      await updateOpggProfile(player);
    }

    this.currentPlayer = player;
  }

  gameEventTimersInterval() {
    let deadTimer = null;
    let selectionTimer = null;

    const deadTimerFn = () =>
      setTimeout(async () => {
        // Always maintain UI.
        renderDefaultUI(this);

        let data;
        let gameData;

        try {
          data = await getAllGameData();
          gameData = data.gameData;
        } catch {
          this.reset();
          deadTimer = null;
          return;
        }

        if (!gameData) {
          console.log(
            "No gameData in gameEventTimers[0]?",
            JSON.stringify(data),
          );
          deadTimer = null;
          return;
        }

        if (
          this.schedules.length &&
          this.schedules[0].time < gameData.gameTime
        ) {
          const schedule = this.schedules.shift();
          console.log("Auto-chart:", schedule.charts.join(", "));
          showChart(schedule.charts);
        }

        const { isDead = false } = parsePlayerData(
          data,
          this.customFollow || this.currentPlayer.gameName,
        );

        if (isDead === this.isDead && this.activeGame) {
          deadTimer = null;
          return;
        }

        if (!isDead) {
          await setTargetPlayer(this, this.currentPlayer.gameName);
          console.log("Focusing on player.");
        } else {
          playAudioFile();
          setTimeout(() => {
            setTargetAuto();
            console.log("Autofocus.");
          }, 2500);
        }

        this.isDead = isDead;

        deadTimer = null;
      }, 500);

    const selectionTimerFn = () =>
      setTimeout(() => {
        if (this.activeGame) {
          changeRender({
            selectionName: this.customFollow || this.currentPlayer.gameName,
          });
        }

        selectionTimer = null;
      }, 50);

    const interval = setInterval(() => {
      if (this.activeGame) {
        if (deadTimer === null) {
          deadTimer = deadTimerFn();
        }

        if (selectionTimer === null) {
          selectionTimer = selectionTimerFn();
        }
      } else if (selectionTimer === null && deadTimer === null) {
        console.log("Clearing interval.");
        clearInterval(interval);
      }
    }, 10);

    return interval;
  }

  autoDirector(game) {
    let times = 0;

    const checkIsLive = () => {
      return setTimeout(async () => {
        let data = (await checkIsInReplay()) && (await getAllGameData());

        if (!data || !data.allPlayers?.length) {
          if (times >= 12) {
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

          renderDefaultUI(this);

          showChart(["runes"]);

          updateLobbyInfo(this, game);

          await setTargetAuto();
          console.log("START autofocus.");

          setTimeout(async () => {
            console.log("START focusing on player.");
            await setTargetPlayer(this, this.currentPlayer.gameName);
          }, 10_000);

          this.gameEventTimeouts = this.gameEventTimersInterval();
        }, 5000);
      }, 10_000);
    };

    checkIsLive();
  }

  async update() {
    // Prevents overlapping requests if one poll is slow
    this.updateFn = null;

    if (!this.currentPlayer) {
      this.updateFn = this.update;
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
            this.currentPlayer.gameName,
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
              this.currentPlayer.gameName,
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

      clearTimeout(this.startAutoDirectorTimer);
      this.startAutoDirectorTimer = null;

      this.lastGameId = game.gameId;
      console.log(`New game detected: ${game.gameId}`);

      setBBDefaults();
      await waitForBB();

      const msSinceStart = Date.now() - game.gameStartTime;
      const spectatorTimeout =
        msSinceStart > 200_000 ? 0 : 200_000 - msSinceStart;

      const launchingClientDate = new Date(Date.now() + spectatorTimeout);

      console.log(
        "Launching client at",
        launchingClientDate.toLocaleTimeString(),
      );

      try {
        this.chat(
          `Game found (${this.currentPlayer.gameName}#${this.currentPlayer.tagLine}). ${
            spectatorTimeout > 0
              ? ` Waiting ${formatDistance(launchingClientDate, new Date())} before launching client.`
              : ""
          }`,
        );
      } catch (err) {
        console.error("Tried to send a message in chat but failed.", err);
      }

      refreshSourceCache();

      this.startAutoDirectorTimer = setTimeout(async () => {
        this.chat(
          `Launching (${this.currentPlayer.gameName}#${this.currentPlayer.tagLine}) game...`,
        );

        launchSpectator(game);
        this.activeGame = true;

        this.autoDirector(game);
      }, spectatorTimeout);
    } catch (err) {
      console.error("Watcher error:", err);
    } finally {
      this.updateFn = this.update;
    }
  }
}

export class Player {
  /**
   * @type {{ code: string, platform: string, regional: string }}
   */
  region = { code: "", platform: "", regional: "" };
  gameName = "";
  tagLine = "";
  puuid = "";

  /**
   * @param {{ code: string, platform: string, regional: string }} region
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
