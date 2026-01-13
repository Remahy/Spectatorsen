import { exec, execSync } from "child_process";
import { fetch, Agent } from "undici";
import { config } from "dotenv";

config();

const agent = new Agent({
  connect: {
    rejectUnauthorized: false,
  },
});

const { API_KEY, PUUID, GAME_NAME, TAG_LINE, REGION, SPECTATE_REGION } =
  process.env;

async function getPUUID(
  gameName = GAME_NAME,
  tagLine = TAG_LINE,
  region = REGION
) {
  const url = `https://${region}.api.riotgames.com/riot/account/v1/accounts/by-riot-id/${gameName}/${tagLine}`;

  const res = await fetch(url, {
    headers: { "X-Riot-Token": API_KEY },
  });

  if (!res.ok) {
    throw new Error("Account not found");
  }

  return res.json();
}

async function getCurrentGame(puuid = PUUID, spectateRegion = SPECTATE_REGION) {
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

function getPlayerData(data = {}) {
  const { allPlayers } = data || {};

  const player = allPlayers.find(
    (player) => player.riotIdGameName.toLowerCase() === GAME_NAME.toLowerCase()
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

function launchSpectator(game) {
  const { encryptionKey } = game.observers;
  const { gameId, platformId } = game;

  const uri = `opgg://spectate?host=spectator.${platformId.toLowerCase()}.lol.pvp.net%3A8080&key=${encodeURIComponent(
    encryptionKey
  )}&gameId=${gameId}&platformId=${platformId.toUpperCase()}&game=LOL`;

  exec(`cmd /c start "" "${uri}"`);
}

function shutdownSpectator(keepFocusTimer) {
  try {
    clearTimeout(keepFocusTimer);
    execSync(`taskkill /IM "League of Legends.exe" /F`);
  } catch (error) {
    console.log("Found nothing to shutdown.");
  }
}

async function focusPlayer(keepFocusTimer) {
  const uiSettings = {
    interfaceAll: true,
    interfaceAnnounce: true,
    interfaceChat: true,
    interfaceFrames: true,
    interfaceKillCallouts: true,
    interfaceMinimap: true,
    interfaceNeutralTimers: false,
    interfaceQuests: true,
    interfaceReplay: false,
    interfaceScore: true,
    interfaceScoreboard: true,
    interfaceTarget: true,
    interfaceTimeline: false,
  };

  const targetPlayer = {
    selectionName: GAME_NAME,
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

  const isLive = () => {
    return setTimeout(async () => {
      try {
        const isInReplay = await fetch("https://127.0.0.1:2999/replay/game", {
          dispatcher: agent,
        });

        if (!isInReplay.ok) {
          isLive();
          return;
        }

        const res = await isInReplay.json();

        if (typeof res.processID === "undefined") {
          isLive();
          return;
        }
      } catch (err) {
        isLive();
        return;
      }

      changeRender(uiSettings);

      const timerInit = () => {
        return setTimeout(async () => {
          const { isDead } = getPlayerData(await getCurrentGameData());

          if (!isDead) {
            await changeRender(targetPlayer);
            console.log("Focusing on player.");
          } else {
            await changeRender(targetEveryone);
            console.log("Autofocus.");
          }

          keepFocusTimer = timerInit();
        }, 10_000);
      };

      keepFocusTimer = timerInit();
    }, 10_000);
  };

  isLive();
}

function init(intervalMs = 30_000) {
  let lastGameId = null;
  let isChecking = false;
  let keepFocusTimer = null;
  let lastGameTime = -1;

  setInterval(async () => {
    // Prevent overlapping requests if one poll is slow
    if (isChecking) {
      return;
    }

    isChecking = true;

    try {
      const account = await getPUUID();
      const game = await getCurrentGame(account.puuid);

      // Player not in-game.
      if (!game) {
        lastGameId = null;
        console.log("Not in-game.");

        const { gameData } = await getCurrentGameData();

        if (gameData?.gameTime && lastGameTime === gameData?.gameTime) {
          shutdownSpectator(keepFocusTimer);
        } else {
          lastGameTime = gameData?.gameTime || -1;
        }

        return;
      }

      // Same game as before then do nothing.
      if (game.gameId === lastGameId) {
        return;
      }

      // New game detected
      lastGameId = game.gameId;
      console.log(`New game detected: ${game.gameId}`);

      shutdownSpectator(keepFocusTimer);

      setTimeout(async () => {
        launchSpectator(game);

        try {
          await focusPlayer(keepFocusTimer);
        } catch (err) {
          console.log("Tried to focus on player", err);
        }
      }, 1000);
    } catch (err) {
      console.error("Watcher error:", err);
      console.error(err);
    } finally {
      isChecking = false;
    }
  }, intervalMs);
}

init();
