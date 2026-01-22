import fs from "fs/promises";
import path from "path";
import { pipeline } from "stream";
import { promisify } from "util";
import { fetch } from "undici";

const streamPipeline = promisify(pipeline);

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

/**
 * @param {string} puuid
 * @param {string} region
 */
export const downloadReplays = async (puuid, region = REGION) => {
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
      fileName:
        new URL(fileURL).pathname.split("/").pop().split(".").shift() + ".rofl",
    }));

    const filesToDownload = filesToCheckFor.filter(
      ({ fileName }) => !downloadedReplays.has(fileName),
    );

    await Promise.allSettled(
      filesToDownload.map(async ({ fileName, url }) => {
        const response = await fetch(url);

        if (!response.ok) {
          return console.error("Skipping file", url);
        }

        const destination = path.join(REPLAYS_DIR, fileName);

        return streamPipeline(response.body, fs.createWriteStream(destination));
      }),
    );
  } catch (err) {
    console.error("Error retrieving replays", err);
  }
};
