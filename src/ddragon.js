import { fetch } from "undici";

/**
 * @type {Array<{ key: string, name: string }>}
 */
let champions = [];

export const getChampions = () => {
  return champions;
};

const getLatestVersion = async () => {
  try {
    const res = await fetch(
      "https://ddragon.leagueoflegends.com/api/versions.json",
    );

    if (!res.ok) {
      return null;
    }

    const versions = await res.json();

    return versions.shift();
  } catch (err) {
    console.error("Could not fetch latest ddragon version.", err);
    return null;
  }
};

(async () => {
  const version = await getLatestVersion();

  if (!version) {
    return;
  }

  try {
    const res = await fetch(
      `https://ddragon.leagueoflegends.com/cdn/${version}/data/en_US/champion.json`,
    );

    if (!res.ok) {
      return;
    }

    const championsObject = await res.json();

    const championsArr = Object.values(championsObject.data);

    champions = championsArr;
  } catch (err) {
    console.error("Could not get champion data.");
  }
})();
