import { readdir } from "fs/promises";
import { createWriteStream } from "fs";
import { fetch } from "undici";
import { pipeline } from "stream/promises";
import { Readable } from "stream";
import { riotHeaders } from "./riot.js";

const { REGION } = process.env;

const REPLAYS_DIR = new URL("../replays", import.meta.url).pathname.substring(
  1,
);

const getExistingFiles = async () => {
  try {
    const files = await readdir(REPLAYS_DIR, { withFileTypes: true });

    return new Set(
      files.filter((item) => !item.isDirectory()).map((item) => item.name),
    );
  } catch (err) {
    console.error("Error trying to read existing replay files.", err);
    return null;
  }
};

async function downloadFile(url, filepath) {
  const response = await fetch(url);
  if (!response.ok || !response.body) {
    return;
  }

  const writer = createWriteStream(`${REPLAYS_DIR}/${filepath}`);
  await pipeline(Readable.fromWeb(response.body), writer);
}

/**
 * @param {string} puuid
 * @param {string} gameName
 * @param {string} region
 */
export const downloadReplays = async (puuid, gameName, region = REGION) => {
  const downloadedReplays = await getExistingFiles();

  if (!downloadedReplays) {
    return;
  }

  try {
    const url = `https://${region}.api.riotgames.com/lol/match/v5/matches/by-puuid/${puuid}/replays`;

    const res = await fetch(url, {
      headers: riotHeaders,
    });

    if (!res.ok) {
      throw new Error("Did not receive OK status.");
    }

    /**
     * @type {{ total: number, matchFileURLs: string[] }}
     */
    const replayLinks = await res.json();

    const filesToCheckFor = replayLinks.matchFileURLs.map((fileURL) => ({
      url: fileURL,
      fileName: `${gameName}_${new URL(fileURL).pathname.split("/").pop().split(".").shift()}.rofl`,
    }));

    const filesToDownload = filesToCheckFor.filter(
      ({ fileName }) => !downloadedReplays.has(fileName),
    );

    await Promise.allSettled(
      filesToDownload.map(({ fileName, url }) => downloadFile(url, fileName)),
    );
  } catch (err) {
    console.error("Error retrieving replays", err);
  }
};
