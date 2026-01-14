import { REGIONS } from "./regions.js";

import game, { Player } from "./spectate.js";

const spectateInterval = () => {
  clearInterval(spectateInterval);

  return setInterval(() => {
    game.update();
  }, 15_000);
};

const {
  GAME_NAME,
  TAG_LINE,
  SPECTATE_REGION,
} = process.env;

const spectatePlayer = async (gameName, tagLine, region) => {
  const playerData = await Player.find(`${gameName}#${tagLine}`);

  const player = new Player(
    region,
    playerData.gameName,
    playerData.tagLine,
    playerData.puuid
  );

  game.setPlayer(player);

  return player;
};

(async () => {
  const region = REGIONS[SPECTATE_REGION.toUpperCase()];

  await spectatePlayer(GAME_NAME, TAG_LINE, region);

  spectateInterval();
})();
