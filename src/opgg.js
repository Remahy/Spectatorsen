/**
 * THIS TOOL IS NOT AFFILIATED WITH OPGG.
 * USE THIS FEATURE AT YOUR OWN RISK.
 */

const { OPGG_UPDATE_ENABLE } = process.env;

/**
 * @param {import("./spectate.js").Player} player
 */
const url = (player) =>
  `https://op.gg/lol/summoners/${player.region.code}/${player.gameName}-${player.tagLine}`;

const regex = /\\"puuid\\":\\"([\w\-_]+)\\"/;

/**
 * @param {import("./spectate.js").Player} player
 */
const opggPuuidRetriever = async (player) => {
  try {
    const res = await fetch(url(player), {
      method: "GET",
      headers: {
        "next-action": "405a04669583947dc03eb8c7f367adf28c8f714e86",
      },
    });

    if (!res.ok) {
      throw new Error(res.statusText);
    }

    const text = await res.text();

    const rawMatch = text.match(regex);

    if (!rawMatch || rawMatch?.length === 0) {
      throw new Error("Could not find puuid in string.");
    }

    const [, puuid] = rawMatch;
    return puuid;
  } catch (err) {
    console.warn("Could not find puuid for op.gg profile!", err);
  }
};

/**
 * @param {import("./spectate.js").Player} player
 */
export const updateOpggProfile = async (player) => {
  if (!OPGG_UPDATE_ENABLE) {
    return;
  }

  try {
    const puuid = await opggPuuidRetriever(player);

    if (!puuid) {
      return;
    }

    await fetch(url(player), {
      method: "POST",
      headers: {
        "next-action": "405a04669583947dc03eb8c7f367adf28c8f714e86",
      },
      body: JSON.stringify([
        {
          region: player.region.code,
          puuid,
          isPremiumPrimary: false,
        },
      ]),
    });

    return new Promise((resolve) =>
      setTimeout(() => {
        console.log("Refreshed op.gg.");
        resolve();
      }, 15_000),
    );
  } catch (err) {
    console.warn("Could not update op.gg profile!", err);
  }
};
