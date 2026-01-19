import fs from "fs";
import { OBSWebSocket } from "obs-websocket-js";

const {
  OBS_IP,
  OBS_PORT,
  OBS_PASSWORD,
  OBS_BROWSER_SOURCE,
  OBS_BROWSER_SOURCE_URL,
  OBS_AUDIO_SOURCE,
  OBS_AUDIO_DIRECTORY,
} = process.env;

const obs = new OBSWebSocket();

const audioFiles = () => {
  if (!OBS_AUDIO_SOURCE || !OBS_AUDIO_DIRECTORY) {
    return [];
  }

  return fs
    .readdirSync(OBS_AUDIO_DIRECTORY, { withFileTypes: true })
    .filter((item) => !item.isDirectory())
    .map((item) => `${OBS_AUDIO_DIRECTORY}\\${item.name}`);
};

export const refreshSourceCache = async (source = OBS_BROWSER_SOURCE) => {
  if (!OBS_IP) {
    return;
  }

  try {
    await obs.call("PressInputPropertiesButton", {
      inputName: source,
      propertyName: "refreshnocache",
    });
    console.log(`Refreshed OBS ${source} source cache`);
  } catch (err) {
    console.error(`Failed to refresh OBS ${source} source cache`, err);
  }
};

async function setSourceVisibility(sceneName, sourceName, visible) {
  if (!OBS_IP) {
    return;
  }

  try {
    const { sceneItems } = await obs.call("GetSceneItemList", { sceneName });
    const item = sceneItems.find((i) => i.sourceName === sourceName);
    if (!item) {
      throw new Error("Source not found in scene");
    }

    await obs.call("SetSceneItemEnabled", {
      sceneName,
      sceneItemId: item.sceneItemId,
      sceneItemEnabled: visible,
    });
    console.log(`Set OBS visibility ${visible} for ${sourceName}`);
  } catch (err) {
    console.error(
      `Failed to set OBS visibility ${visible} for ${sourceName}`,
      err,
    );
  }
}

/**
 * @param {boolean} visible
 */
export const setPostGame = async (visible) => {
  if (!OBS_IP) {
    return;
  }

  await refreshSourceCache("Post_Game");

  await setSourceVisibility("Scene", "Post-Game", visible);

  setTimeout(() => {
    setSourceVisibility("Scene", "Post-Game", false);
  }, 60_000);
};

/**
 * @param {import('./spectate').Player} player
 */
export const setNewPlayerBrowserSource = async (player) => {
  if (!OBS_IP) {
    return;
  }

  if (!OBS_BROWSER_SOURCE_URL) {
    console.log("OBS_BROWSER_SOURCE_URL not set.");
    return;
  }

  const url = OBS_BROWSER_SOURCE_URL.replace(
    "%gameName%",
    player.gameName,
  ).replace("%tagLine%", player.tagLine);

  try {
    await obs.call("SetInputSettings", {
      inputName: OBS_BROWSER_SOURCE,
      inputSettings: {
        url: url,
      },
    });
    console.log("Set new player in OBS.");
  } catch (err) {
    console.error("Failed to set new player in OBS.", err);
  }
};

/**
 * @param {string} [absolutePath]
 */
export const playAudioFile = async (absolutePath) => {
  if (!OBS_IP) {
    return;
  }

  try {
    let file = absolutePath;

    if (!file) {
      const files = audioFiles();

      file = files[Math.floor(Math.random() * files.length)];
    }

    await obs.call("SetInputSettings", {
      inputName: OBS_AUDIO_SOURCE,
      inputSettings: {
        playlist: [
          {
            hidden: false,
            selected: false,
            value: file,
          },
        ],
      },
    });

    await obs.call("TriggerMediaInputAction", {
      inputName: OBS_AUDIO_SOURCE,
      mediaAction: "OBS_WEBSOCKET_MEDIA_INPUT_ACTION_RESTART",
    });
  } catch (err) {
    console.error("Failed to play audio file in OBS", err);
  }
};

(async () => {
  if (OBS_IP) {
    obs.on("ConnectionOpened", () => {
      console.log("OBS READY");
    });

    await obs.connect(`ws://${OBS_IP}:${OBS_PORT}`, OBS_PASSWORD);

    refreshSourceCache();
  } else {
    console.log("OBS disabled.");
  }
})();
