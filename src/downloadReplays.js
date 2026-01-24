import fs from "fs/promises";
import { createWriteStream } from "fs";
import { fetch } from "undici";

const { API_KEY, REGION } = process.env;

const REPLAYS_DIR = new URL("../replays", import.meta.url).pathname.substring(
  1,
);

const getExistingFiles = async () => {
  const files = await fs.readdir(REPLAYS_DIR, { withFileTypes: true });

  return new Set(
    files.filter((item) => !item.isDirectory()).map((item) => item.name),
  );
};

// https://stackoverflow.com/a/73338676
function getFileWritableStream(filePath) {
  const downloadWriteStream = createWriteStream(filePath);

  /* This adapter is needed because the method .pipeTo() only
  accepts an instance of WritableStream.
  */
  return new WritableStream({
    write: (chunk) => downloadWriteStream(chunk),
  });
}

async function downloadFile(url, filepath) {
  const response = await fetch(url);
  const body = response.body;
  const fileWritableStream = getFileWritableStream(
    `${REPLAYS_DIR}/${filepath}`,
  );
  await body.pipeTo(fileWritableStream);
}

/**
 * @param {string} puuid
 * @param {string} gameName
 * @param {number} gameStartTime
 * @param {string} region
 */
export const downloadReplays = async (
  puuid,
  gameName,
  gameStartTime,
  region = REGION,
) => {
  const downloadedReplays = await getExistingFiles();

  try {
    const url = `https://${region}.api.riotgames.com/lol/match/v5/matches/by-puuid/${puuid}/replays`;

    const res = await fetch(url, {
      headers: { "X-Riot-Token": API_KEY },
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
      fileName: `${new Date(gameStartTime).toUTCString()}_${gameName}_${new URL(fileURL).pathname.split("/").pop().split(".").shift()}.rofl`,
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
