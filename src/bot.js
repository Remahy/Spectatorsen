import {
  ChatClient,
  PrivmsgMessage,
  PrivmsgMessageRateLimiter,
  SlowModeRateLimiter,
} from "@mastondzn/dank-twitch-irc";

import { regionKeys, REGIONS } from "./regions.js";
import game, { Player, setTargetAuto, setTargetPlayer } from "./spectate.js";
import { changeSourceText, setNewPlayerBrowserSource } from "./obs.js";
import { showChart } from "./bb.js";
import { getCurrentGame } from "./riot.js";
// import { TwitchAuth } from "./token.js";
// import pkg from "../packageObject.cjs";

// const { name: pgkName, version, repository } = pkg;

const {
  GAME_NAME,
  TAG_LINE,
  LEAGUE_REGION,
  SPECTATE_REGION,

  TWITCH_ENABLE,
  TWITCH_USERNAME,

  /*
  TWITCH_CLIENT_ID,
  TWITCH_CLIENT_SECRET,
  TWITCH_ACCESS_TOKEN,
  TWITCH_REFRESH_TOKEN,
  */

  TWITCH_PERMA_ACCESS_TOKEN,
} = process.env;

let spectateInterval = null;
const startSpectateInterval = () => {
  clearInterval(spectateInterval);

  spectateInterval = setInterval(() => {
    game.updateFn?.();
  }, 12_000);
};

let waitForHardcodedIndividual = null;
const startHardcodedIndividualInterval = (chat) => {
  if (!GAME_NAME || !TAG_LINE || !SPECTATE_REGION || !LEAGUE_REGION) {
    return;
  }

  clearTimeout(waitForHardcodedIndividual);

  waitForHardcodedIndividual = setTimeout(async () => {
    try {
      const playerData = await Player.find(`${GAME_NAME}#${TAG_LINE}`);

      if (game.currentPlayer?.puuid === playerData.puuid) {
        return;
      }

      let currentGame = null;
      try {
        currentGame = await getCurrentGame(playerData.puuid, SPECTATE_REGION);
      } catch (err) {
        console.error("Error retrieving from spectator API", err);
        startHardcodedIndividualInterval(chat);
        return;
      }

      if (!currentGame) {
        startHardcodedIndividualInterval(chat);
        return;
      }

      const region = LEAGUE_REGION.toUpperCase();

      const player = await spectatePlayer(
        playerData.gameName,
        playerData.tagLine,
        { ...REGIONS[region], code: region },
        chat,
      );

      startSpectateInterval();
      startHardcodedIndividualInterval(chat);

      return chat.say(
        TWITCH_USERNAME,
        `@spectatorsen 🦆 SWITCHING OFF FROM CURRENTLY SPECTATED PLAYER. Switching to (${player.gameName}#${player.tagLine}) in region ${player.region.platform}.`,
      );
    } catch (err) {
      console.error(
        "Errored when figuring out if hardcoded individual is playing.",
        err,
      );
    }
  }, 15_000);
};

/**
 * @param {string} gameName
 * @param {string} tagLine
 * @param {{ code: string, platform: string, regional: string }} region
 * @param {ChatClient} chat
 */
const spectatePlayer = async (gameName, tagLine, region, chat = null) => {
  try {
    const playerData = await Player.find(`${gameName}#${tagLine}`);

    const player = new Player(
      region,
      playerData.gameName,
      playerData.tagLine,
      playerData.puuid,
    );

    await game.setPlayer(player);

    setNewPlayerBrowserSource(player);

    if (chat) {
      const sendMessageFn = (msg) =>
        chat
          .say(TWITCH_USERNAME, msg)
          .catch((err) =>
            console.error("Failed to deliver message:", msg, "Error:", err),
          );
      game.setChat(sendMessageFn);
    }

    return player;
  } catch (err) {
    chat.say(TWITCH_USERNAME, "🦆 could not spectate that player.");
    return null;
  }
};

/**
 * @type {ChatClient}
 */
let chat;

(async () => {
  if (!TWITCH_ENABLE) {
    const region = {
      ...REGIONS[LEAGUE_REGION.toUpperCase()],
      code: LEAGUE_REGION.toLowerCase(),
    };

    await spectatePlayer(GAME_NAME, TAG_LINE, region);

    startSpectateInterval();

    return;
  }

  /*
  const api = new TwitchAuth({
    clientSecret: TWITCH_CLIENT_SECRET,
    clientToken: TWITCH_CLIENT_ID,
    scope: ["chat:edit", "chat:read"],
    headers: {
      "user-agent": `${pgkName}${version} (${repository.url})`,
    },
  });
  */

  /**
   * @param {ChatClient} chat
   * @param {PrivmsgMessage} msg
   */
  const spectateCommandParse =
    (chat, msg) =>
    /**
     * @param {string} region
     * @param {string} _value
     */
    async (_region, _value) => {
      const region = _region || "";
      const value = _value || "";

      const matchesRegion = REGIONS[region.toUpperCase()];

      if (!matchesRegion) {
        return chat.reply(
          msg.channelName,
          msg.messageID,
          `🦆 possible region values: ${regionKeys.join(" ")}`,
        );
      }

      const [gameName, tagLine] = value.split("#");

      if (!gameName || !tagLine) {
        return chat.reply(
          msg.channelName,
          msg.messageID,
          `🦆 missing: playername#tagline`,
        );
      }

      const player = await spectatePlayer(
        gameName,
        tagLine,
        { ...matchesRegion, code: region.toLowerCase() },
        chat,
      );

      if (!player) {
        return;
      }

      startSpectateInterval();

      return chat.reply(
        msg.channelName,
        msg.messageID,
        `🦆 waiting for game from "${player.gameName}#${player.tagLine}" in region ${player.region.platform}.`,
      );
    };

  const conductorCooldown = {
    chart: Date.now(),
    default: Date.now(),
  };

  /**
   * @param {ChatClient} chat
   * @param {PrivmsgMessage} msg
   */
  const conductorCommandParse =
    (chat, msg) =>
    /**
     * @param {commandString} value
     */
    async (commandString) => {
      const [action, ..._value] = commandString.split(" ").map((v) => v.trim());

      if (conductorCooldown.default > Date.now()) {
        return;
      }

      switch (action) {
        case "chart": {
          if (conductorCooldown.chart > Date.now()) {
            conductorCooldown.default = Date.now() + 10_000;
            return chat.reply(msg.channelName, msg.messageID, "🦆 cooldown.");
          }

          const pre = conductorCooldown.chart;

          const value = _value.join(" ");
          if (value === "gold") {
            await showChart(["goldGraph", "sideInfoGold"]);
            conductorCooldown.chart = Date.now() + 59_000;
          } else if (value === "exp") {
            await showChart(["sideInfoExp"]);
            conductorCooldown.chart = Date.now() + 59_000;
          } else if (value === "cs") {
            await showChart(["sideInfoCreepscore"]);
            conductorCooldown.chart = Date.now() + 59_000;
          } else if (value === "damage") {
            await showChart(["sideInfoDamage"]);
            conductorCooldown.chart = Date.now() + 59_000;
          } else if (value === "cinema") {
            await showChart(["teamfightNoDamageGraph"]);
            conductorCooldown.chart = Date.now() + 59_000;
          }

          if (conductorCooldown.chart > pre) {
            conductorCooldown.default = Date.now() + 10_000;
            return chat.reply(
              msg.channelName,
              msg.messageID,
              `🦆 showing graph for 30 seconds: ${value}`,
            );
          }

          break;
        }
        case "follow":
        case "spectate": {
          if (!msg.isMod) {
            return;
          }

          const value = _value.join(" ");
          const gameName = value.split("#").shift().trim();
          game.customFollow = gameName;
          const res = await setTargetPlayer(game, gameName);

          if (res) {
            conductorCooldown.default = Date.now() + 10_000;

            return chat.reply(
              msg.channelName,
              msg.messageID,
              `🦆 enabled focus-mode on ${gameName}.`,
            );
          } else {
            return chat.reply(msg.channelName, msg.messageID, "🦆 unable to.");
          }
        }
        case "auto": {
          if (!msg.isMod) {
            return;
          }

          const res = await setTargetAuto(game);
          game.customFollow = null;
          if (res) {
            conductorCooldown.default = Date.now() + 10_000;

            return chat.reply(
              msg.channelName,
              msg.messageID,
              "🦆 enabled browsing around.",
            );
          } else {
            return chat.reply(msg.channelName, msg.messageID, "🦆 unable to.");
          }
        }
      }

      return chat.reply(
        msg.channelName,
        msg.messageID,
        "🦆 unknown conductor action, supported actions: chart <cinema|gold|exp|cs|damage>, (mod-only) follow <playername>, (mod-only) auto. 30 seconds cooldown.",
      );
    };

  /**
   * @param {ChatClient} chat
   * @param {PrivmsgMessage} msg
   */
  const commandParse = async (chat, msg) => {
    const [rawCommand, region, ...player] = msg.messageText.trim().split(" ");

    if (!rawCommand.startsWith("@@")) {
      return;
    }

    const command = rawCommand.slice(2);

    if (command === "spectate") {
      spectateCommandParse(chat, msg)(region, player.join(" "));
      return;
    }

    if (command === "conductor") {
      conductorCommandParse(chat, msg)([region, ...player].join(" "));
      return;
    }

    if (command === "restart") {
      game.reset();

      return chat.reply(
        msg.channelName,
        msg.messageID,
        "🦆 restarting, there may be another delay before game is launched again.",
      );
    }

    if (command === "reset") {
      await game.setPlayer(null);

      return chat.reply(
        msg.channelName,
        msg.messageID,
        "🦆 resetting, removing currently spectated player.",
      );
    }

    if (command === "obs") {
      if (region === "announce") {
        const text = player.join(" ").replace(/\\n/g, "\n");

        await changeSourceText("ANNOUNCEMENT", text);
      }
    }
  };

  const resetChat = async () => {
    if (chat) {
      chat.removeAllListeners();
      chat.close();
    }

    /*
    let token = TWITCH_ACCESS_TOKEN;
    const validToken = await api.validateToken(TWITCH_ACCESS_TOKEN);

    if (validToken === null) {
      const res = await api.refreshToken(TWITCH_REFRESH_TOKEN);
      token = res.access_token;
    }
    */

    chat = new ChatClient({
      password: `oauth:${TWITCH_PERMA_ACCESS_TOKEN}`,
      rateLimits: "default",
      username: TWITCH_USERNAME,
      connection: {
        type: "websocket",
        secure: true,
      },
    });

    chat.use(new SlowModeRateLimiter(chat));
    chat.use(new PrivmsgMessageRateLimiter(chat));

    chat.on("ready", () => {
      console.log("Successfully connected to chat");
      startHardcodedIndividualInterval(chat);
    });

    chat.on("close", (err) => {
      if (err != null) {
        console.error("Client closed due to error", err);
      }
    });

    chat.on("error", (err) => {
      if (err != null) {
        console.error("Error", err);
      }
    });

    chat.on("PRIVMSG", (msg) => {
      if (
        msg.isMod &&
        msg.senderUsername.toLowerCase() !== TWITCH_USERNAME.toLowerCase()
      ) {
        commandParse(chat, msg);
      }
    });

    // See below for more events
    chat.connect();
    chat.join(TWITCH_USERNAME);
  };

  setInterval(() => {
    resetChat();
  }, 1_800_000);

  resetChat();
})();
