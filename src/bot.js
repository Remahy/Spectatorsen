import {
  ChatClient,
  PrivmsgMessage,
  PrivmsgMessageRateLimiter,
  SlowModeRateLimiter,
} from "@mastondzn/dank-twitch-irc";

import { regionKeys, REGIONS } from "./regions.js";
import game, { Player } from "./spectate.js";
import { setNewPlayerBrowserSource } from "./obs.js";
// import { TwitchAuth } from "./token.js";
// import pkg from "../pkgObject.cjs";

// const { name: pgkName, version, repository } = pkg;

let spectateInterval = null;
const startSpectateInterval = () => {
  clearInterval(spectateInterval);

  spectateInterval = setInterval(() => {
    game.update();
  }, 15_000);
};

const {
  GAME_NAME,
  TAG_LINE,
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

/**
 * @param {string} gameName
 * @param {string} tagLine
 * @param {string} region
 */
const spectatePlayer = async (gameName, tagLine, region) => {
  const playerData = await Player.find(`${gameName}#${tagLine}`);

  const player = new Player(
    region,
    playerData.gameName,
    playerData.tagLine,
    playerData.puuid
  );

  game.setPlayer(player);

  setNewPlayerBrowserSource(player);

  return player;
};

/**
 * @type {ChatClient}
 */
let chat;

(async () => {
  if (!TWITCH_ENABLE) {
    const region = REGIONS[SPECTATE_REGION.toUpperCase()];

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
     * @param {string} value
     */
    async (region, value) => {
      const matchesRegion = REGIONS[region.toUpperCase()];

      if (!matchesRegion) {
        return chat.reply(
          msg.channelName,
          msg.messageID,
          `🦆 possible region values: ${regionKeys.join(" ")}`
        );
      }

      const [gameName, tagLine] = value.split("#");

      const player = await spectatePlayer(gameName, tagLine, matchesRegion);

      startSpectateInterval();

      return chat.reply(
        msg.channelName,
        msg.messageID,
        `🦆 now spectating "${player.gameName}#${player.tagLine}" in region ${player.region.platform}.`
      );
    };

  /**
   * @param {ChatClient} chat
   * @param {PrivmsgMessage} msg
   */
  const commandParse = (chat, msg) => {
    const [rawCommand, region, ...player] = msg.messageText.trim().split(" ");

    if (!rawCommand.startsWith("@@")) {
      return;
    }

    const command = rawCommand.slice(2);

    if (command === "spectate") {
      spectateCommandParse(chat, msg)(region, player.join(" "));
      return;
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

    chat.on("ready", () => console.log("Successfully connected to chat"));

    chat.on("close", (err) => {
      if (err != null) {
        console.error("Client closed due to error", err);
      }
    });

    chat.on("PRIVMSG", (msg) => {
      if (msg.isMod) {
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
